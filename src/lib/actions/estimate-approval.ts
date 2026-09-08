"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { isStrictAdmin, type EstimateStatus } from "@/lib/data/types";

/**
 * Approving a document before it goes to the customer.
 *
 * Approval is recorded as its own fact -- who checked it, and when --
 * beside the rep who wrote it, never in place of them. The document
 * still says who sold the job; it now also says who signed it off.
 *
 * Admin only. Office runs the day to day and sends estimates already;
 * if approval could be given by the same people who send, the gate
 * checks nothing. Loosening this later is one line, so it starts tight.
 */

export type PendingApproval = {
  id: string;
  doc_number: string | null;
  title: string | null;
  status: EstimateStatus;
  total_cents: number | null;
  kind: string | null;
  updated_at: string | null;
  customer: string | null;
  writtenBy: string | null;
};

/** Whether the gate is switched on for this company. */
export async function getApprovalSetting(): Promise<{ required: boolean }> {
  const profile = await getCurrentProfile();
  if (!profile) return { required: false };

  const supabase = await createClient();
  const { data } = await supabase
    .from("company_profile")
    .select("require_estimate_approval")
    .eq("company_id", profile.company_id)
    .maybeSingle<{ require_estimate_approval: boolean | null }>();
  return { required: data?.require_estimate_approval === true };
}

export async function setApprovalSetting(required: boolean): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isStrictAdmin(profile)) {
    return { error: "Only an Admin can turn approval on or off." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_profile")
    .update({ require_estimate_approval: required })
    .eq("company_id", profile.company_id)
    .select("company_id")
    .returns<{ company_id: string }[]>();
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Couldn't change the setting." };

  revalidatePath("/estimate-approvals");
  return {};
}

/**
 * Drafts waiting to be approved.
 *
 * Drafts only. A document that already went out is past this gate, and
 * listing it here would read as work outstanding when there is none.
 */
export async function getPendingApprovals(): Promise<{
  error?: string;
  pending?: PendingApproval[];
}> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isStrictAdmin(profile)) return { error: "Admins only." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("estimates")
    .select(
      "id, doc_number, title, status, total_cents, kind, updated_at, created_by, leads(first_name, last_name, company_name)"
    )
    .eq("company_id", profile.company_id)
    .eq("status", "Draft")
    .is("approved_at", null)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) return { error: error.message };

  const rows = (data ?? []) as unknown as (Omit<PendingApproval, "customer" | "writtenBy"> & {
    created_by: string | null;
    leads: { first_name: string | null; last_name: string | null; company_name: string | null } | null;
  })[];

  // One lookup for every author on the list rather than one per row.
  const authorIds = [...new Set(rows.map((r) => r.created_by).filter(Boolean))] as string[];
  const byId = new Map<string, string>();
  if (authorIds.length) {
    const { data: people } = await supabase
      .from("profiles")
      .select("id, name, email")
      .in("id", authorIds)
      .returns<{ id: string; name: string | null; email: string | null }[]>();
    for (const p of people ?? []) byId.set(p.id, p.name || p.email || "Unknown");
  }

  return {
    pending: rows.map((r) => ({
      id: r.id,
      doc_number: r.doc_number,
      title: r.title,
      status: r.status,
      total_cents: r.total_cents,
      kind: r.kind,
      updated_at: r.updated_at,
      customer:
        r.leads?.company_name ||
        [r.leads?.first_name, r.leads?.last_name].filter(Boolean).join(" ").trim() ||
        null,
      writtenBy: r.created_by ? (byId.get(r.created_by) ?? null) : null,
    })),
  };
}

export async function approveEstimate(estimateId: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isStrictAdmin(profile)) {
    return { error: "Only an Admin can approve a document." };
  }

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("estimates")
    .select("id, status, doc_number, lead_id")
    .eq("id", estimateId)
    .eq("company_id", profile.company_id)
    .maybeSingle<{ id: string; status: string; doc_number: string | null; lead_id: string | null }>();
  if (!existing) return { error: "Document not found." };
  // Approving something already out is meaningless, and would read on
  // the record as a check that happened before a send that it did not.
  if (existing.status !== "Draft") {
    return { error: `${existing.doc_number ?? "This document"} has already gone out.` };
  }

  const { data, error } = await supabase
    .from("estimates")
    .update({ approved_at: new Date().toISOString(), approved_by: profile.id })
    .eq("id", estimateId)
    .eq("company_id", profile.company_id)
    .eq("status", "Draft")
    .select("id")
    .returns<{ id: string }[]>();
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Couldn't approve that document." };

  // On the contact's timeline, because "who said this could go out" is a
  // question asked months later, usually when something went wrong.
  if (existing.lead_id) {
    await supabase.from("lead_notes").insert({
      company_id: profile.company_id,
      lead_id: existing.lead_id,
      author_id: profile.id,
      body: `${existing.doc_number ?? "Document"} approved to send by ${profile.name || profile.email || "admin"}.`,
    });
  }

  revalidatePath("/estimate-approvals");
  revalidatePath(`/estimates/${estimateId}`);
  return {};
}

/** Takes an approval back, while the document is still a draft. */
export async function unapproveEstimate(estimateId: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isStrictAdmin(profile)) {
    return { error: "Only an Admin can withdraw an approval." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("estimates")
    .update({ approved_at: null, approved_by: null })
    .eq("id", estimateId)
    .eq("company_id", profile.company_id)
    .eq("status", "Draft")
    .select("id")
    .returns<{ id: string }[]>();
  if (error) return { error: error.message };
  if (!data?.length) {
    return { error: "Couldn't withdraw that approval — the document may already have gone out." };
  }

  revalidatePath("/estimate-approvals");
  revalidatePath(`/estimates/${estimateId}`);
  return {};
}

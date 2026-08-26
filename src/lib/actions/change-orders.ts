"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { canCreateEstimates, type EstimateStatus } from "@/lib/data/types";

type ParentRow = {
  id: string;
  company_id: string;
  lead_id: string;
  doc_number: string;
  status: EstimateStatus;
  tax_rate_bp: number;
  assigned_to: string | null;
  kind: string;
  job_address: string | null;
};

/**
 * Opens a change order against a signed contract.
 *
 * Only against a signed one: before signing there is nothing to change,
 * and the estimate itself is still editable. Afterwards it is not, which
 * is exactly why this exists.
 *
 * Numbered from the parent -- EST-1021-CO1 -- so the relationship is
 * legible on a phone screen and in a filename, without looking anything
 * up. Counted from siblings rather than kept in a column, because two
 * counters for one fact drift.
 */
export async function createChangeOrder(
  parentId: string,
  title: string
): Promise<{ error?: string; id?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canCreateEstimates(profile))
    return { error: "You don't have permission to create change orders." };
  if (!title.trim()) return { error: "Describe what is changing." };

  const supabase = await createClient();
  const { data: parent } = await supabase
    .from("estimates")
    .select("id, company_id, lead_id, doc_number, status, tax_rate_bp, assigned_to, kind, job_address")
    .eq("id", parentId)
    .eq("company_id", profile.company_id)
    .maybeSingle<ParentRow>();
  if (!parent) return { error: "Contract not found." };
  if (parent.kind !== "contract")
    return { error: "A change order belongs to a contract, not to another change order." };
  if (parent.status !== "Signed")
    return { error: "This contract isn't signed yet — edit the estimate instead." };

  const { count } = await supabase
    .from("estimates")
    .select("id", { count: "exact", head: true })
    .eq("parent_estimate_id", parentId);

  const { data: created, error } = await supabase
    .from("estimates")
    .insert({
      company_id: profile.company_id,
      lead_id: parent.lead_id,
      parent_estimate_id: parent.id,
      kind: "change_order",
      doc_number: `${parent.doc_number}-CO${(count ?? 0) + 1}`,
      title: title.trim(),
      status: "Draft" as EstimateStatus,
      assigned_to: parent.assigned_to ?? profile.id,
      tax_rate_bp: parent.tax_rate_bp,
      // The extra work happens at the same site the contract names.
      job_address: parent.job_address ?? null,
      // No deposit. The CSLB cap applies to the contract, and asking for
      // one again on every extra is how a job quietly exceeds it.
      deposit_percent_bp: 0,
      deposit_cap_cents: 0,
      deposit_cents: 0,
      created_by: profile.id,
    })
    .select("id")
    .returns<{ id: string }[]>();
  if (error) return { error: error.message };
  if (!created?.length) return { error: "Couldn't create the change order." };

  // The same customer signs it. Copied from the contract's signers rather
  // than the lead, so a job signed by two owners needs both again -- which
  // is the point of having recorded two in the first place.
  const { data: signers } = await supabase
    .from("estimate_signers")
    .select("party, name, email, phone, sort_order")
    .eq("estimate_id", parent.id)
    .eq("party", "customer")
    .returns<
      { party: string; name: string; email: string | null; phone: string | null; sort_order: number }[]
    >();
  if (signers?.length) {
    await supabase.from("estimate_signers").insert(
      signers.map((s) => ({
        company_id: profile.company_id,
        estimate_id: created[0].id,
        party: s.party,
        name: s.name,
        email: s.email,
        phone: s.phone,
        sort_order: s.sort_order,
      }))
    );
  }

  revalidatePath(`/estimates/${parentId}`);
  revalidatePath("/estimates");
  return { id: created[0].id };
}

export type ChangeOrderRow = {
  id: string;
  doc_number: string;
  title: string;
  status: EstimateStatus;
  total_cents: number;
  signed_at: string | null;
  created_at: string;
};

/**
 * The contract a change order amends, for its document header.
 *
 * Fetched only when parent_estimate_id is set, which is the rare case --
 * a join would pull a second row for every document the portal renders.
 * Uses the caller's client so the portal (service role, no staff session)
 * and the staff preview (RLS) can both use it.
 */
export async function getParentContract(parentId: string | null): Promise<{
  doc_number: string;
  total_cents: number;
  signed_at: string | null;
} | null> {
  if (!parentId) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("estimates")
    .select("doc_number, total_cents, signed_at")
    .eq("id", parentId)
    .maybeSingle<{ doc_number: string; total_cents: number; signed_at: string | null }>();
  return data ?? null;
}

/** The change orders on one contract, oldest first. */
export async function getChangeOrders(
  parentId: string
): Promise<{ error?: string; orders?: ChangeOrderRow[] }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("estimates")
    .select("id, doc_number, title, status, total_cents, signed_at, created_at")
    .eq("parent_estimate_id", parentId)
    .eq("company_id", profile.company_id)
    .order("created_at", { ascending: true })
    .returns<ChangeOrderRow[]>();
  if (error) return { error: error.message };
  return { orders: data ?? [] };
}

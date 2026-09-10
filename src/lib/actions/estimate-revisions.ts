"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { canCreateEstimates, estimateLocked, type EstimateStatus } from "@/lib/data/types";
import { lateContractValues } from "@/lib/contracts/merge";
import { restoreLateTokens } from "@/lib/contracts/restore-late-tokens";

type ParentRow = {
  id: string;
  company_id: string;
  lead_id: string;
  doc_number: string;
  title: string;
  status: EstimateStatus;
  version: number;
  kind: string;
  assigned_to: string | null;
  contract_template_id: string | null;
  tax_rate_bp: number;
  subtotal_cents: number;
  discount_type: string | null;
  discount_value: number;
  discount_label: string | null;
  discount_cents: number;
  tax_cents: number;
  total_cents: number;
  deposit_percent_bp: number;
  deposit_cap_cents: number;
  deposit_cents: number | null;
  customer_message: string | null;
  terms: string | null;
  notes: string | null;
  job_address: string | null;
  start_date: string | null;
  completion_date: string | null;
};

/**
 * Copies a signed contract into an editable draft: same document number,
 * version + 1, every line item, section, payment phase and customer
 * signer carried over -- so fixing three words does not mean retyping a
 * hundred lines.
 *
 * A revision, not a change order. A change order ADDS to a contract that
 * stays exactly as signed; a revision REPLACES it -- and it replaces it
 * only when the customer signs the new version, which is when
 * finalizeSignedEstimate voids the old one. Until that signature the
 * signed original remains the contract, exactly as agreed.
 *
 * The locked banner has promised "create a new version to change it"
 * since signing locks arrived; this is the action that promise was
 * writing a cheque against.
 */
export async function createEstimateRevision(
  estimateId: string
): Promise<{ error?: string; id?: string; existing?: boolean }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canCreateEstimates(profile))
    return { error: "You don't have permission to create or edit estimates." };

  const supabase = await createClient();
  const { data: parent } = await supabase
    .from("estimates")
    .select(
      "id, company_id, lead_id, doc_number, title, status, version, kind, assigned_to, contract_template_id, tax_rate_bp, subtotal_cents, discount_type, discount_value, discount_label, discount_cents, tax_cents, total_cents, deposit_percent_bp, deposit_cap_cents, deposit_cents, customer_message, terms, notes, job_address, start_date, completion_date"
    )
    .eq("id", estimateId)
    .eq("company_id", profile.company_id)
    .maybeSingle<ParentRow>();
  if (!parent) return { error: "Document not found." };
  if (parent.kind !== "contract")
    return { error: "Only a contract can be revised. Raise a change order or a fresh document instead." };
  if (parent.status === "Void")
    return { error: "This document was cancelled. Start a fresh estimate instead of reviving it." };

  // Locked is the trigger, not merely Signed: one customer signature out
  // of two already freezes the document, and that half-signed state is
  // exactly when a wrong figure needs a new version -- the old one can no
  // longer be edited and voiding it is an Admin decision.
  const { data: parentSigners } = await supabase
    .from("estimate_signers")
    .select("party, signed_at")
    .eq("estimate_id", parent.id)
    .returns<{ party: "company" | "customer"; signed_at: string | null }[]>();
  if (!estimateLocked(parent.status, parentSigners ?? []))
    return { error: "Nobody has signed this yet, so it can still be edited directly." };

  // One live revision per contract. A double-click, or two reps reading
  // the same signed contract, must land on the same draft rather than
  // fork the job into competing v5s.
  const { data: live } = await supabase
    .from("estimates")
    .select("id")
    .eq("supersedes_id", parent.id)
    .eq("company_id", profile.company_id)
    .in("status", ["Draft", "Sent", "Viewed"])
    .limit(1)
    .returns<{ id: string }[]>();
  if (live?.length) return { id: live[0].id, existing: true };

  // A fresh expiry window, not the old one: the original's date has
  // usually passed by the time anyone needs a revision.
  const { data: settings } = await supabase
    .from("company_profile")
    .select("estimate_expiry_days")
    .eq("company_id", profile.company_id)
    .maybeSingle<{ estimate_expiry_days: number }>();
  const expires = new Date();
  expires.setDate(expires.getDate() + (settings?.estimate_expiry_days ?? 7));

  // Sending froze the money into the stored terms ("{{contract_total}}"
  // became "$114,000.00"). Turned back into tokens on the copy, so if the
  // revision's prices change, the next send fills the contract wording
  // with the figures the customer is actually agreeing to -- not v4's.
  const terms = parent.terms
    ? restoreLateTokens(parent.terms, lateContractValues(parent))
    : null;

  const { data: created, error } = await supabase
    .from("estimates")
    .insert({
      company_id: profile.company_id,
      lead_id: parent.lead_id,
      doc_number: parent.doc_number,
      title: parent.title,
      status: "Draft" as EstimateStatus,
      version: parent.version + 1,
      supersedes_id: parent.id,
      kind: "contract",
      assigned_to: parent.assigned_to,
      contract_template_id: parent.contract_template_id,
      tax_rate_bp: parent.tax_rate_bp,
      subtotal_cents: parent.subtotal_cents,
      discount_type: parent.discount_type,
      discount_value: parent.discount_value,
      discount_label: parent.discount_label,
      discount_cents: parent.discount_cents,
      tax_cents: parent.tax_cents,
      total_cents: parent.total_cents,
      deposit_percent_bp: parent.deposit_percent_bp,
      deposit_cap_cents: parent.deposit_cap_cents,
      deposit_cents: parent.deposit_cents,
      customer_message: parent.customer_message,
      terms,
      notes: parent.notes,
      job_address: parent.job_address,
      start_date: parent.start_date,
      completion_date: parent.completion_date,
      expires_at: expires.toISOString().slice(0, 10),
      created_by: profile.id,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  // Before migration 0146 the database allows one row per document
  // number, so the insert bounces off the old unique key. Named plainly:
  // "duplicate key value violates unique constraint" sends a rep to IT,
  // this sends the admin to the migration.
  if (error?.message.includes("estimates_doc_number_unique"))
    return { error: "The database doesn't allow versions yet — run migration 0146_estimate_revisions.sql first." };
  if (error) return { error: error.message };
  if (!created) return { error: "Couldn't create the new version." };

  // Sections first, so the lines can point at their new homes. Inserted
  // one at a time to get each new id back against the old one -- a
  // contract has a handful of sections, not thousands.
  const { data: groups } = await supabase
    .from("estimate_groups")
    .select("id, name, description, sort_order")
    .eq("estimate_id", parent.id)
    .order("sort_order", { ascending: true })
    .returns<{ id: string; name: string; description: string | null; sort_order: number }[]>();
  const groupIdMap = new Map<string, string>();
  for (const g of groups ?? []) {
    const { data: ng } = await supabase
      .from("estimate_groups")
      .insert({
        company_id: profile.company_id,
        estimate_id: created.id,
        name: g.name,
        description: g.description,
        sort_order: g.sort_order,
      })
      .select("id")
      .maybeSingle<{ id: string }>();
    if (ng) groupIdMap.set(g.id, ng.id);
  }

  // Every line, priced and unpriced, including internal costs -- the
  // margin picture belongs to the job, not to one version of it. The
  // customer's tick on an optional line comes too: totals stay identical
  // to the signed version, and the first save before sending re-asks the
  // question anyway, exactly as it does on any edited estimate.
  const { data: items } = await supabase
    .from("estimate_items")
    .select(
      "sort_order, name, description, quantity, unit, unit_price_cents, line_total_cents, taxable, cost_cents, group_id, is_optional, optional_selected"
    )
    .eq("estimate_id", parent.id)
    .order("sort_order", { ascending: true })
    .returns<
      {
        sort_order: number;
        name: string;
        description: string | null;
        quantity: number;
        unit: string | null;
        unit_price_cents: number;
        line_total_cents: number;
        taxable: boolean;
        cost_cents: number | null;
        group_id: string | null;
        is_optional: boolean | null;
        optional_selected: boolean | null;
      }[]
    >();
  if (items?.length) {
    await supabase.from("estimate_items").insert(
      items.map((i) => ({
        company_id: profile.company_id,
        estimate_id: created.id,
        sort_order: i.sort_order,
        name: i.name,
        description: i.description,
        quantity: i.quantity,
        unit: i.unit,
        unit_price_cents: i.unit_price_cents,
        line_total_cents: i.line_total_cents,
        taxable: i.taxable,
        cost_cents: i.cost_cents,
        group_id: i.group_id ? (groupIdMap.get(i.group_id) ?? null) : null,
        is_optional: i.is_optional ?? false,
        optional_selected: i.optional_selected ?? false,
      }))
    );
  }

  // The schedule as agreed, but none of its billing history: what was
  // requested or paid happened on the old version and stays recorded
  // there, where the money actually moved.
  const { data: phases } = await supabase
    .from("estimate_payments")
    .select("sort_order, name, description, amount_cents")
    .eq("estimate_id", parent.id)
    .order("sort_order", { ascending: true })
    .returns<{ sort_order: number; name: string; description: string | null; amount_cents: number }[]>();
  if (phases?.length) {
    await supabase.from("estimate_payments").insert(
      phases.map((p) => ({
        company_id: profile.company_id,
        estimate_id: created.id,
        sort_order: p.sort_order,
        name: p.name,
        description: p.description,
        amount_cents: p.amount_cents,
      }))
    );
  }

  // The same customers sign again, from scratch -- copied from the
  // contract's own signers rather than the lead, same as change orders,
  // so a job signed by two owners needs both again. No company signer:
  // the contractor signs at send time, standing behind the new numbers.
  const { data: signers } = await supabase
    .from("estimate_signers")
    .select("party, name, email, phone, sort_order")
    .eq("estimate_id", parent.id)
    .eq("party", "customer")
    .order("sort_order", { ascending: true })
    .returns<
      { party: string; name: string; email: string | null; phone: string | null; sort_order: number }[]
    >();
  if (signers?.length) {
    await supabase.from("estimate_signers").insert(
      signers.map((s) => ({
        company_id: profile.company_id,
        estimate_id: created.id,
        party: s.party,
        name: s.name,
        email: s.email,
        phone: s.phone,
        sort_order: s.sort_order,
      }))
    );
  }

  revalidatePath(`/estimates/${parent.id}`);
  revalidatePath("/estimates");
  return { id: created.id };
}

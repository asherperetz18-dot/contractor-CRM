"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import {
  canEditDispatch,
  canDeleteLeads,
  computeEstimateTotals,
  isIssuedEstimate,
  lineTotalCents,
  type EstimateStatus,
} from "@/lib/data/types";

type LeadRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  assigned_to: string | null;
  company_id: string;
};

type SettingsRow = {
  tax_rate_bp: number;
  estimate_expiry_days: number;
  estimate_terms: string | null;
};

type ItemsEstimateRow = {
  id: string;
  lead_id: string;
  status: EstimateStatus;
  tax_rate_bp: number;
};

type SendEstimateRow = {
  id: string;
  lead_id: string;
  status: EstimateStatus;
  total_cents: number;
};

export type ItemInput = {
  name: string;
  description?: string | null;
  quantity: number;
  unit?: string | null;
  unit_price_cents: number;
  taxable: boolean;
  cost_cents?: number | null;
};

async function requireEstimateEditor(): Promise<
  { error: string } | { companyId: string; userId: string }
> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canEditDispatch(profile)) return { error: "You don't have access to estimates." };
  return { companyId: profile.company_id, userId: profile.id };
}

// The detail route is /estimates/<estimate id>. Pipeline is refreshed too
// because sending an estimate rewrites the lead's value, which every
// money figure on that page is derived from.
function revalidateEstimates(estimateId?: string | null) {
  revalidatePath("/estimates");
  revalidatePath("/pipeline");
  if (estimateId) revalidatePath(`/estimates/${estimateId}`);
}

export async function createEstimate(
  leadId: string,
  title: string
): Promise<{ error?: string; id?: string }> {
  const guard = await requireEstimateEditor();
  if ("error" in guard) return guard;

  const supabase = await createClient();

  // The customer's own name seeds the signer list, so the rep is not
  // retyping what the lead record already knows.
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id, first_name, last_name, email, phone, assigned_to, company_id")
    .eq("id", leadId)
    .eq("company_id", guard.companyId)
    .maybeSingle<LeadRow>();
  if (leadError) return { error: leadError.message };
  if (!lead) return { error: "Lead not found." };

  const { data: settings } = await supabase
    .from("company_profile")
    .select("tax_rate_bp, estimate_expiry_days, estimate_terms")
    .eq("company_id", guard.companyId)
    .maybeSingle<SettingsRow>();

  const { data: docNumber, error: numberError } = await supabase.rpc("next_estimate_number", {
    check_company_id: guard.companyId,
  });
  const docNumberText = docNumber as string | null;
  if (numberError) return { error: numberError.message };

  const expiryDays = settings?.estimate_expiry_days ?? 7;
  const expires = new Date();
  expires.setDate(expires.getDate() + expiryDays);

  const { data: created, error } = await supabase
    .from("estimates")
    .insert({
      company_id: guard.companyId,
      lead_id: leadId,
      doc_number: docNumberText,
      title: title.trim(),
      status: "Draft" as EstimateStatus,
      assigned_to: lead.assigned_to ?? guard.userId,
      tax_rate_bp: settings?.tax_rate_bp ?? 0,
      terms: settings?.estimate_terms ?? null,
      expires_at: expires.toISOString().slice(0, 10),
      created_by: guard.userId,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error) return { error: error.message };
  if (!created) return { error: "Could not create the estimate." };

  const customerName = [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim();
  if (customerName) {
    await supabase.from("estimate_signers").insert({
      company_id: guard.companyId,
      estimate_id: created.id,
      party: "customer",
      name: customerName,
      email: lead.email,
      phone: lead.phone,
      sort_order: 0,
    });
  }

  revalidateEstimates(created.id);
  return { id: created.id };
}

export async function updateEstimateDetails(
  estimateId: string,
  fields: {
    title?: string;
    expires_at?: string | null;
    customer_message?: string | null;
    terms?: string | null;
    notes?: string | null;
    deposit_cents?: number | null;
  }
): Promise<{ error?: string }> {
  const guard = await requireEstimateEditor();
  if ("error" in guard) return guard;

  const supabase = await createClient();
  // .select() so a row blocked by RLS surfaces as an error rather than
  // silently matching zero rows and reporting success.
  const { data, error } = await supabase
    .from("estimates")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", estimateId)
    .eq("company_id", guard.companyId)
    .select("id, lead_id")
    .returns<{ id: string; lead_id: string }[]>();
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Estimate not found, or you can't edit it." };

  revalidateEstimates(estimateId);
  return {};
}

// Replaces the whole item list and re-derives the stored totals. Totals are
// recomputed here rather than trusted from the client: the browser sends
// what the rep typed, not what the document is worth.
export async function saveEstimateItems(
  estimateId: string,
  items: ItemInput[]
): Promise<{ error?: string; totalCents?: number }> {
  const guard = await requireEstimateEditor();
  if ("error" in guard) return guard;

  const supabase = await createClient();
  const { data: estimate, error: readError } = await supabase
    .from("estimates")
    .select("id, lead_id, status, tax_rate_bp")
    .eq("id", estimateId)
    .eq("company_id", guard.companyId)
    .maybeSingle<ItemsEstimateRow>();
  if (readError) return { error: readError.message };
  if (!estimate) return { error: "Estimate not found." };
  if (isIssuedEstimate(estimate.status)) {
    return { error: "This estimate has already gone out. Create a new version to change it." };
  }

  const clean = items
    .map((item) => ({ ...item, name: (item.name ?? "").trim() }))
    .filter((item) => item.name || item.unit_price_cents);

  const { error: deleteError } = await supabase
    .from("estimate_items")
    .delete()
    .eq("estimate_id", estimateId);
  if (deleteError) return { error: deleteError.message };

  if (clean.length) {
    const rows = clean.map((item, i) => ({
      company_id: guard.companyId,
      estimate_id: estimateId,
      sort_order: i,
      name: item.name,
      description: item.description ?? null,
      quantity: item.quantity,
      unit: item.unit ?? null,
      unit_price_cents: item.unit_price_cents,
      line_total_cents: lineTotalCents(item.quantity, item.unit_price_cents),
      taxable: item.taxable,
      cost_cents: item.cost_cents ?? null,
    }));
    const { error: insertError } = await supabase.from("estimate_items").insert(rows);
    if (insertError) return { error: insertError.message };
  }

  const totals = computeEstimateTotals(clean, estimate.tax_rate_bp);
  const { error: totalsError } = await supabase
    .from("estimates")
    .update({
      subtotal_cents: totals.subtotalCents,
      tax_cents: totals.taxCents,
      total_cents: totals.totalCents,
      updated_at: new Date().toISOString(),
    })
    .eq("id", estimateId);
  if (totalsError) return { error: totalsError.message };

  revalidateEstimates(estimateId);
  return { totalCents: totals.totalCents };
}

// Marks the estimate as issued and stamps its total onto the lead.
//
// This write-back is the point of the whole module: 1,122 of 1,128 open
// leads have no value recorded, so Pipeline Value, Avg Deal Size and the
// rep leaderboard are all computed over almost nothing. Nobody fills in a
// "value" field; everybody writes an estimate.
export async function markEstimateSent(estimateId: string): Promise<{ error?: string }> {
  const guard = await requireEstimateEditor();
  if ("error" in guard) return guard;

  const supabase = await createClient();
  const { data: estimate, error: readError } = await supabase
    .from("estimates")
    .select("id, lead_id, status, total_cents")
    .eq("id", estimateId)
    .eq("company_id", guard.companyId)
    .maybeSingle<SendEstimateRow>();
  if (readError) return { error: readError.message };
  if (!estimate) return { error: "Estimate not found." };
  if (estimate.status !== "Draft") return { error: "This estimate has already been sent." };
  if (!estimate.total_cents) return { error: "Add at least one line item before sending." };

  const now = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from("estimates")
    .update({ status: "Sent" as EstimateStatus, sent_at: now, issued_at: now, updated_at: now })
    .eq("id", estimateId)
    .eq("company_id", guard.companyId)
    .select("id")
    .returns<{ id: string }[]>();
  if (error) return { error: error.message };
  if (!updated?.length) return { error: "Could not send the estimate." };

  // A signed estimate outranks a merely sent one, so a later draft going
  // out must not overwrite the value of work already won.
  const { data: signed } = await supabase
    .from("estimates")
    .select("total_cents")
    .eq("lead_id", estimate.lead_id)
    .eq("status", "Signed")
    .order("signed_at", { ascending: false })
    .limit(1)
    .returns<{ total_cents: number }[]>();

  const valueCents = signed?.length ? signed[0].total_cents : estimate.total_cents;
  await supabase
    .from("leads")
    .update({ value: valueCents / 100 })
    .eq("id", estimate.lead_id)
    .eq("company_id", guard.companyId);

  revalidateEstimates(estimateId);
  return {};
}

export async function deleteEstimate(estimateId: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  // Deleting priced work a customer may already have seen is gated the same
  // way lead deletion is, rather than by plain edit access.
  if (!canDeleteLeads(profile)) return { error: "You don't have permission to delete estimates." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("estimates")
    .delete()
    .eq("id", estimateId)
    .eq("company_id", profile.company_id)
    .select("id, lead_id")
    .returns<{ id: string; lead_id: string }[]>();
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Estimate not found, or you can't delete it." };

  revalidateEstimates(null);
  return {};
}

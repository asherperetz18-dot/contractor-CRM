"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTwilioSms } from "@/lib/twilio-env";
import { getTwilioForCompany } from "@/lib/twilio-company";
import { createLoginToken, portalAccessExpiry, portalBaseUrl } from "@/lib/portal/session";
import { getCurrentProfile } from "@/lib/data/profile";
import { advanceStageOnEstimateSent } from "@/lib/pipeline/advance-stage";
import {
  balanceAfterDepositCents,
  canCreateEstimates,
  canDeleteLeads,
  canViewEstimates,
  depositCents,
  editWillRecallEstimate,
  estimateLocked,
  DEFAULT_PAYMENT_PHASES,
  splitEvenlyCents,
  computeEstimateTotals,
  lineTotalCents,
  parseQuantity,
  paidTotalCents,
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
  version: number;
  tax_rate_bp: number;
  deposit_percent_bp: number;
  deposit_cap_cents: number;
};

type SendToCustomerRow = {
  id: string;
  lead_id: string;
  company_id: string;
  status: EstimateStatus;
  total_cents: number;
  doc_number: string;
  title: string;
};

type PaymentEstimateRow = {
  id: string;
  status: EstimateStatus;
  version: number;
  total_cents: number;
  deposit_percent_bp: number;
  deposit_cap_cents: number;
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
  if (!canCreateEstimates(profile))
    return { error: "You don't have permission to create or edit estimates." };
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
): Promise<{ error?: string; totalCents?: number; recalled?: boolean }> {
  const guard = await requireEstimateEditor();
  if ("error" in guard) return guard;

  const supabase = await createClient();
  const { data: estimate, error: readError } = await supabase
    .from("estimates")
    .select("id, lead_id, status, version, tax_rate_bp, deposit_percent_bp, deposit_cap_cents")
    .eq("id", estimateId)
    .eq("company_id", guard.companyId)
    .maybeSingle<ItemsEstimateRow>();
  if (readError) return { error: readError.message };
  if (!estimate) return { error: "Estimate not found." };
  const lock = await guardEstimateEdit(
    supabase, estimateId, guard.companyId, estimate.status, estimate.version
  );
  if (lock.locked) {
    return { error: "The customer has signed this estimate. Create a new version to change it." };
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
      quantity: parseQuantity(item.quantity),
      unit: item.unit ?? null,
      unit_price_cents: item.unit_price_cents,
      line_total_cents: lineTotalCents(parseQuantity(item.quantity), item.unit_price_cents),
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
      // Re-derived here as well as on the schedule save: changing a line
      // item changes the total, and a deposit left over from the previous
      // total is both wrong and, on a big job, potentially over the legal
      // ceiling.
      deposit_cents: depositCents(
        totals.totalCents,
        estimate.deposit_percent_bp,
        estimate.deposit_cap_cents
      ),
      updated_at: new Date().toISOString(),
    })
    .eq("id", estimateId);
  if (totalsError) return { error: totalsError.message };

  revalidateEstimates(estimateId);
  return { totalCents: totals.totalCents, recalled: lock.recalled };
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

// Sends the estimate to the customer as a portal link by text.
//
// Reuses the client portal rather than inventing a second customer-facing
// auth: the token, session, address challenge and access window all
// already exist and are already hardened. The link deep-links straight to
// the document instead of the portal home.
export async function sendEstimateToCustomer(
  estimateId: string
): Promise<{ error?: string; sentTo?: string }> {
  const guard = await requireEstimateEditor();
  if ("error" in guard) return guard;

  const admin = createAdminClient();
  const { data: estimate } = await admin
    .from("estimates")
    .select("id, lead_id, company_id, status, total_cents, doc_number, title")
    .eq("id", estimateId)
    .eq("company_id", guard.companyId)
    .maybeSingle<SendToCustomerRow>();
  if (!estimate) return { error: "Estimate not found." };
  if (estimate.status !== "Draft") return { error: "This estimate has already been sent." };
  if (!estimate.total_cents) return { error: "Add at least one line item before sending." };

  const { data: lead } = await admin
    .from("leads")
    .select("id, first_name, phone, company_id")
    .eq("id", estimate.lead_id)
    .maybeSingle<{ id: string; first_name: string | null; phone: string | null; company_id: string }>();
  if (!lead) return { error: "Customer not found." };
  if (!lead.phone) return { error: "This customer has no phone number on file." };

  const twilioEnv = await getTwilioForCompany(guard.companyId);
  if (!twilioEnv) return { error: "Texting isn't configured for this company yet." };

  const { data: companyRow } = await admin
    .from("company_profile")
    .select("name")
    .eq("company_id", guard.companyId)
    .maybeSingle<{ name: string | null }>();
  const companyName = companyRow?.name || "Your contractor";

  // Sending the link is the act of granting access, same as the existing
  // portal invite -- otherwise the customer gets a link that refuses them.
  await admin
    .from("leads")
    .update({ portal_access_expires_at: portalAccessExpiry() })
    .eq("id", lead.id);

  const { token, error: tokenError } = await createLoginToken(lead.id, lead.company_id);
  if (tokenError || !token) return { error: tokenError || "Could not create a sign-in link." };

  const next = encodeURIComponent(`/portal/estimates/${estimateId}`);
  const link = `${portalBaseUrl()}/portal/verify?token=${encodeURIComponent(token)}&next=${next}`;

  // Plain hyphens and no emoji: an em dash or emoji flips the message to
  // UCS-2 and cuts each segment from 160 characters to 70.
  const body = `${companyName}: your estimate ${estimate.doc_number} is ready to review and sign.\n${link}\n\nLink expires in 7 days.`;
  const sent = await sendTwilioSms(lead.phone, body, twilioEnv);
  if (sent.error) return { error: `Text failed (${sent.error})` };

  const now = new Date().toISOString();
  await admin
    .from("estimates")
    .update({ status: "Sent", sent_at: now, issued_at: now, updated_at: now })
    .eq("id", estimateId);

  // The proposal is out, so the board should say so. Revives a lead
  // written off as Lost, since sending an estimate contradicts that.
  await advanceStageOnEstimateSent(admin, estimate.lead_id, guard.companyId);

  // The contractor signs too -- the reference product shows documents as
  // "1 of 2 signed" with the rep already on them. Recording it at send
  // time means the customer sees a document the contractor has stood
  // behind, not a blank pair of signature lines.
  const sender = await getCurrentProfile();
  if (sender) {
    await admin.from("estimate_signers").insert({
      company_id: guard.companyId,
      estimate_id: estimateId,
      party: "company",
      name: sender.name || sender.email || "Contractor",
      email: sender.email,
      sort_order: -1,
      signed_at: now,
      signature_name: sender.name || sender.email,
    });
  }

  // Logged in the same thread the team already watches, so "did they ever
  // get anything?" stays answerable from data.
  await admin.from("sms_messages").insert({
    lead_id: lead.id,
    direction: "outbound",
    from_number: twilioEnv.phoneNumber,
    to_number: lead.phone,
    sent_by: guard.userId,
    body,
    twilio_sid: sent.sid || null,
    company_id: guard.companyId,
    channel: "sms",
  });

  await admin
    .from("leads")
    .update({ value: estimate.total_cents / 100 })
    .eq("id", lead.id);

  revalidateEstimates(estimateId);
  return { sentTo: lead.phone };
}

export type PaymentInput = { name: string; description?: string | null; amount_cents: number };

/**
 * Replaces the progress-payment schedule.
 *
 * The deposit is not one of these rows -- it is derived from the total by
 * policy and stored on the estimate, so a rep cannot type over the legal
 * ceiling by editing a line.
 */
export async function saveEstimatePayments(
  estimateId: string,
  payments: PaymentInput[]
): Promise<{ error?: string; scheduledCents?: number; recalled?: boolean }> {
  const guard = await requireEstimateEditor();
  if ("error" in guard) return guard;

  const supabase = await createClient();
  const { data: estimate, error: readError } = await supabase
    .from("estimates")
    .select("id, status, version, total_cents, deposit_percent_bp, deposit_cap_cents")
    .eq("id", estimateId)
    .eq("company_id", guard.companyId)
    .maybeSingle<PaymentEstimateRow>();
  if (readError) return { error: readError.message };
  if (!estimate) return { error: "Estimate not found." };
  const lock = await guardEstimateEdit(
    supabase, estimateId, guard.companyId, estimate.status, estimate.version
  );
  if (lock.locked) {
    return { error: "The customer has signed this estimate. Create a new version to change it." };
  }

  const clean = payments
    .map((p) => ({ ...p, name: (p.name ?? "").trim() }))
    .filter((p) => p.name || p.amount_cents);

  const { error: deleteError } = await supabase
    .from("estimate_payments")
    .delete()
    .eq("estimate_id", estimateId);
  if (deleteError) return { error: deleteError.message };

  if (clean.length) {
    const { error: insertError } = await supabase.from("estimate_payments").insert(
      clean.map((p, i) => ({
        company_id: guard.companyId,
        estimate_id: estimateId,
        sort_order: i,
        name: p.name,
        description: p.description ?? null,
        amount_cents: Math.max(0, Math.round(p.amount_cents)),
      }))
    );
    if (insertError) return { error: insertError.message };
  }

  // Deposit is re-derived on every save so it always reflects the current
  // total -- editing line items after setting the schedule must not leave
  // a stale deposit behind.
  const deposit = depositCents(
    estimate.total_cents,
    estimate.deposit_percent_bp,
    estimate.deposit_cap_cents
  );
  await supabase
    .from("estimates")
    .update({ deposit_cents: deposit, updated_at: new Date().toISOString() })
    .eq("id", estimateId);

  revalidateEstimates(estimateId);
  return { recalled: lock.recalled, scheduledCents: deposit + clean.reduce((s, p) => s + p.amount_cents, 0) };
}

/**
 * Seeds a schedule: the standard remodel phases, splitting the balance
 * after the deposit evenly and to the cent.
 */
export async function generateEstimateSchedule(
  estimateId: string
): Promise<{ error?: string }> {
  const guard = await requireEstimateEditor();
  if ("error" in guard) return guard;

  const supabase = await createClient();
  const { data: estimate } = await supabase
    .from("estimates")
    .select("id, status, total_cents, deposit_percent_bp, deposit_cap_cents")
    .eq("id", estimateId)
    .eq("company_id", guard.companyId)
    .maybeSingle<PaymentEstimateRow>();
  if (!estimate) return { error: "Estimate not found." };
  if (!estimate.total_cents) return { error: "Add line items before building a payment schedule." };

  const deposit = depositCents(
    estimate.total_cents,
    estimate.deposit_percent_bp,
    estimate.deposit_cap_cents
  );
  const balance = balanceAfterDepositCents(estimate.total_cents, deposit);
  const amounts = splitEvenlyCents(balance, DEFAULT_PAYMENT_PHASES.length);

  return saveEstimatePayments(
    estimateId,
    DEFAULT_PAYMENT_PHASES.map((phase, i) => ({
      name: phase.name,
      description: phase.description,
      amount_cents: amounts[i] ?? 0,
    }))
  );
}

type LockCheck = { locked: boolean; recalled: boolean };

/**
 * Shared gate for every write to an estimate's contents.
 *
 * Blocks only once a customer has signed. Below that line, editing a
 * document that is already out with the customer pulls it back to Draft
 * and bumps the version: they were sent a link to a specific set of
 * numbers, and letting those change under them means they could sign
 * something they never read. Reverting to Draft also makes the portal
 * page refuse it, so the stale link stops working immediately.
 */
async function guardEstimateEdit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  estimateId: string,
  companyId: string,
  status: EstimateStatus,
  version: number
): Promise<LockCheck> {
  const { data: signers } = await supabase
    .from("estimate_signers")
    .select("id, party, signed_at")
    .eq("estimate_id", estimateId)
    .returns<{ id: string; party: "company" | "customer"; signed_at: string | null }[]>();

  if (estimateLocked(status, signers ?? [])) return { locked: true, recalled: false };
  if (!editWillRecallEstimate(status)) return { locked: false, recalled: false };

  await supabase
    .from("estimates")
    .update({
      status: "Draft" as EstimateStatus,
      version: version + 1,
      viewed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", estimateId)
    .eq("company_id", companyId);

  // The contractor signed at send time to stand behind those numbers.
  // Different numbers need a fresh signature, added again on the next
  // send rather than carried over.
  await supabase
    .from("estimate_signers")
    .delete()
    .eq("estimate_id", estimateId)
    .eq("party", "company");

  return { locked: false, recalled: true };
}

export type LeadEstimateSummary = {
  id: string;
  doc_number: string;
  title: string;
  status: EstimateStatus;
  total_cents: number;
};

export type LeadEstimatesResult = {
  estimates: LeadEstimateSummary[];
  canCreate: boolean;
  /** Settled money across every estimate on this lead. */
  paidCents: number;
};

/** Estimates on one lead, newest first, for the lead modal's button. */
export async function getEstimatesForLead(
  leadId: string
): Promise<LeadEstimatesResult> {
  const profile = await getCurrentProfile();
  if (!profile || !canViewEstimates(profile)) return { estimates: [], canCreate: false, paidCents: 0 };

  const supabase = await createClient();
  const { data } = await supabase
    .from("estimates")
    .select("id, doc_number, title, status, total_cents")
    .eq("lead_id", leadId)
    .eq("company_id", profile.company_id)
    .order("created_at", { ascending: false })
    .returns<LeadEstimateSummary[]>();

  const ids = (data ?? []).map((e) => e.id);
  let paidCents = 0;
  if (ids.length) {
    const { data: paidRows } = await supabase
      .from("portal_payments")
      .select("amount_cents, status")
      .in("estimate_id", ids)
      .returns<{ amount_cents: number; status: string }[]>();
    paidCents = paidTotalCents((paidRows ?? []) as never);
  }

  return { estimates: data ?? [], canCreate: canCreateEstimates(profile), paidCents };
}

/**
 * One-click route from a lead to its estimate: opens the newest one, or
 * starts one if there is none.
 *
 * The lead's own project type seeds the title, so the rep is not naming
 * the same job twice -- and the scope library matches on that type, so a
 * titled estimate immediately draws the right examples.
 */
export async function openOrCreateEstimateForLead(
  leadId: string
): Promise<{ error?: string; id?: string; created?: boolean }> {
  const { estimates } = await getEstimatesForLead(leadId);
  if (estimates.length > 0) return { id: estimates[0].id };

  const guard = await requireEstimateEditor();
  if ("error" in guard) return guard;

  const supabase = await createClient();
  const { data: lead } = await supabase
    .from("leads")
    .select("project_type")
    .eq("id", leadId)
    .eq("company_id", guard.companyId)
    .maybeSingle<{ project_type: string | null }>();

  const res = await createEstimate(leadId, lead?.project_type || "Estimate");
  if (res.error) return { error: res.error };
  return { id: res.id, created: true };
}

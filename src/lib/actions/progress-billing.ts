"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTwilioSms } from "@/lib/twilio-env";
import { getTwilioForCompany } from "@/lib/twilio-company";
import { createLoginToken, portalAccessExpiry, portalBaseUrl } from "@/lib/portal/session";
import { getCurrentProfile } from "@/lib/data/profile";
import {
  canCreateEstimates,
  defaultDueDate,
  moneyCents,
  paidTotalCents,
  type EstimateStatus,
  type PortalPayment,
} from "@/lib/data/types";

type PhaseRow = {
  id: string;
  company_id: string;
  estimate_id: string;
  name: string;
  amount_cents: number;
  requested_at: string | null;
  due_date: string | null;
};

type ParentEstimate = {
  id: string;
  lead_id: string;
  company_id: string;
  doc_number: string;
  title: string | null;
  status: EstimateStatus;
};

async function requireBiller(): Promise<{ error: string } | { companyId: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  // Billing a customer is an estimate-editing act, gated the same way.
  if (!canCreateEstimates(profile))
    return { error: "You don't have permission to bill on estimates." };
  return { companyId: profile.company_id };
}

/**
 * Bills one phase of the payment schedule.
 *
 * This is the moment a milestone becomes money: it stamps requested_at,
 * sets the due date, and texts the customer a link to pay. Until it runs
 * the phase is invisible in the portal, because "at completion of
 * rough-in" is due when the contractor says rough-in is done and nobody
 * else can know that.
 *
 * Ordering is not enforced. A contractor who finishes drywall before the
 * customer has paid for rough-in still needs to bill drywall, and
 * blocking that would just mean billing outside the system.
 */
export async function requestProgressPayment(
  phaseId: string,
  dueDate?: string
): Promise<{ error?: string; sentTo?: string }> {
  const guard = await requireBiller();
  if ("error" in guard) return guard;

  const admin = createAdminClient();
  const { data: phase } = await admin
    .from("estimate_payments")
    .select("id, company_id, estimate_id, name, amount_cents, requested_at, due_date")
    .eq("id", phaseId)
    .eq("company_id", guard.companyId)
    .maybeSingle<PhaseRow>();
  if (!phase) return { error: "That payment phase no longer exists." };
  if (phase.amount_cents <= 0) return { error: "This phase has no amount to bill." };

  const { data: estimate } = await admin
    .from("estimates")
    .select("id, lead_id, company_id, doc_number, title, status")
    .eq("id", phase.estimate_id)
    .eq("company_id", guard.companyId)
    .maybeSingle<ParentEstimate>();
  if (!estimate) return { error: "Contract not found." };
  // Only a signed contract can be billed against. A proposal the customer
  // has not agreed to is not a debt.
  if (estimate.status !== "Signed") {
    return { error: "This contract isn't signed yet, so there's nothing to bill against." };
  }

  const { data: settled } = await admin
    .from("portal_payments")
    .select("id")
    .eq("estimate_payment_id", phaseId)
    .eq("status", "succeeded")
    .maybeSingle();
  if (settled) return { error: "This phase has already been paid." };

  const { data: lead } = await admin
    .from("leads")
    .select("id, first_name, phone, company_id")
    .eq("id", estimate.lead_id)
    .maybeSingle<{ id: string; first_name: string | null; phone: string | null; company_id: string }>();
  if (!lead) return { error: "Customer not found." };
  if (!lead.phone) return { error: "This customer has no phone number on file." };

  const twilioEnv = await getTwilioForCompany(guard.companyId);
  if (!twilioEnv) return { error: "Texting isn't configured for this company yet." };

  const due = dueDate || phase.due_date || defaultDueDate();

  const { data: companyRow } = await admin
    .from("company_profile")
    .select("name")
    .eq("company_id", guard.companyId)
    .maybeSingle<{ name: string | null }>();
  const companyName = companyRow?.name || "Your contractor";

  // Sending the link grants portal access, same as sending the estimate --
  // otherwise the customer opens a link that refuses them.
  await admin
    .from("leads")
    .update({ portal_access_expires_at: portalAccessExpiry() })
    .eq("id", lead.id);

  const { token, error: tokenError } = await createLoginToken(lead.id, lead.company_id);
  if (tokenError || !token) return { error: tokenError || "Could not create a sign-in link." };

  const next = encodeURIComponent(`/portal/estimates/${estimate.id}`);
  const link = `${portalBaseUrl()}/portal/verify?token=${encodeURIComponent(token)}&next=${next}`;

  const dueLabel = new Date(`${due}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  // Plain hyphens, no emoji: either one flips the message to UCS-2 and
  // cuts each segment from 160 characters to 70.
  const body = `${companyName}: ${phase.name || "Progress payment"} on ${estimate.doc_number} is due ${dueLabel} - ${moneyCents(phase.amount_cents)}.\nPay here: ${link}`;

  const sent = await sendTwilioSms(lead.phone, body, twilioEnv);
  if (sent.error) return { error: `Text failed (${sent.error})` };

  // Stamped only after the text actually goes out. Marking a phase billed
  // when the customer was never told would put it on the overdue list for
  // a request they never received.
  const { data: updated, error } = await admin
    .from("estimate_payments")
    .update({ requested_at: new Date().toISOString(), due_date: due, updated_at: new Date().toISOString() })
    .eq("id", phaseId)
    .eq("company_id", guard.companyId)
    .select("id");
  if (error || !updated?.length) {
    return { error: "The text went out but the phase couldn't be marked billed. Check Payments." };
  }

  revalidatePath(`/estimates/${estimate.id}`);
  revalidatePath("/payments");
  return { sentTo: lead.phone };
}

/**
 * Un-bills a phase billed by mistake.
 *
 * Does not un-send the text -- nothing can -- so this only clears the
 * request from the record and takes the Pay button out of the portal.
 */
export async function cancelProgressRequest(
  phaseId: string
): Promise<{ error?: string; ok?: boolean }> {
  const guard = await requireBiller();
  if ("error" in guard) return guard;

  const admin = createAdminClient();
  const { data: payments } = await admin
    .from("portal_payments")
    .select("status, amount_cents")
    .eq("estimate_payment_id", phaseId)
    .returns<Pick<PortalPayment, "status" | "amount_cents">[]>();
  if (paidTotalCents(payments ?? []) > 0) {
    return { error: "This phase has already been paid, so it can't be un-billed." };
  }

  const { data: updated, error } = await admin
    .from("estimate_payments")
    .update({ requested_at: null, due_date: null, updated_at: new Date().toISOString() })
    .eq("id", phaseId)
    .eq("company_id", guard.companyId)
    .select("id, estimate_id");
  if (error || !updated?.length) return { error: "Couldn't update that phase." };

  revalidatePath(`/estimates/${updated[0].estimate_id}`);
  revalidatePath("/payments");
  return { ok: true };
}

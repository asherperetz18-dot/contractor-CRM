"use server";

import { companyToday } from "@/lib/data/company-today";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTwilioSms } from "@/lib/twilio-env";
import { getTwilioForSending } from "@/lib/twilio-company";
import { lockedServicesError } from "@/lib/billing/company-lock";
import { createLoginToken, portalAccessExpiry, portalBaseUrl } from "@/lib/portal/session";
import { getCurrentProfile } from "@/lib/data/profile";
import { getEmailForCompany } from "@/lib/email-company";
import { sendEmail } from "@/lib/email-env";
import { personName } from "@/lib/data/client-name";
import { paymentTermsLabel } from "@/lib/data/invoices";
import { invoicePdfAttachment } from "@/lib/pdf/invoice-attachment";
import {
  billChannelParts,
  billEmail,
  billRecipients,
  sentViaOf,
  type BillChannel,
} from "@/lib/bill-email";
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
  kind?: string | null;
  /** An invoice's terms (0205); absent before it ran. */
  payment_terms_days?: number | null;
};

async function requireBiller(): Promise<{ error: string } | { companyId: string; userId: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  // Billing a customer is an estimate-editing act, gated the same way.
  if (!canCreateEstimates(profile))
    return { error: "You don't have permission to bill on estimates." };
  return { companyId: profile.company_id, userId: profile.id };
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
 *
 * It goes by text, by email, or both (DECISIONS #150) -- an invoice by
 * email carries its PDF -- and the same call sends a billed one again.
 * Whatever went out is logged in the contact's messages, and recorded on
 * the bill (`sent_at`, `sent_via`) so the Invoices page can tell a bill
 * that was sent from one only marked billed.
 */
export async function requestProgressPayment(
  phaseId: string,
  dueDate?: string,
  channel: BillChannel = "text"
): Promise<{ error?: string; sentTo?: string; warning?: string }> {
  const guard = await requireBiller();
  if ("error" in guard) return guard;
  // Paused while the company's subscription is locked (DECISIONS #131).
  const locked = await lockedServicesError(guard.companyId);
  if (locked) return { error: locked };

  const admin = createAdminClient();
  const { data: phase } = await admin
    .from("estimate_payments")
    .select("id, company_id, estimate_id, name, amount_cents, requested_at, due_date")
    .eq("id", phaseId)
    .eq("company_id", guard.companyId)
    .maybeSingle<PhaseRow>();
  if (!phase) return { error: "That payment phase no longer exists." };
  if (phase.amount_cents <= 0) return { error: "This phase has no amount to bill." };

  // Every column, so an invoice's terms come along where 0205 has run
  // and nothing breaks where it hasn't.
  const { data: estimate } = await admin
    .from("estimates")
    .select("*")
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
    .select("id, contact_type, first_name, last_name, company_name, phone, email, second_contact_email, company_id")
    .eq("id", estimate.lead_id)
    .maybeSingle<{
      id: string;
      contact_type: string | null;
      first_name: string | null;
      last_name: string | null;
      company_name: string | null;
      phone: string | null;
      email: string | null;
      second_contact_email: string | null;
      company_id: string;
    }>();
  if (!lead) return { error: "Customer not found." };

  // What can go out, by the channels asked for. A text needs a number and
  // the company's Twilio; an email an address and an email sender.
  const want = billChannelParts(channel);
  const problems: string[] = [];
  const twilioEnv = want.text && lead.phone ? await getTwilioForSending(guard.companyId) : null;
  if (want.text && !lead.phone) problems.push("This customer has no phone number on file.");
  else if (want.text && !twilioEnv) problems.push("Texting isn't configured for this company yet.");
  const recipients = billRecipients(lead.email, lead.second_contact_email);
  const emailEnv = want.email && recipients.to.length ? await getEmailForCompany(guard.companyId) : null;
  if (want.email && !recipients.to.length) problems.push("This customer has no email address on file.");
  else if (want.email && !emailEnv) problems.push("Email isn't set up for this company yet.");
  if (!twilioEnv && !emailEnv) return { error: problems.join(" ") };

  const due = dueDate || phase.due_date || defaultDueDate(await companyToday());

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

  const sentTo: string[] = [];
  const logRows: { from_number: string; to_number: string; body: string; twilio_sid: string | null; channel: string }[] = [];
  let texted = false;
  let emailed = false;

  if (twilioEnv && lead.phone) {
    const dueLabel = new Date(`${due}T00:00:00`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    // Plain hyphens, no emoji: either one flips the message to UCS-2 and
    // cuts each segment from 160 characters to 70.
    const body = `${companyName}: ${phase.name || "Progress payment"} on ${estimate.doc_number} is due ${dueLabel} - ${moneyCents(phase.amount_cents)}.\nPay here: ${link}`;
    const sent = await sendTwilioSms(lead.phone, body, twilioEnv);
    if (sent.error) {
      problems.push(`Text failed (${sent.error})`);
    } else {
      texted = true;
      sentTo.push(lead.phone);
      logRows.push({ from_number: twilioEnv.phoneNumber, to_number: lead.phone, body, twilio_sid: sent.sid || null, channel: "sms" });
    }
  }

  if (emailEnv) {
    const isInvoice = estimate.kind === "invoice";
    const mail = billEmail({
      companyName,
      // To the person, as the estimate email greets them ("Hi Josh
      // Martinez"), whether or not the customer is a company.
      customerName: personName(lead) || null,
      isInvoice,
      docNumber: estimate.doc_number,
      title: estimate.title,
      stageName: isInvoice ? null : phase.name,
      amountCents: phase.amount_cents,
      dueDate: due,
      termsLabel: isInvoice ? paymentTermsLabel(estimate.payment_terms_days) : null,
      link,
    });
    // An invoice's own PDF goes with it; without one it still goes out.
    const pdf = isInvoice ? await invoicePdfAttachment(admin, guard.companyId, estimate.id, estimate.doc_number) : null;
    const sent = await sendEmail(recipients.to, mail.subject, mail.html, mail.text, {
      replyTo: emailEnv.replyTo ?? undefined,
      env: emailEnv,
      cc: recipients.cc,
      attachments: pdf ? [pdf] : undefined,
    });
    if (sent.error) {
      problems.push(`Email failed (${sent.error})`);
    } else {
      emailed = true;
      for (const addr of [...recipients.to, ...recipients.cc]) {
        sentTo.push(addr);
        logRows.push({ from_number: "email", to_number: addr, body: `[Bill emailed] ${mail.subject}`, twilio_sid: sent.id || null, channel: "email" });
      }
    }
  }

  // Nothing went out: say why, and leave the bill as it was.
  if (!texted && !emailed) return { error: problems.join(" ") || "Couldn't send it." };

  // In the contact's messages, where the team already looks for "did
  // they ever get anything?". Best effort: the send already happened.
  for (const row of logRows) {
    await admin.from("sms_messages").insert({
      lead_id: lead.id,
      direction: "outbound",
      sent_by: guard.userId,
      company_id: guard.companyId,
      ...row,
    });
  }

  // Stamped only after something actually went out. Marking a phase
  // billed when the customer was never told would put it on the overdue
  // list for a request they never received. A send of a bill already
  // billed keeps the day it was first billed.
  const now = new Date().toISOString();
  const { data: updated, error } = await admin
    .from("estimate_payments")
    .update({ requested_at: phase.requested_at ?? now, due_date: due, updated_at: now })
    .eq("id", phaseId)
    .eq("company_id", guard.companyId)
    .select("id");
  if (error || !updated?.length) {
    return { error: "It went out, but the phase couldn't be marked billed. Check Payments." };
  }
  // The send record (0206) is its own write: a database without it still
  // bills, it just can't show Sent.
  const via = sentViaOf(texted, emailed);
  await admin
    .from("estimate_payments")
    .update({ sent_at: now, sent_via: via })
    .eq("id", phaseId)
    .eq("company_id", guard.companyId);

  revalidatePath(`/estimates/${estimate.id}`);
  revalidatePath("/payments");
  revalidatePath("/invoices");
  return {
    sentTo: sentTo.join(", "),
    ...(problems.length ? { warning: `Sent to ${sentTo.join(", ")}, but: ${problems.join(" ")}` } : {}),
  };
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

/**
 * Marks a phase billed without texting anyone.
 *
 * Plenty of billing happens another way -- an invoice handed over on
 * site, a phone call, an email from the office. Forcing a text through
 * this app to record that would either send the customer a duplicate or
 * leave the phase permanently unbilled, and an unbilled phase never
 * appears on the Payments page or turns overdue.
 *
 * The sibling action stamps requested_at only after Twilio confirms,
 * precisely so nothing lands on the overdue list for a request the
 * customer never received. That reasoning does not disappear here -- it
 * moves: pressing this is the contractor asserting they told the
 * customer some other way, which is why the button says so plainly.
 *
 * Portal access is still granted. However they were told, they may well
 * pay online, and a Pay button that refuses them would be a strange
 * reward for it.
 */
export async function markProgressPaymentBilled(
  phaseId: string,
  dueDate?: string
): Promise<{ error?: string; ok?: boolean }> {
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

  const due = dueDate || phase.due_date || defaultDueDate(await companyToday());

  await admin
    .from("leads")
    .update({ portal_access_expires_at: portalAccessExpiry() })
    .eq("id", estimate.lead_id);

  const { data: updated, error } = await admin
    .from("estimate_payments")
    .update({
      requested_at: new Date().toISOString(),
      due_date: due,
      updated_at: new Date().toISOString(),
    })
    .eq("id", phaseId)
    .eq("company_id", guard.companyId)
    .select("id");
  if (error || !updated?.length) return { error: "Couldn't mark that phase billed." };

  revalidatePath(`/estimates/${estimate.id}`);
  revalidatePath("/payments");
  return { ok: true };
}

import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { lockedServicesError } from "@/lib/billing/company-lock";
import { getEmailForCompany } from "@/lib/email-company";
import { sendEmail } from "@/lib/email-env";
import { billRecipients } from "@/lib/bill-email";
import { personName } from "@/lib/data/client-name";
import { zoneForCompany } from "@/lib/data/company-today";
import { isoDateInZone } from "@/lib/company-clock";
import { receiptEmail, receiptFigures } from "@/lib/receipt-email";
import type { PortalPayment } from "@/lib/data/types";

/**
 * Emails the customer a receipt for money that has arrived
 * (DECISIONS #151).
 *
 * Two ways in. `automatic` is a payment made online: the Stripe webhook
 * sends one receipt when the money settles, if the company has receipts
 * switched on -- and only one, however many times Stripe delivers the
 * event, because the payment is claimed (`receipt_sent_at`, 0207) before
 * the email goes and released if it doesn't. By hand, someone on the
 * team asked for it (recording a payment, or Email receipt on Payments),
 * so it goes whenever asked: a receipt the customer lost is sent again.
 */

type Admin = ReturnType<typeof createAdminClient>;

type ReceiptPayment = Pick<PortalPayment, "id" | "estimate_id" | "kind" | "amount_cents" | "status" | "method" | "paid_at" | "created_at"> & {
  estimate_payment_id: string | null;
  lead_id: string | null;
  reference: string | null;
};

export type ReceiptResult = { sentTo?: string; error?: string; skipped?: string };

export async function sendPaymentReceipt(
  admin: Admin,
  paymentId: string,
  companyId: string,
  opts: { automatic: boolean; sentBy: string | null }
): Promise<ReceiptResult> {
  const { data: payment } = await admin
    .from("portal_payments")
    .select("id, estimate_id, estimate_payment_id, lead_id, kind, amount_cents, status, method, reference, paid_at, created_at")
    .eq("id", paymentId)
    .eq("company_id", companyId)
    .maybeSingle<ReceiptPayment>();
  if (!payment) return { error: "Payment not found." };
  // A receipt says the money arrived. A cheque not yet banked, or a bank
  // transfer still clearing, hasn't.
  if (payment.status !== "succeeded") return { error: "Only a payment that has arrived gets a receipt." };
  // A refund is money going back, not a payment received (#155).
  if (payment.amount_cents <= 0) return { error: "A refund doesn't get a payment receipt." };

  // Paused while the company's subscription is locked (DECISIONS #131).
  const locked = await lockedServicesError(companyId);
  if (locked) return { error: locked };

  if (opts.automatic) {
    // The company's switch (0207). Read on its own, so a database without
    // it doesn't break the rest -- the claim below needs 0207 anyway.
    const { data: setting } = await admin
      .from("company_profile")
      .select("receipt_emails_enabled")
      .eq("company_id", companyId)
      .maybeSingle<{ receipt_emails_enabled: boolean | null }>();
    if (setting?.receipt_emails_enabled === false) return { skipped: "Receipts are switched off." };
  }

  const { data: doc } = await admin
    .from("estimates")
    .select("id, lead_id, doc_number, title, kind, total_cents")
    .eq("id", payment.estimate_id)
    .eq("company_id", companyId)
    .maybeSingle<{ id: string; lead_id: string; doc_number: string; title: string | null; kind: string | null; total_cents: number }>();
  if (!doc) return { error: "The document this payment is for wasn't found." };

  const { data: lead } = await admin
    .from("leads")
    .select("id, contact_type, first_name, last_name, company_name, email, second_contact_email")
    .eq("id", payment.lead_id ?? doc.lead_id)
    .eq("company_id", companyId)
    .maybeSingle<{
      id: string;
      contact_type: string | null;
      first_name: string | null;
      last_name: string | null;
      company_name: string | null;
      email: string | null;
      second_contact_email: string | null;
    }>();
  if (!lead) return { error: "Customer not found." };

  const recipients = billRecipients(lead.email, lead.second_contact_email);
  if (!recipients.to.length) return { error: "This customer has no email address on file." };
  const emailEnv = await getEmailForCompany(companyId);
  if (!emailEnv) return { error: "Email isn't set up for this company yet." };

  const [{ data: stage }, { data: docPayments }, { data: company }, zone] = await Promise.all([
    payment.estimate_payment_id
      ? admin
          .from("estimate_payments")
          .select("*")
          .eq("id", payment.estimate_payment_id)
          .eq("company_id", companyId)
          .maybeSingle<{ id: string; name: string | null; sort_order: number; amount_cents: number; requested_at: string | null }>()
      : Promise.resolve({ data: null }),
    admin
      .from("portal_payments")
      .select("estimate_payment_id, status, amount_cents")
      .eq("estimate_id", doc.id)
      .eq("company_id", companyId)
      .returns<(Pick<PortalPayment, "status" | "amount_cents"> & { estimate_payment_id: string | null })[]>(),
    admin.from("company_profile").select("name").eq("company_id", companyId).maybeSingle<{ name: string | null }>(),
    zoneForCompany(admin, companyId),
  ]);

  const companyName = company?.name || "Your contractor";
  const isInvoice = doc.kind === "invoice";
  const figures = receiptFigures(stage ?? null, docPayments ?? []);
  const mail = receiptEmail({
    companyName,
    customerName: personName(lead) || null,
    amountCents: payment.amount_cents,
    paidOn: isoDateInZone(new Date(payment.paid_at ?? payment.created_at), zone),
    method: payment.method,
    reference: payment.reference,
    isInvoice,
    isDeposit: !payment.estimate_payment_id,
    docNumber: doc.doc_number,
    title: doc.title,
    stageName: stage ? stage.name || `Phase ${stage.sort_order + 1}` : null,
    stageOwedCents: figures.stageOwedCents,
    paidToDateCents: figures.paidToDateCents,
    totalCents: doc.total_cents,
  });

  const now = new Date().toISOString();
  if (opts.automatic) {
    // Claimed before it goes: Stripe can deliver the same event twice at
    // once, and both must not send. Without 0207 nothing can be claimed,
    // so nothing goes automatically.
    const { data: claimed, error } = await admin
      .from("portal_payments")
      .update({ receipt_sent_at: now })
      .eq("id", payment.id)
      .eq("company_id", companyId)
      .is("receipt_sent_at", null)
      .select("id");
    if (error || !claimed?.length) return { skipped: "A receipt was already sent." };
  }

  const sent = await sendEmail(recipients.to, mail.subject, mail.html, mail.text, {
    replyTo: emailEnv.replyTo ?? undefined,
    env: emailEnv,
    cc: recipients.cc,
  });
  if (sent.error) {
    // Not sent, so not claimed: a later delivery of the event may try again.
    if (opts.automatic) {
      await admin
        .from("portal_payments")
        .update({ receipt_sent_at: null })
        .eq("id", payment.id)
        .eq("company_id", companyId);
    }
    return { error: `The receipt couldn't be emailed (${sent.error}).` };
  }

  // Sent by hand: recorded afterwards, its own write, so a database
  // without 0207 still sends.
  if (!opts.automatic) {
    await admin
      .from("portal_payments")
      .update({ receipt_sent_at: now })
      .eq("id", payment.id)
      .eq("company_id", companyId);
  }

  // In the contact's messages, where the team already looks for "did
  // they ever get anything?". Best effort: the email already went.
  const sentTo = [...recipients.to, ...recipients.cc];
  for (const addr of sentTo) {
    await admin.from("sms_messages").insert({
      lead_id: lead.id,
      direction: "outbound",
      from_number: "email",
      to_number: addr,
      body: `[Receipt emailed] ${mail.subject}`,
      twilio_sid: sent.id || null,
      channel: "email",
      sent_by: opts.sentBy,
      company_id: companyId,
    });
  }
  return { sentTo: sentTo.join(", ") };
}

/**
 * The automatic receipts for one Stripe checkout: every payment it
 * settled. Never throws -- the webhook answering Stripe matters more.
 */
export async function sendAutomaticReceipts(admin: Admin, sessionId: string, companyId?: string): Promise<void> {
  let query = admin
    .from("portal_payments")
    .select("id, company_id")
    .eq("stripe_session_id", sessionId)
    .eq("status", "succeeded");
  if (companyId) query = query.eq("company_id", companyId);
  const { data } = await query.returns<{ id: string; company_id: string }[]>();
  for (const row of data ?? []) {
    try {
      await sendPaymentReceipt(admin, row.id, row.company_id, { automatic: true, sentBy: null });
    } catch {
      // One payment's receipt failing doesn't stop the next.
    }
  }
}

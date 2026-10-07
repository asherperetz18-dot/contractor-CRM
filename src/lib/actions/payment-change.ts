"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile, type Profile } from "@/lib/data/profile";
import { canCreateEstimates, canManageBills, depositCents } from "@/lib/data/types";
import { isMissingSchemaError } from "@/lib/schema-drift";
import { lockedServicesError } from "@/lib/billing/company-lock";
import { getEmailForCompany } from "@/lib/email-company";
import { sendEmail } from "@/lib/email-env";
import { sendTwilioSms } from "@/lib/twilio-env";
import { getTwilioForSending } from "@/lib/twilio-company";
import { personName } from "@/lib/data/client-name";
import { createLoginToken, portalAccessExpiry, portalBaseUrl } from "@/lib/portal/session";
import { estimateLender, financingOffered, readFinancing } from "@/lib/financing";
import {
  openPaymentChange,
  paymentChangeEmail,
  paymentChangeFigures,
  paymentChangeSms,
  type PaymentChangeRow,
} from "@/lib/payment-change";
import { recordFinancingStatus } from "@/lib/actions/financing";

/**
 * Switching a signed contract to financing (DECISIONS #166), the office's
 * side: send the customer the payment change to sign, cancel one not
 * signed yet, or put the original schedule back. The customer signs it on
 * their customer page (`signPaymentChange` in portal-estimates.ts). No
 * stage is ever changed here: while a change is signed, billing, the
 * reminder job and the customer page leave the contract's payments to the
 * lender (lib/data/financed-contracts.ts), and ending it is all it takes
 * to put everything back.
 */

const NEEDS_0217 = "Switching to financing needs a database update first: run 0217_contract_payment_changes.sql in Supabase.";

const canWorkFinancing = (p: Profile) => canCreateEstimates(p) || canManageBills(p);

type Admin = ReturnType<typeof createAdminClient>;

type ContractRow = {
  id: string;
  company_id: string;
  lead_id: string;
  doc_number: string;
  kind: string | null;
  status: string;
  total_cents: number;
  deposit_percent_bp: number;
  deposit_cap_cents: number;
  /** Who is financing it (0218, DECISIONS #168); absent before 0218. */
  financing_source?: string | null;
  financing_lender?: string | null;
  /** Offered to this customer (0219, #169); absent before 0219. */
  financing_offered?: boolean | null;
};

async function loadContract(admin: Admin, estimateId: string, companyId: string) {
  // Every column, so the lender choice (0218) comes along where it exists.
  const { data } = await admin
    .from("estimates")
    .select("*")
    .eq("id", estimateId)
    .eq("company_id", companyId)
    .maybeSingle<ContractRow>();
  return data;
}

/** The contract's payment changes, or the 0217 message before it's run. */
async function changesOf(admin: Admin, estimateId: string): Promise<{ rows: PaymentChangeRow[] } | { error: string }> {
  const { data, error } = await admin
    .from("contract_payment_changes")
    .select("*")
    .eq("estimate_id", estimateId)
    .order("created_at")
    .returns<PaymentChangeRow[]>();
  if (error) return { error: isMissingSchemaError(error) ? NEEDS_0217 : error.message };
  return { rows: data ?? [] };
}

/** What's paid and what's left on the contract, as a funded loan sees it. */
async function figuresFor(admin: Admin, doc: ContractRow) {
  const [{ data: stages }, { data: payments }] = await Promise.all([
    admin
      .from("estimate_payments")
      .select("*")
      .eq("estimate_id", doc.id)
      .eq("company_id", doc.company_id)
      .returns<
        {
          id: string;
          name: string;
          sort_order: number;
          amount_cents: number;
          credit_cents?: number | null;
          cancelled_at?: string | null;
          requested_at?: string | null;
        }[]
      >(),
    admin
      .from("portal_payments")
      .select("estimate_payment_id, kind, status, amount_cents, stripe_session_id, stripe_payment_intent_id")
      .eq("estimate_id", doc.id)
      .returns<
        {
          estimate_payment_id: string | null;
          kind: string;
          status: string;
          amount_cents: number;
          stripe_session_id: string | null;
          stripe_payment_intent_id: string | null;
        }[]
      >(),
  ]);
  return paymentChangeFigures({
    depositDueCents: depositCents(doc.total_cents, doc.deposit_percent_bp, doc.deposit_cap_cents),
    stages: stages ?? [],
    payments: payments ?? [],
  });
}

export async function sendPaymentChange(input: {
  estimateId: string;
  channel: "text" | "email";
  /** Also send the lender's application link (recorded as Link sent). */
  withApplyLink?: boolean;
  /** With the lender's link: a follow-up task this many days out (#164). */
  remindInDays?: number | null;
}): Promise<{ error?: string; sentBy?: string; warning?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canWorkFinancing(profile)) return { error: "Only people who work estimates or record payments can do this." };
  if (input.channel !== "text" && input.channel !== "email") return { error: "Pick text or email." };
  // Paused while the company's subscription is locked (DECISIONS #131).
  const locked = await lockedServicesError(profile.company_id);
  if (locked) return { error: locked };

  const admin = createAdminClient();
  const doc = await loadContract(admin, input.estimateId, profile.company_id);
  if (!doc) return { error: "That contract no longer exists." };
  if ((doc.kind ?? "contract") !== "contract") return { error: "Only a contract can be switched to financing." };
  if (doc.status !== "Signed") return { error: "Only a signed contract can be switched to financing." };

  const [{ data: company }, { data: lead }, changes] = await Promise.all([
    admin
      // Every column: the offer default (0219) where it exists.
      .from("company_profile")
      .select("*")
      .eq("company_id", profile.company_id)
      .maybeSingle<{
        name: string | null;
        financing_provider: string | null;
        financing_url: string | null;
        financing_offer_default?: boolean | null;
      }>(),
    admin
      .from("leads")
      .select("id, company_id, contact_type, first_name, last_name, email, phone")
      .eq("id", doc.lead_id)
      .eq("company_id", profile.company_id)
      .maybeSingle<{
        id: string;
        company_id: string;
        contact_type: string | null;
        first_name: string | null;
        last_name: string | null;
        email: string | null;
        phone: string | null;
      }>(),
    changesOf(admin, doc.id),
  ]);
  if ("error" in changes) return { error: changes.error };
  // The lender this job is financed through (#168): the company's, or the
  // customer's own -- which has no link to apply with.
  const financing = estimateLender(
    { source: doc.financing_source ?? null, lender: doc.financing_lender ?? null },
    readFinancing(company)
  );
  if (!financing) {
    return {
      error:
        doc.financing_source === "none"
          ? "This job is marked as not financing. Pick who is financing it first."
          : "Add your lender's link under Settings › Customer Financing first, or pick the customer's own lender.",
    };
  }
  if (!lead) return { error: "Customer not found." };
  if (input.channel === "text" && !lead.phone) return { error: "This customer has no phone number on file." };
  if (input.channel === "email" && !lead.email) return { error: "This customer has no email address on file." };

  const open = openPaymentChange(changes.rows);
  if (open?.status === "signed") return { error: "This contract is already paying with financing." };
  const figures = await figuresFor(admin, doc);
  if (figures.financeCents <= 0) return { error: "Nothing is left to pay on this contract." };

  // What the customer is asked to sign, as it stands now. Sending again
  // brings a change still waiting up to date.
  const terms = {
    lender: financing.name,
    total_cents: figures.totalCents,
    paid_cents: figures.paidCents,
    finance_cents: figures.financeCents,
  };
  let changeId: string;
  let fresh = false;
  if (open) {
    const { error } = await admin.from("contract_payment_changes").update(terms).eq("id", open.id).eq("status", "sent");
    if (error) return { error: error.message };
    changeId = open.id;
  } else {
    const { data: made, error } = await admin
      .from("contract_payment_changes")
      .insert({
        company_id: doc.company_id,
        estimate_id: doc.id,
        status: "sent",
        created_by: profile.id,
        ...terms,
        // Only when it is: a database without 0218 has no such column.
        ...(financing.own ? { own_lender: true } : {}),
      })
      .select("id")
      .single<{ id: string }>();
    if (error || !made) {
      return { error: error?.code === "23505" ? "A payment change for this contract is already waiting." : error?.message || "It couldn't be saved." };
    }
    changeId = made.id;
    fresh = true;
  }

  // Their customer page, opened at the contract, where they sign.
  await admin.from("leads").update({ portal_access_expires_at: portalAccessExpiry() }).eq("id", lead.id);
  const issued = await createLoginToken(lead.id, lead.company_id);
  const companyName = company?.name || "Your contractor";
  let problem: string | null = null;
  let sentApplyLink = false;
  if (!issued.token) {
    problem = issued.error || "the sign-in link couldn't be made";
  } else {
    const link = `${portalBaseUrl()}/portal/verify?token=${encodeURIComponent(issued.token)}&next=${encodeURIComponent(`/portal/estimates/${doc.id}`)}`;
    // The lender's link only goes to a customer it's offered to (#169).
    const offered = financingOffered(doc.financing_offered, company?.financing_offer_default);
    const applyUrl = input.withApplyLink && offered ? financing.applyUrl : null;
    sentApplyLink = !!applyUrl;
    const words = {
      companyName,
      docNumber: doc.doc_number,
      lender: financing.name,
      financeCents: figures.financeCents,
      link,
      applyUrl,
      ownLender: financing.own,
    };
    if (input.channel === "email") {
      const mail = paymentChangeEmail({ ...words, customerName: personName(lead) || null });
      const emailEnv = await getEmailForCompany(profile.company_id);
      if (!emailEnv) {
        problem = "email isn't set up for this company yet";
      } else {
        const sent = await sendEmail(lead.email!, mail.subject, mail.html, mail.text, {
          env: emailEnv,
          replyTo: emailEnv.replyTo ?? undefined,
        });
        if (sent.error) problem = `the email failed (${sent.error})`;
        else
          await admin.from("sms_messages").insert({
            lead_id: lead.id,
            direction: "outbound",
            from_number: "email",
            to_number: lead.email,
            sent_by: profile.id,
            body: `[Payment change emailed] ${mail.subject}`,
            twilio_sid: sent.id || null,
            channel: "email",
            company_id: profile.company_id,
          });
      }
    } else {
      const twilioEnv = await getTwilioForSending(profile.company_id);
      if (!twilioEnv) {
        problem = "texting isn't set up for this company yet";
      } else {
        const body = paymentChangeSms(words);
        const sent = await sendTwilioSms(lead.phone!, body, twilioEnv);
        if (sent.error) problem = `the text failed (${sent.error})`;
        else
          await admin.from("sms_messages").insert({
            lead_id: lead.id,
            direction: "outbound",
            from_number: twilioEnv.phoneNumber,
            to_number: lead.phone,
            sent_by: profile.id,
            body,
            twilio_sid: sent.sid || null,
            channel: "sms",
            company_id: profile.company_id,
          });
      }
    }
  }

  if (problem) {
    // Nothing reached the customer: a change made just now goes too, so
    // there's nothing waiting on a signature nobody was asked for.
    if (fresh) await admin.from("contract_payment_changes").delete().eq("id", changeId).eq("status", "sent");
    return { error: `It wasn't sent: ${problem}.` };
  }

  // The lender's link went with it: a step on the estimate (#162), with
  // its follow-up (#164). Best effort -- the payment change already went.
  let warning: string | undefined;
  if (sentApplyLink) {
    const step = await recordFinancingStatus({
      estimateId: doc.id,
      status: "sent",
      note: "Sent with the payment change.",
      remindInDays: input.remindInDays ?? null,
    });
    if (step.error) warning = `Sent, but it isn't on the financing steps: ${step.error}`;
  }

  revalidatePath(`/estimates/${doc.id}`);
  return { sentBy: input.channel, warning };
}

/** Takes back a payment change the customer hasn't signed. */
export async function cancelPaymentChange(estimateId: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canWorkFinancing(profile)) return { error: "Only people who work estimates or record payments can do this." };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("contract_payment_changes")
    .update({ status: "cancelled", ended_at: new Date().toISOString(), ended_by: profile.id })
    .eq("estimate_id", estimateId)
    .eq("company_id", profile.company_id)
    .eq("status", "sent")
    .select("id");
  if (error) return { error: isMissingSchemaError(error) ? NEEDS_0217 : error.message };
  if (!data?.length) return { error: "There's no payment change waiting on this contract. It may have just been signed." };
  revalidatePath(`/estimates/${estimateId}`);
  return {};
}

/**
 * Back to the original schedule: the lender declined, or the customer
 * changed their mind. The change ends; billing, reminders and the
 * customer's Pay buttons pick up where they were.
 */
export async function revertPaymentChange(estimateId: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canWorkFinancing(profile)) return { error: "Only people who work estimates or record payments can do this." };
  const admin = createAdminClient();
  const doc = await loadContract(admin, estimateId, profile.company_id);
  if (!doc) return { error: "That contract no longer exists." };
  const { data, error } = await admin
    .from("contract_payment_changes")
    .update({ status: "reverted", ended_at: new Date().toISOString(), ended_by: profile.id })
    .eq("estimate_id", estimateId)
    .eq("company_id", profile.company_id)
    .eq("status", "signed")
    .select("lender");
  if (error) return { error: isMissingSchemaError(error) ? NEEDS_0217 : error.message };
  if (!data?.length) return { error: "This contract isn't paying with financing." };

  await admin.from("lead_notes").insert({
    company_id: profile.company_id,
    lead_id: doc.lead_id,
    author_id: profile.id,
    body: `${doc.doc_number} is back on its original payment schedule (no longer paying through ${(data[0] as { lender: string }).lender}).`,
  });

  revalidatePath(`/estimates/${estimateId}`);
  revalidatePath("/invoices");
  revalidatePath("/collect");
  return {};
}

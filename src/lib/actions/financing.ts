"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile, type Profile } from "@/lib/data/profile";
import { canCreateEstimates, canManageBills, isAdminRole } from "@/lib/data/types";
import { isMissingSchemaError } from "@/lib/schema-drift";
import { lockedServicesError } from "@/lib/billing/company-lock";
import { getEmailForCompany } from "@/lib/email-company";
import { sendEmail } from "@/lib/email-env";
import { sendTwilioSms } from "@/lib/twilio-env";
import { getTwilioForSending } from "@/lib/twilio-company";
import { personName } from "@/lib/data/client-name";
import { advanceStageOnFinancing } from "@/lib/pipeline/advance-stage";
import {
  FINANCING_STATUS_LABEL,
  financingEmail,
  financingEventError,
  financingSettingsError,
  financingText,
  movesToPendingFinance,
  readFinancing,
  type FinancingStatus,
} from "@/lib/financing";

/**
 * The company's customer financing (DECISIONS #161): the lender it uses
 * and the application link that lender gave it. Office or Admin set it,
 * like the rest of the company's settings.
 */

const NEEDS_0214 = "Financing needs a database update first: run 0214_customer_financing.sql in Supabase.";

export type FinancingSettings = { provider: string; url: string; ready: boolean };

export async function getFinancingSettings(): Promise<FinancingSettings | null> {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminRole(profile)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_profile")
    .select("financing_provider, financing_url")
    .eq("company_id", profile.company_id)
    .maybeSingle<{ financing_provider: string | null; financing_url: string | null }>();
  return {
    provider: data?.financing_provider ?? "",
    url: data?.financing_url ?? "",
    ready: !error,
  };
}

export async function saveFinancingSettings(input: { provider: string; url: string }): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can change this." };
  const why = financingSettingsError(input);
  if (why) return { error: why };
  const provider = input.provider.trim();
  const url = input.url.trim();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_profile")
    .update({ financing_provider: provider || null, financing_url: url || null })
    .eq("company_id", profile.company_id)
    .select("company_id");
  if (error) return { error: isMissingSchemaError(error) ? NEEDS_0214 : error.message };
  if (!data?.length) return { error: "That change couldn't be saved." };

  revalidatePath("/settings/customer-financing");
  return {};
}

// ---------------------------------------------------------------------
// On the estimate (DECISIONS #162): send the customer the link, and keep
// track of where the application stands. The people who work estimates
// or record payments; the lender's answer is entered by hand.

const NEEDS_0215 = "Financing tracking needs a database update first: run 0215_estimate_financing.sql in Supabase.";

const canWorkFinancing = (p: Profile) => canCreateEstimates(p) || canManageBills(p);

type FinancingDoc = {
  id: string;
  company_id: string;
  lead_id: string;
  doc_number: string;
  title: string | null;
  kind: string | null;
  status: string;
};

/** The estimate, if it's this company's and one financing goes with:
 *  an estimate, contract or change order that's out, not a draft or one
 *  closed. */
async function financingDoc(admin: ReturnType<typeof createAdminClient>, estimateId: string, companyId: string) {
  const { data } = await admin
    .from("estimates")
    .select("id, company_id, lead_id, doc_number, title, kind, status")
    .eq("id", estimateId)
    .eq("company_id", companyId)
    .maybeSingle<FinancingDoc>();
  if (!data) return { error: "That estimate no longer exists." as const };
  const kind = data.kind ?? "contract";
  if (kind !== "contract" && kind !== "change_order") return { error: "Financing goes with an estimate or contract." as const };
  if (data.status === "Draft") return { error: "Send the estimate first." as const };
  if (data.status === "Void" || data.status === "Declined") return { error: "This estimate is closed." as const };
  return { doc: data };
}

export async function recordFinancingStatus(input: {
  estimateId: string;
  status: string;
  amountCents?: number | null;
  note?: string | null;
}): Promise<{ error?: string; ok?: boolean; movedTo?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canWorkFinancing(profile)) return { error: "Only people who work estimates or record payments can do this." };
  const why = financingEventError(input);
  if (why) return { error: why };
  const status = input.status as FinancingStatus;

  const admin = createAdminClient();
  const found = await financingDoc(admin, input.estimateId, profile.company_id);
  if ("error" in found) return { error: found.error };
  const doc = found.doc;

  const { error } = await admin.from("estimate_financing_events").insert({
    company_id: profile.company_id,
    estimate_id: doc.id,
    status,
    amount_cents: input.amountCents ?? null,
    note: input.note?.trim() || null,
    created_by: profile.id,
  });
  if (error) return { error: isMissingSchemaError(error) ? NEEDS_0215 : error.message };

  // Applied or approved: the lead is at Pending Finance (by its tag, so
  // under whatever this company calls it), unless it's further along.
  let movedTo: string | undefined;
  const { data: lead } = await admin
    .from("leads")
    .select("stage_key")
    .eq("id", doc.lead_id)
    .eq("company_id", profile.company_id)
    .maybeSingle<{ stage_key: string | null }>();
  if (lead && movesToPendingFinance(status, lead.stage_key)) {
    const move = await advanceStageOnFinancing(admin, doc.lead_id, profile.company_id);
    if (move.moved && move.to) {
      movedTo = move.to;
      await admin.from("lead_notes").insert({
        company_id: profile.company_id,
        lead_id: doc.lead_id,
        author_id: profile.id,
        body: `Moved to ${move.to}: financing ${FINANCING_STATUS_LABEL[status].toLowerCase()} on ${doc.doc_number}.`,
      });
    }
  }

  revalidatePath(`/estimates/${doc.id}`);
  revalidatePath("/pipeline");
  return { ok: true, movedTo };
}

export async function sendFinancingLink(input: {
  estimateId: string;
  channel: "text" | "email" | "both";
}): Promise<{ error?: string; sentBy?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canWorkFinancing(profile)) return { error: "Only people who work estimates or record payments can do this." };
  if (!["text", "email", "both"].includes(input.channel)) return { error: "Pick text or email." };
  // Paused while the company's subscription is locked (DECISIONS #131).
  const locked = await lockedServicesError(profile.company_id);
  if (locked) return { error: locked };

  const admin = createAdminClient();
  const found = await financingDoc(admin, input.estimateId, profile.company_id);
  if ("error" in found) return { error: found.error };
  const doc = found.doc;

  const [{ data: company }, { data: lead }] = await Promise.all([
    admin
      .from("company_profile")
      .select("name, financing_provider, financing_url")
      .eq("company_id", profile.company_id)
      .maybeSingle<{ name: string | null; financing_provider: string | null; financing_url: string | null }>(),
    admin
      .from("leads")
      .select("id, contact_type, first_name, last_name, email, phone")
      .eq("id", doc.lead_id)
      .eq("company_id", profile.company_id)
      .maybeSingle<{
        id: string;
        contact_type: string | null;
        first_name: string | null;
        last_name: string | null;
        email: string | null;
        phone: string | null;
      }>(),
  ]);
  const financing = readFinancing(company);
  if (!financing) return { error: "Add your lender's link under Settings › Customer Financing first." };
  if (!lead) return { error: "Customer not found." };
  const companyName = company?.name || "Your contractor";

  const wantText = input.channel !== "email";
  const wantEmail = input.channel !== "text";
  if (wantText && !lead.phone) return { error: "This customer has no phone number on file." };
  if (wantEmail && !lead.email) return { error: "This customer has no email address on file." };

  const went: ("text" | "email")[] = [];
  const problems: string[] = [];

  if (wantEmail && lead.email) {
    const mail = financingEmail({
      companyName,
      customerName: personName(lead) || null,
      provider: financing.provider,
      url: financing.url,
      docNumber: doc.doc_number,
      title: doc.title,
    });
    const emailEnv = await getEmailForCompany(profile.company_id);
    if (!emailEnv) {
      problems.push("email isn't set up for this company yet");
    } else {
      const sent = await sendEmail(lead.email, mail.subject, mail.html, mail.text, {
        env: emailEnv,
        replyTo: emailEnv.replyTo ?? undefined,
      });
      if (sent.error) {
        problems.push(`the email failed (${sent.error})`);
      } else {
        went.push("email");
        await admin.from("sms_messages").insert({
          lead_id: lead.id,
          direction: "outbound",
          from_number: "email",
          to_number: lead.email,
          sent_by: profile.id,
          body: `[Financing link emailed] ${mail.subject}`,
          twilio_sid: sent.id || null,
          channel: "email",
          company_id: profile.company_id,
        });
      }
    }
  }

  if (wantText && lead.phone) {
    const twilioEnv = await getTwilioForSending(profile.company_id);
    if (!twilioEnv) {
      problems.push("texting isn't set up for this company yet");
    } else {
      const body = financingText({ companyName, provider: financing.provider, url: financing.url, docNumber: doc.doc_number });
      const sent = await sendTwilioSms(lead.phone, body, twilioEnv);
      if (sent.error) {
        problems.push(`the text failed (${sent.error})`);
      } else {
        went.push("text");
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

  if (!went.length) return { error: `The link wasn't sent: ${problems.join("; ")}.` };

  // A step of its own on the estimate. Best effort: the link already went.
  await admin.from("estimate_financing_events").insert({
    company_id: profile.company_id,
    estimate_id: doc.id,
    status: "sent",
    channel: went.length === 2 ? "both" : went[0],
    created_by: profile.id,
  });

  revalidatePath(`/estimates/${doc.id}`);
  const sentBy = went.length === 2 ? "text and email" : went[0];
  return problems.length ? { sentBy, error: `Sent by ${sentBy}, but ${problems.join("; ")}.` } : { sentBy };
}

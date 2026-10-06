"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { canManageBills } from "@/lib/data/types";
import { companyToday, getCompanyZone } from "@/lib/data/company-today";
import { personName } from "@/lib/data/client-name";
import { loadCustomerStatement } from "@/lib/data/load-customer-statement";
import { statementEmail } from "@/lib/data/customer-statement";
import { lockedServicesError } from "@/lib/billing/company-lock";
import { billRecipients } from "@/lib/bill-email";
import { getEmailForCompany } from "@/lib/email-company";
import { sendEmail } from "@/lib/email-env";
import { createLoginToken, portalAccessExpiry, portalBaseUrl } from "@/lib/portal/session";

/**
 * Emails a customer their statement (DECISIONS #153): the balance, what
 * is past due, and every bill and payment, with the View and pay link
 * when something is owed. Gated like recording a payment -- it's the
 * company's money, said to the customer -- and logged in their messages.
 */
export async function emailCustomerStatement(leadId: string): Promise<{ error?: string; sentTo?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canManageBills(profile)) {
    return { error: "Only Bookkeeping, Office or Admin users can send a statement." };
  }
  // Paused while the company's subscription is locked (DECISIONS #131).
  const locked = await lockedServicesError(profile.company_id);
  if (locked) return { error: locked };

  const supabase = await createClient();
  const { data: lead } = await supabase
    .from("leads")
    .select("id, contact_type, first_name, last_name, email, second_contact_email, portal_payments_disabled")
    .eq("id", leadId)
    .eq("company_id", profile.company_id)
    .maybeSingle<{
      id: string;
      contact_type: string | null;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      second_contact_email: string | null;
      portal_payments_disabled: boolean | null;
    }>();
  if (!lead) return { error: "Customer not found." };

  const recipients = billRecipients(lead.email, lead.second_contact_email);
  if (!recipients.to.length) return { error: "This customer has no email address on file." };
  const emailEnv = await getEmailForCompany(profile.company_id);
  if (!emailEnv) return { error: "Email isn't set up for this company yet." };

  const [today, zone, { data: company }] = await Promise.all([
    companyToday(),
    getCompanyZone(),
    supabase.from("company_profile").select("name").eq("company_id", profile.company_id).maybeSingle<{ name: string | null }>(),
  ]);
  const statement = await loadCustomerStatement(supabase, profile.company_id, lead.id, { today, zone });

  // The link only when something is owed and they pay through the CRM; it
  // signs them in, so it grants portal access the way a bill does.
  let link: string | null = null;
  if (statement.balanceCents > 0 && !lead.portal_payments_disabled) {
    const admin = createAdminClient();
    await admin
      .from("leads")
      .update({ portal_access_expires_at: portalAccessExpiry() })
      .eq("id", lead.id)
      .eq("company_id", profile.company_id);
    const { token } = await createLoginToken(lead.id, profile.company_id);
    if (token) link = `${portalBaseUrl()}/portal/verify?token=${encodeURIComponent(token)}`;
  }

  const companyName = company?.name || "Your contractor";
  const mail = statementEmail({ companyName, customerName: personName(lead) || null, today, statement, link });
  const sent = await sendEmail(recipients.to, mail.subject, mail.html, mail.text, {
    replyTo: emailEnv.replyTo ?? undefined,
    env: emailEnv,
    cc: recipients.cc,
  });
  if (sent.error) return { error: `The statement couldn't be emailed (${sent.error}).` };

  // In the contact's messages, where the team already looks. Best effort:
  // the email already went.
  const admin = createAdminClient();
  const sentTo = [...recipients.to, ...recipients.cc];
  for (const addr of sentTo) {
    await admin.from("sms_messages").insert({
      lead_id: lead.id,
      direction: "outbound",
      from_number: "email",
      to_number: addr,
      body: `[Statement emailed] ${mail.subject}`,
      twilio_sid: sent.id || null,
      channel: "email",
      sent_by: profile.id,
      company_id: profile.company_id,
    });
  }
  return { sentTo: sentTo.join(", ") };
}

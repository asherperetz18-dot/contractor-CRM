import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { sendTwilioSms } from "@/lib/twilio-env";
import { getTwilioForCompany } from "@/lib/twilio-company";
import { normalizePhone } from "@/lib/data/types";

export type NewLeadAlertInput = {
  companyId: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  projectType: string | null;
  source: string | null;
  notes: string | null;
};

type AlertConfig = {
  new_lead_alert_phones: string | null;
  new_lead_alert_daily_cap: number;
  new_lead_alert_count: number;
  new_lead_alert_count_date: string | null;
};

/**
 * Splits the configured recipient list. Deliberately forgiving about
 * separators -- this is a field someone types phone numbers into, and a
 * newline instead of a comma shouldn't silently drop a recipient.
 */
export function parseAlertPhones(raw: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,;\n]/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    // De-duplicated on digits, so "424-768-2268" and "4247682268" listed
    // twice don't text the same handset twice per lead.
    const key = normalizePhone(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/**
 * The alert body. Plain ASCII throughout: an en dash or a curly quote
 * would re-encode the whole message as UCS-2 and cut each segment from
 * 160 characters to 70 (see formatTimeRange / sms-segments).
 */
export function buildNewLeadAlert(lead: NewLeadAlertInput): string {
  const name = `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim();
  const lines = [
    `New lead${lead.source ? ` from ${lead.source}` : ""}`,
    name ? `Name: ${name}` : "",
    lead.phone ? `Phone: ${lead.phone}` : "",
    lead.email ? `Email: ${lead.email}` : "",
    lead.address ? `Address: ${lead.address}` : "",
    lead.projectType ? `Project: ${lead.projectType}` : "",
    lead.notes ? `Notes: ${lead.notes.slice(0, 120)}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

/**
 * Texts the company's alert numbers about a lead that just arrived.
 *
 * Best-effort by design: the lead is already saved before this runs, so a
 * Twilio outage or a bad number must never fail the intake and make Meta
 * or Zapier retry a lead that landed fine.
 */
export async function notifyNewLead(
  admin: ReturnType<typeof createAdminClient>,
  lead: NewLeadAlertInput
): Promise<{ sent: number; skipped?: string }> {
  // This company's own number: an alert about a Ca Pro Builder lead must
  // not arrive from La Home Contractor's line.
  const twilioEnv = await getTwilioForCompany(lead.companyId);
  if (!twilioEnv) return { sent: 0, skipped: "twilio not configured" };

  const { data } = await admin
    .from("company_profile")
    .select(
      "new_lead_alert_phones, new_lead_alert_daily_cap, new_lead_alert_count, new_lead_alert_count_date"
    )
    .eq("company_id", lead.companyId)
    .maybeSingle();
  const config = data as AlertConfig | null;
  if (!config) return { sent: 0, skipped: "company not found" };

  const recipients = parseAlertPhones(config.new_lead_alert_phones);
  if (recipients.length === 0) return { sent: 0, skipped: "no alert numbers configured" };

  // The counter resets on the first alert of a new day rather than on a
  // schedule, so there's nothing to keep running for it.
  const today = new Date().toISOString().slice(0, 10);
  const usedToday = config.new_lead_alert_count_date === today ? config.new_lead_alert_count : 0;
  if (usedToday >= config.new_lead_alert_daily_cap) {
    return { sent: 0, skipped: `daily cap of ${config.new_lead_alert_daily_cap} reached` };
  }

  const body = buildNewLeadAlert(lead);
  let sent = 0;
  for (const to of recipients) {
    const result = await sendTwilioSms(to, body, twilioEnv);
    if (!result.error) sent += 1;
  }

  // Counts leads alerted about, not individual texts -- the cap is about
  // "how many leads can shout at us today", and the recipient list length
  // is a separate, deliberate choice.
  if (sent > 0) {
    await admin
      .from("company_profile")
      .update({ new_lead_alert_count: usedToday + 1, new_lead_alert_count_date: today })
      .eq("company_id", lead.companyId);
  }

  return { sent };
}

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { canEditDispatch, normalizePhone } from "@/lib/data/types";
import { getTwilioEnv } from "@/lib/twilio-env";

async function requireCanSendSms(): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canEditDispatch(profile)) return { error: "Only Office or Sales users can send messages." };
  return {};
}

export async function sendSms(
  leadId: string | null,
  toNumber: string,
  body: string
): Promise<{ error?: string }> {
  const guard = await requireCanSendSms();
  if (guard.error) return guard;
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const trimmedBody = body.trim();
  if (!trimmedBody) return { error: "Message cannot be empty." };
  if (!toNumber.trim()) return { error: "No phone number to send to." };

  const twilioEnv = getTwilioEnv();
  if (!twilioEnv) {
    return { error: "Twilio is not configured on the server." };
  }
  const { accountSid, authToken, phoneNumber: fromNumber } = twilioEnv;

  const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: toNumber, From: fromNumber, Body: trimmedBody }),
    }
  );

  const json = (await res.json().catch(() => null)) as { sid?: string; message?: string } | null;
  if (!res.ok) {
    return { error: json?.message || "Failed to send message." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("sms_messages").insert({
    lead_id: leadId,
    direction: "outbound",
    from_number: fromNumber,
    to_number: toNumber,
    body: trimmedBody,
    twilio_sid: json?.sid ?? null,
    company_id: profile.company_id,
  });
  if (error) return { error: error.message };

  revalidatePath("/reply-inbox");
  return {};
}

export type LeadMessage = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  channel: string;
  created_at: string;
};

/**
 * The conversation with a specific client, for their contact card.
 *
 * Deliberately excludes rep-directed traffic. Most outbound SMS in this
 * system ("Text Rep Info", appointment reminders) goes to a crew member's
 * phone with no lead attached -- showing that on a client's card would
 * read as "we texted the client" when nothing was sent to them.
 */
export async function getLeadMessages(
  leadId: string
): Promise<{ error?: string; messages?: LeadMessage[] }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const { data: leadRow } = await supabase
    .from("leads")
    .select("phone, second_contact_phone")
    .eq("id", leadId)
    .eq("company_id", profile.company_id)
    .maybeSingle();
  if (!leadRow) return { error: "Contact not found." };

  const { data: linked } = await supabase
    .from("sms_messages")
    .select("id, direction, body, channel, created_at")
    .eq("company_id", profile.company_id)
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true });

  const messages = (linked as LeadMessage[]) ?? [];

  // Older messages predate lead_id being stamped, so also match on the
  // client's own number -- but only when that number isn't also a staff
  // phone, or rep notifications about other jobs would surface here.
  const lead = leadRow as { phone: string | null; second_contact_phone: string | null };
  const clientNumbers = [lead.phone, lead.second_contact_phone]
    .filter((p): p is string => !!p)
    .map(normalizePhone);

  if (clientNumbers.length > 0) {
    const { data: staff } = await supabase.from("profiles").select("phone");
    const staffNumbers = new Set(
      ((staff as { phone: string | null }[]) ?? [])
        .filter((s) => s.phone)
        .map((s) => normalizePhone(s.phone!))
    );
    const safeNumbers = clientNumbers.filter((n) => !staffNumbers.has(n));

    if (safeNumbers.length > 0) {
      const { data: orphans } = await supabase
        .from("sms_messages")
        .select("id, direction, body, channel, created_at, from_number, to_number")
        .eq("company_id", profile.company_id)
        .is("lead_id", null)
        .order("created_at", { ascending: true });

      for (const row of (orphans as (LeadMessage & {
        from_number: string;
        to_number: string;
      })[]) ?? []) {
        const other =
          row.direction === "inbound" ? normalizePhone(row.from_number) : normalizePhone(row.to_number);
        if (safeNumbers.includes(other)) {
          messages.push({
            id: row.id,
            direction: row.direction,
            body: row.body,
            channel: row.channel,
            created_at: row.created_at,
          });
        }
      }
    }
  }

  messages.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return { messages };
}

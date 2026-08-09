"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { canEditDispatch, normalizePhone } from "@/lib/data/types";
import { getTwilioForCompany } from "@/lib/twilio-company";

async function requireCanSendSms(): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canEditDispatch(profile)) return { error: "Only Office or Sales users can send messages." };
  return {};
}

// channel separates who a message is FOR. Rep-facing texts live in the
// same table as customer ones so they show in reports, but the Reply
// Inbox must not present a teammate as if they were a client -- that is
// how a customer confirmation ends up sent to a rep.
export type SmsChannel = "sms" | "rep";

export async function sendSms(
  leadId: string | null,
  toNumber: string,
  body: string,
  channel: SmsChannel = "sms"
): Promise<{ error?: string }> {
  const guard = await requireCanSendSms();
  if (guard.error) return guard;
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const trimmedBody = body.trim();
  if (!trimmedBody) return { error: "Message cannot be empty." };
  if (!toNumber.trim()) return { error: "No phone number to send to." };

  // The company the sender belongs to, so the text goes out on that
  // business's own number rather than a shared one.
  const twilioEnv = await getTwilioForCompany(profile.company_id);
  if (!twilioEnv) {
    return { error: "Texting isn't configured for this company yet." };
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
    channel,
    // Who actually pressed send, so per-person activity can account for
    // the reps who work mostly by text.
    sent_by: profile.id,
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

  const lead = leadRow as { phone: string | null; second_contact_phone: string | null };
  const clientNumbers = [lead.phone, lead.second_contact_phone]
    .filter((p): p is string => !!p)
    .map(normalizePhone);

  const { data: linked } = await supabase
    .from("sms_messages")
    .select("id, direction, body, channel, created_at, from_number, to_number")
    .eq("company_id", profile.company_id)
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true });

  /**
   * Only what the client was actually party to.
   *
   * Rep notifications are stamped with lead_id so they attach to the
   * right job -- "Text Rep Info", appointment reminders, result chases --
   * but they are addressed to a rep's phone, not the customer's. Showing
   * them in the customer's thread told the office a homeowner had been
   * texted their appointment details when the message went to the rep and
   * the customer had received nothing at all. Somebody reading that stops
   * chasing.
   *
   * Written as an allow-list rather than "hide anything sent to staff":
   * a deny-list silently lets anything it does not recognise through,
   * which is how this got missed in the first place.
   */
  const clientIsParty = (row: { from_number: string | null; to_number: string | null }) => {
    const from = normalizePhone(row.from_number ?? "");
    const to = normalizePhone(row.to_number ?? "");
    // Portal messages and emailed links carry no usable phone number, and
    // are genuinely part of this conversation.
    if (!from && !to) return true;
    return clientNumbers.includes(from) || clientNumbers.includes(to);
  };

  const messages: LeadMessage[] = (
    (linked as (LeadMessage & { from_number: string | null; to_number: string | null })[]) ?? []
  )
    .filter((row) => {
      // channel already records who a message was for, and every rep
      // notification in this database carries it. That is the reliable
      // test; the number check below only catches anything untagged.
      if (row.channel === "rep") return false;
      if (row.channel === "portal" || row.channel === "email") return true;
      return clientIsParty(row);
    })
    .map((row) => ({
      id: row.id,
      direction: row.direction,
      body: row.body,
      channel: row.channel,
      created_at: row.created_at,
    }));

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

export type RepMessage = LeadMessage & {
  /** Who it went to, so the record says more than a bare number. */
  repName: string | null;
  toNumber: string;
};

/**
 * What was sent to staff about this job.
 *
 * The counterpart to getLeadMessages. Rep notifications are stamped with
 * lead_id so they attach to the right job, but they are addressed to a
 * rep rather than the customer -- they were being shown in the
 * customer's thread, which read as "the homeowner was told" when the
 * homeowner had received nothing.
 *
 * Kept as a record rather than a conversation: there is no reply box,
 * because a reply here would go to the rep, and anyone looking at a
 * customer's card who wants to send something means the customer.
 */
export async function getRepMessages(
  leadId: string
): Promise<{ error?: string; messages?: RepMessage[] }> {
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

  const lead = leadRow as { phone: string | null; second_contact_phone: string | null };
  const clientNumbers = [lead.phone, lead.second_contact_phone]
    .filter((p): p is string => !!p)
    .map(normalizePhone);

  const [{ data: rows }, { data: staff }] = await Promise.all([
    supabase
      .from("sms_messages")
      .select("id, direction, body, channel, created_at, from_number, to_number")
      .eq("company_id", profile.company_id)
      .eq("lead_id", leadId)
      .order("created_at", { ascending: true }),
    supabase.from("profiles").select("id, name, phone"),
  ]);

  const staffByNumber = new Map(
    ((staff as { id: string; name: string | null; phone: string | null }[]) ?? [])
      .filter((s) => s.phone)
      .map((s) => [normalizePhone(s.phone!), s.name])
  );

  const messages: RepMessage[] = [];
  for (const row of (rows as (LeadMessage & {
    from_number: string | null;
    to_number: string | null;
  })[]) ?? []) {
    if (row.channel === "portal" || row.channel === "email") continue;
    const to = normalizePhone(row.to_number ?? "");
    const from = normalizePhone(row.from_number ?? "");
    const counterparty = row.direction === "inbound" ? from : to;
    if (!counterparty) continue;

    // Tagged rep traffic, or untagged traffic whose counterparty is a
    // known staff phone. Anything the client was party to belongs in
    // their own thread, not here.
    const isRep = row.channel === "rep" || staffByNumber.has(counterparty);
    if (!isRep) continue;
    if (row.channel !== "rep" && (clientNumbers.includes(to) || clientNumbers.includes(from)))
      continue;
    messages.push({
      id: row.id,
      direction: row.direction,
      body: row.body,
      channel: row.channel,
      created_at: row.created_at,
      repName: staffByNumber.get(counterparty) ?? null,
      toNumber: row.to_number ?? row.from_number ?? "",
    });
  }

  return { messages };
}

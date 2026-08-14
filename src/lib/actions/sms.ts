"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import {
  canEditDispatch,
  leadDisplayName,
  normalizePhone,
  repMessagePreview,
} from "@/lib/data/types";
import { getTwilioForCompany } from "@/lib/twilio-company";

async function requireCanSendSms(): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  // Named from what canEditDispatch actually allows. It said "Office or
  // Sales" while granting Dispatch and Call Center too -- a message that
  // tells a dispatcher they are not allowed to do the thing they are
  // allowed to do sends them looking for a permission they already have.
  if (!canEditDispatch(profile))
    return { error: "Office, Sales, Dispatch or Call Center can send messages." };
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

export type RepRecipient = {
  id: string;
  name: string;
  phone: string;
  /** Why they're on this job, so the picker isn't a bare list of names. */
  role: string;
};

/**
 * The crew you can text about one job.
 *
 * Built from the job itself rather than the whole company roster: the
 * reps on its appointments, whoever owns the lead, and its dispatcher.
 * A full staff list would make it just as easy to text someone with no
 * connection to the work as the person standing outside the house.
 *
 * Ordered by the most recent appointment first, because the person you
 * need is almost always the one going there next.
 */
export async function getRepRecipients(
  leadId: string
): Promise<{ error?: string; recipients?: RepRecipient[]; jobLabel?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const { data: leadRow } = await supabase
    .from("leads")
    .select("id, assigned_to, dispatcher_id, contact_type, company_name, first_name, last_name")
    .eq("id", leadId)
    .eq("company_id", profile.company_id)
    .maybeSingle<
      {
        id: string;
        assigned_to: string | null;
        dispatcher_id: string | null;
      } & Parameters<typeof leadDisplayName>[0]
    >();
  if (!leadRow) return { error: "Contact not found." };
  const jobLabel = leadDisplayName(leadRow);

  const { data: events } = await supabase
    .from("events")
    .select("date, assigned_to, second_assigned_to")
    .eq("lead_id", leadId)
    .eq("company_id", profile.company_id)
    .order("date", { ascending: false })
    .returns<{ date: string; assigned_to: string | null; second_assigned_to: string | null }[]>();

  // Insertion order is the priority order, so a Map both de-dupes and
  // keeps the first (most relevant) reason a person appears here.
  const why = new Map<string, string>();
  for (const ev of events ?? []) {
    const when = new Date(`${ev.date}T00:00:00`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    if (ev.assigned_to && !why.has(ev.assigned_to)) why.set(ev.assigned_to, `Rep · ${when}`);
    if (ev.second_assigned_to && !why.has(ev.second_assigned_to))
      why.set(ev.second_assigned_to, `2nd rep · ${when}`);
  }
  if (leadRow.assigned_to && !why.has(leadRow.assigned_to))
    why.set(leadRow.assigned_to, "Lead owner");
  if (leadRow.dispatcher_id && !why.has(leadRow.dispatcher_id))
    why.set(leadRow.dispatcher_id, "Dispatcher");

  if (why.size === 0) return { recipients: [], jobLabel };

  // Resolved through company_members, so someone removed from the company
  // can't still be texted from a job they once worked.
  const members = await getCompanyMembers(profile.company_id);
  const byId = new Map(members.map((m) => [m.id, m]));

  const recipients: RepRecipient[] = [];
  for (const [id, role] of why) {
    const member = byId.get(id);
    // No phone means nothing to send to -- dropped rather than offered as
    // a choice that fails on send.
    if (!member?.phone) continue;
    recipients.push({ id, name: member.name || member.email || "Teammate", phone: member.phone, role });
  }
  return { recipients, jobLabel };
}

/**
 * Texts a teammate about one job.
 *
 * The job name is prepended here rather than left to the sender. Every
 * text this system sends leaves from the same company number, so on the
 * rep's phone it is all one thread -- "can you go half an hour earlier"
 * with nothing attached is unanswerable when they have three visits
 * booked. The nudges this app sends automatically already name the job;
 * a message typed by hand was the one kind that didn't.
 *
 * Plain "Re:" and a newline, no emoji: an emoji anywhere in the body
 * flips the whole message to UCS-2 and halves the segment length.
 *
 * The recipient is resolved from the job, not taken from the caller, so
 * this can only ever reach someone actually working it.
 */
export async function sendRepMessage(
  leadId: string,
  recipientId: string,
  body: string
): Promise<{ error?: string; sentTo?: string }> {
  const { recipients, jobLabel, error } = await getRepRecipients(leadId);
  if (error) return { error };
  const to = recipients?.find((r) => r.id === recipientId);
  if (!to) return { error: "That teammate isn't on this job." };

  const result = await sendSms(leadId, to.phone, repMessagePreview(jobLabel ?? "", body), "rep");
  if (result.error) return result;
  return { sentTo: to.name };
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

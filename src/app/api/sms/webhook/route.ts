import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone, type Lead } from "@/lib/data/types";
import { getTwilioEnv, validateTwilioSignature } from "@/lib/twilio-env";
import { companyForInboundNumber, getTwilioForCompany } from "@/lib/twilio-company";

const YES_WORDS = new Set(["yes", "y", "confirm", "confirmed", "ok", "okay", "yeah", "yep", "sure"]);
const NO_WORDS = new Set(["no", "n", "cancel", "decline", "declined", "nope"]);

type EventRow = {
  id: string;
  lead_id: string | null;
  company_id: string;
  date: string;
  time: string | null;
  assigned_to: string | null;
  second_assigned_to: string | null;
  rep_info_sent_at: string | null;
  second_rep_info_sent_at: string | null;
  reminder_night_before_sent_at: string | null;
  reminder_hour_before_sent_at: string | null;
};

const EVENT_COLUMNS =
  "id, lead_id, company_id, date, time, assigned_to, second_assigned_to, rep_info_sent_at, second_rep_info_sent_at, reminder_night_before_sent_at, reminder_hour_before_sent_at";

function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// How long a rep's free-text reply stays attachable to the appointment we
// last nudged them about. A "yes" is unambiguous whenever it arrives, but
// "on my way" a week after the fact is not about that job, and filing it
// there would put words on a customer's record that were never theirs.
const REP_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

// When did we last text this rep about this specific appointment? That is
// almost certainly the message they're replying to, and it beats guessing
// by date -- appointments routinely sit in the past still unconfirmed, so
// a "next upcoming" match would skip them entirely.
function lastTextedRepAt(ev: EventRow, repId: string): string | null {
  const stamps = [
    ev.assigned_to === repId ? ev.rep_info_sent_at : null,
    ev.second_assigned_to === repId ? ev.second_rep_info_sent_at : null,
    ev.reminder_night_before_sent_at,
    ev.reminder_hour_before_sent_at,
  ].filter((s): s is string => !!s);
  return stamps.length ? stamps.sort()[stamps.length - 1] : null;
}

// Fallback when nothing was texted: the appointment nearest to now,
// preferring one that hasn't happened yet.
function pickNearest(rows: EventRow[]): EventRow | null {
  const now = Date.now();
  const withTime = rows.map((r) => ({
    row: r,
    at: new Date(`${r.date}T${(r.time ?? "00:00:00").slice(0, 8)}`).getTime(),
  }));
  const upcoming = withTime.filter((x) => x.at >= now).sort((a, b) => a.at - b.at);
  if (upcoming.length) return upcoming[0].row;
  const past = withTime.sort((a, b) => b.at - a.at);
  return past[0]?.row ?? null;
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) params[key] = String(value);

  const from = params.From || "";
  const to = params.To || "";
  const body = params.Body || "";

  // Which company owns this message is decided by the number it was sent
  // TO, before anything else. Each company signs with its own auth token,
  // so the company has to be known to verify at all.
  //
  // Naming a company in the payload buys an attacker nothing: they still
  // cannot produce a valid signature without that company's token, and a
  // number nobody owns falls through to the platform credentials.
  const inboundCompanyId = await companyForInboundNumber(to);
  const twilioEnv = inboundCompanyId
    ? await getTwilioForCompany(inboundCompanyId)
    : getTwilioEnv();
  if (!twilioEnv) {
    return NextResponse.json({ error: "Twilio not configured" }, { status: 500 });
  }

  const signature = req.headers.get("x-twilio-signature");
  if (!validateTwilioSignature(req.url, params, signature, twilioEnv.authToken)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const normalizedFrom = normalizePhone(from);
  const normalizedBody = body.trim().toLowerCase();

  const admin = createAdminClient();
  // Scoped to the receiving company once one is known. Matching the
  // sender across every company's leads was only safe while there was a
  // single number: two companies holding the same homeowner's number
  // would race, and the reply could attach to the wrong business.
  let leadQuery = admin.from("leads").select("id, company_id, phone, second_contact_phone");
  if (inboundCompanyId) leadQuery = leadQuery.eq("company_id", inboundCompanyId);

  const [{ data: leads }, { data: profiles }] = await Promise.all([
    leadQuery,
    admin.from("profiles").select("id, name, phone"),
  ]);

  const leadRows =
    (leads as (Pick<Lead, "id" | "phone" | "second_contact_phone"> & { company_id: string })[]) ?? [];
  const matchedLead = leadRows.find(
    (l) =>
      (l.phone && normalizePhone(l.phone) === normalizedFrom) ||
      (l.second_contact_phone && normalizePhone(l.second_contact_phone) === normalizedFrom)
  );

  const profileRows = (profiles as { id: string; name: string | null; phone: string | null }[]) ?? [];
  const matchedRep = profileRows.find((p) => p.phone && normalizePhone(p.phone) === normalizedFrom);

  const isYesNo = YES_WORDS.has(normalizedBody) || NO_WORDS.has(normalizedBody);
  const confirmed = YES_WORDS.has(normalizedBody);

  let targetEvent: EventRow | null = null;
  let replyMessage: string | null = null;

  // A rep replying to their "Text Rep Info" message takes priority over a
  // lead match, since a staff member's own phone should never coincide with
  // a lead's, but if it somehow did, treating them as staff is the safer
  // assumption.
  //
  // Runs for any text from a known rep, not just yes/no. Which appointment
  // they mean is decided by who they are and what we last sent them --
  // never by the words -- so "running late" and "nobody's home" reach the
  // job the same way "yes" does. Gating this on yes/no meant every other
  // reply resolved to no appointment, and so was filed against no job and
  // shown nowhere.
  if (matchedRep) {
    const { data: candidateEvents } = await admin
      .from("events")
      .select(EVENT_COLUMNS)
      .or(`assigned_to.eq.${matchedRep.id},second_assigned_to.eq.${matchedRep.id}`)
      .in("status", ["New", "Confirmed"]);

    const rows = (candidateEvents as EventRow[] | null) ?? [];
    const texted = rows
      .map((row) => ({ row, at: lastTextedRepAt(row, matchedRep.id) }))
      .filter((x): x is { row: EventRow; at: string } => !!x.at)
      .sort((a, b) => b.at.localeCompare(a.at));

    if (isYesNo) {
      // An answer to a question only this app asks, so it pairs with the
      // appointment however long it took them to reply.
      targetEvent = texted[0]?.row ?? pickNearest(rows);
    } else if (
      texted[0] &&
      Date.now() - new Date(texted[0].at).getTime() < REP_REPLY_WINDOW_MS
    ) {
      // Anything else only attaches while the nudge is still fresh. A rep
      // texting the office out of the blue is not commentary on whatever
      // job they were last sent, and guessing would be worse than leaving
      // it loose -- the reply inbox catches those.
      targetEvent = texted[0].row;
    }

    if (isYesNo && targetEvent) {
      await admin.from("events").update({ rep_confirmed: confirmed }).eq("id", targetEvent.id);
      if (targetEvent.lead_id) {
        await admin.from("lead_notes").insert({
          lead_id: targetEvent.lead_id,
          author_id: null,
          body: `${confirmed ? "✅" : "❌"} ${matchedRep.name || "Rep"} ${
            confirmed ? "confirmed" : "declined"
          } via text reply.`,
          event_id: targetEvent.id,
          company_id: targetEvent.company_id,
        });
      }
      replyMessage = confirmed
        ? "Got it, marked as confirmed. Thanks!"
        : "Got it, marked as declined. We'll follow up.";
    }
  } else if (isYesNo && matchedLead) {
    const { data: candidateEvents } = await admin
      .from("events")
      .select(EVENT_COLUMNS)
      .eq("lead_id", matchedLead.id)
      .in("status", ["New", "Confirmed"]);
    targetEvent = pickNearest((candidateEvents as EventRow[] | null) ?? []);

    if (targetEvent) {
      await admin.from("events").update({ customer_confirmed: confirmed }).eq("id", targetEvent.id);
      await admin.from("lead_notes").insert({
        lead_id: matchedLead.id,
        author_id: null,
        body: `${confirmed ? "✅" : "❌"} Client ${confirmed ? "confirmed" : "declined"} via text reply.`,
        event_id: targetEvent.id,
        company_id: targetEvent.company_id,
      });
      replyMessage = confirmed
        ? "Thanks for confirming! See you then."
        : "Thanks for letting us know — we'll be in touch to reschedule.";
    }
  }

  // The receiving number is the most reliable answer, so it wins; the
  // lead and event matches remain as fallbacks for numbers that predate
  // per-company Twilio.
  const companyId =
    inboundCompanyId ?? matchedLead?.company_id ?? targetEvent?.company_id ?? null;

  // Which job this message belongs to on the record.
  //
  // A lead match wins: a customer texting from their own number belongs in
  // their own thread, and that includes the rare person who is both a
  // customer and staff. Everyone else's reply is filed against the
  // appointment resolved above -- a rep's number matches no lead, which is
  // exactly why their replies used to be stored with no job attached and
  // then be unfindable. The confirmation flipped and a note appeared, but
  // the words they actually sent went nowhere.
  const attachedLeadId = matchedLead?.id ?? targetEvent?.lead_id ?? null;
  // Crew traffic is tagged so it shows on the appointment's Rep tab rather
  // than in the customer's thread, where it would read as something the
  // homeowner was told.
  const fromCrew = !matchedLead && !!matchedRep;

  if (companyId) {
    await admin.from("sms_messages").insert({
      lead_id: attachedLeadId,
      direction: "inbound",
      from_number: from,
      to_number: to,
      body,
      twilio_sid: params.MessageSid || null,
      company_id: companyId,
      channel: fromCrew ? "rep" : "sms",
    });
  }

  const twiml = replyMessage
    ? `<Response><Message>${escapeXml(replyMessage)}</Message></Response>`
    : "<Response></Response>";

  return new NextResponse(twiml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

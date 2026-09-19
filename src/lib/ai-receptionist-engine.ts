import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTwilioSms } from "@/lib/twilio-env";
import { getTwilioForCompany } from "@/lib/twilio-company";
import { leadForPhoneNumber } from "@/lib/data/lead-for-number";
import { PRE_APPOINTMENT_STAGES, TIMEZONE_IANA, toE164, type PipelineStage } from "@/lib/data/types";
import { nowInZone } from "@/lib/timezone";
import {
  aiGreetingText,
  appointmentFromExtraction,
  cleanSpeechInput,
  confirmationSms,
  forceWrapUp,
  gatherTwiml,
  parseExtraction,
  parseTurnReply,
  receptionistAvailable,
  receptionistNote,
  receptionistSystemPrompt,
  sayTwiml,
  shouldSendConfirmationSms,
  turnMessages,
  type ExtractedLead,
  type PenciledAppointment,
  type ReceptionistFacts,
  type ReceptionistTurn,
} from "@/lib/ai-receptionist";

/**
 * The impure half of the AI receptionist: Claude on the line, the
 * session rows, and what lands in the CRM afterwards. Every decision
 * worth testing lives in ai-receptionist.ts; this file wires it to
 * Twilio webhooks, the database, and the model.
 *
 * Failure posture throughout: a caller is holding a live phone. Any
 * error degrades to a spoken apology or to the pre-existing voicemail
 * behavior — never a dead line, never a thrown error up to Twilio.
 */

type Admin = ReturnType<typeof createAdminClient>;

type SessionRow = {
  id: string;
  company_id: string;
  from_number: string;
  to_number: string;
  turns: unknown;
  silent_turns: number | null;
  status: string;
};

const MODEL = "claude-opus-5";

const RETRY_SAY = "Sorry, I didn't quite catch that — could you say it once more?";
const STILL_THERE_SAY = "Sorry — are you still there? How can I help?";
const SILENT_GOODBYE = "No worries — we'll follow up by text. Thanks for calling!";

/** Spoken when the session itself is unreachable — the one thing this
 *  feature must never do is leave a homeowner on a silent line. */
export function failsafeTwiml(): string {
  return (
    sayTwiml(
      "Sorry — we're having trouble on the line. Please send a text to this number and we'll get right back to you."
    ) + "<Hangup/>"
  );
}

function extractSystem(facts: ReceptionistFacts): string {
  return [
    "You extract CRM fields from the transcript of an AI receptionist phone call for a contracting company.",
    'Reply ONLY with JSON on one line: {"first_name":"","last_name":"","project_type":"","address":"","callback_time":"","summary":"","appointment_date":"","appointment_time":""}.',
    "Every value is a string; use an empty string when the transcript doesn't say. Never invent details.",
    "summary: one or two plain sentences on why they called and what they need.",
    `appointment_date/appointment_time: ONLY when the caller agreed to a specific visit day (and time) — YYYY-MM-DD and 24-hour HH:MM, resolving relative days from today, ${facts.todayLabel} (${facts.todayISO}). A vague "call me back afternoons" belongs in callback_time, not here.`,
  ].join("\n");
}

function turnUrl(origin: string): string {
  return `${origin}/api/voice/ai/turn`;
}

function normalizeTurns(raw: unknown): ReceptionistTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: ReceptionistTurn[] = [];
  for (const item of raw) {
    const role = (item as { role?: unknown })?.role;
    const text = (item as { text?: unknown })?.text;
    if ((role === "caller" || role === "assistant") && typeof text === "string" && text) {
      turns.push({ role, text });
    }
  }
  return turns;
}

function transcriptText(turns: ReceptionistTurn[]): string {
  return turns
    .map((t) => `${t.role === "caller" ? "Caller" : "Receptionist"}: ${t.text}`)
    .join("\n");
}

function textOf(response: Anthropic.Message): string {
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/**
 * Whether this company's receptionist answers, plus what it knows.
 * Two selects on purpose: name and call_script exist today, the AI
 * columns arrive with migration 0160 — combined, a pre-migration select
 * errors and would take the company name down with it.
 */
async function receptionistState(
  admin: Admin,
  companyId: string
): Promise<{ enabled: boolean; facts: ReceptionistFacts }> {
  const [baseRes, aiRes] = await Promise.all([
    admin
      .from("company_profile")
      .select("name, call_script, timezone")
      .eq("company_id", companyId)
      .maybeSingle<{ name: string | null; call_script: string | null; timezone: string | null }>(),
    admin
      .from("company_profile")
      .select("ai_receptionist_enabled, ai_receptionist_greeting")
      .eq("company_id", companyId)
      .maybeSingle<{
        ai_receptionist_enabled: boolean | null;
        ai_receptionist_greeting: string | null;
      }>(),
  ]);

  // "Tuesday" from a caller is anchored to the company's own clock, not
  // the server's -- at 11pm Pacific the two disagree about what day it is.
  const zone = TIMEZONE_IANA[baseRes.data?.timezone ?? ""] ?? "America/Los_Angeles";
  const wallClock = nowInZone(zone);
  const todayISO = wallClock.toISOString().slice(0, 10);
  const todayLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(wallClock);

  return {
    enabled: !aiRes.error && receptionistAvailable(aiRes.data),
    facts: {
      companyName: baseRes.data?.name || "our company",
      greeting: aiRes.data?.ai_receptionist_greeting ?? null,
      callScript: baseRes.data?.call_script ?? null,
      todayISO,
      todayLabel,
    },
  };
}

/**
 * Take over a call nobody answered. Returns the greeting TwiML, or null
 * when the receptionist shouldn't (or can't) answer — the caller then
 * keeps today's voicemail/missed-you behavior, including when the
 * session table doesn't exist because 0160 hasn't been run yet.
 */
export async function maybeStartReceptionist(
  admin: Admin,
  args: { companyId: string; callSid: string; from: string; to: string; origin: string }
): Promise<string | null> {
  if (!args.callSid) return null;
  const state = await receptionistState(admin, args.companyId);
  if (!state.enabled) return null;

  const { error } = await admin.from("ai_receptionist_calls").insert({
    company_id: args.companyId,
    call_sid: args.callSid,
    from_number: args.from,
    to_number: args.to,
  });
  // A duplicate CallSid is a Twilio webhook retry -- the session exists,
  // greet again. Anything else (most likely the table missing before
  // 0160 ran) means we cannot hold a conversation: fall back.
  if (error && error.code !== "23505") return null;

  return gatherTwiml({
    actionUrl: turnUrl(args.origin),
    say: aiGreetingText(state.facts),
  });
}

/**
 * One caller utterance in, one AI reply out. Returns the TwiML to speak
 * and, when the conversation just ended, the session to finalize.
 */
export async function runReceptionistTurn(
  admin: Admin,
  args: { callSid: string; speech: string; origin: string }
): Promise<{ body: string; finalizeSessionId: string | null }> {
  const { data: row } = await admin
    .from("ai_receptionist_calls")
    .select("id, company_id, from_number, to_number, turns, silent_turns, status")
    .eq("call_sid", args.callSid)
    .eq("status", "active")
    .maybeSingle<SessionRow>();
  if (!row) return { body: failsafeTwiml(), finalizeSessionId: null };

  const turns = normalizeTurns(row.turns);
  const speech = cleanSpeechInput(args.speech);

  // Silence: one gentle nudge, then a goodbye. Gather's
  // actionOnEmptyResult sends us these, so a quiet line still ends.
  if (!speech) {
    const silent = (row.silent_turns ?? 0) + 1;
    if (silent >= 2) {
      await admin
        .from("ai_receptionist_calls")
        .update({
          turns: [...turns, { role: "assistant", text: SILENT_GOODBYE }],
          status: "done",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      return { body: sayTwiml(SILENT_GOODBYE) + "<Hangup/>", finalizeSessionId: row.id };
    }
    await admin
      .from("ai_receptionist_calls")
      .update({ silent_turns: silent, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    return {
      body: gatherTwiml({ actionUrl: turnUrl(args.origin), say: STILL_THERE_SAY }),
      finalizeSessionId: null,
    };
  }

  const nextTurns: ReceptionistTurn[] = [...turns, { role: "caller", text: speech }];
  const assistantCount = turns.filter((t) => t.role === "assistant").length;
  // Counting the reply about to be written: when it is the last one the
  // budget allows, the model is told to say goodbye in it.
  const wrapUp = forceWrapUp(assistantCount + 1);

  const state = await receptionistState(admin, row.company_id);
  const apiKey = process.env.ANTHROPIC_API_KEY;

  let reply: { say: string; done: boolean } | null = null;
  if (apiKey) {
    try {
      const client = new Anthropic({ apiKey });
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 300,
        output_config: { effort: "low" },
        system:
          receptionistSystemPrompt(state.facts) +
          (wrapUp
            ? '\n\nIMPORTANT: This is your final reply of the call. Say a warm goodbye now and set "done" to true.'
            : ""),
        messages: turnMessages(nextTurns),
      });
      if (response.stop_reason !== "refusal") reply = parseTurnReply(textOf(response));
    } catch {
      // reply stays null; the retry line below covers it.
    }
  }

  // A bad model reply is a re-prompt, not a dead line; the turn budget
  // bounds how long that can go on.
  const finalReply = reply ?? { say: RETRY_SAY, done: false };
  const done = finalReply.done || wrapUp;

  await admin
    .from("ai_receptionist_calls")
    .update({
      turns: [...nextTurns, { role: "assistant", text: finalReply.say }],
      silent_turns: 0,
      status: done ? "done" : "active",
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);

  return done
    ? { body: sayTwiml(finalReply.say) + "<Hangup/>", finalizeSessionId: row.id }
    : {
        body: gatherTwiml({ actionUrl: turnUrl(args.origin), say: finalReply.say }),
        finalizeSessionId: null,
      };
}

/** Same shape as callrail-sync's guard: the migration adding the RPC
 *  may not have run yet. */
function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  return /schema cache|could not find the function|does not exist/i.test(error.message ?? "");
}

/**
 * The caller as a contact. Goes through create_lead_for_unknown_caller
 * (0129) so two webhooks racing on one new number make one contact, with
 * the plain insert as the pre-migration fallback — callrail-sync's
 * exact discipline.
 */
async function createCallerLead(
  admin: Admin,
  companyId: string,
  extraction: ExtractedLead | null,
  phone: string
): Promise<string | null> {
  const digits = phone.replace(/\D/g, "");
  const first = extraction?.first_name || "Caller";
  const last = extraction?.last_name || (digits ? `…${digits.slice(-4)}` : "Unknown");

  const { data, error } = await admin.rpc("create_lead_for_unknown_caller", {
    p_company_id: companyId,
    p_phone: phone,
    p_first_name: first,
    p_last_name: last,
    p_email: "",
    p_source: "AI Receptionist",
    p_notes: null,
  });
  if (!error) {
    const rpcRow = (Array.isArray(data) ? data[0] : data) as { lead_id: string | null } | undefined;
    return rpcRow?.lead_id ?? null;
  }
  if (!isMissingFunction(error)) {
    console.error("[ai-receptionist] create_lead_for_unknown_caller failed", error);
  }

  const { data: inserted } = await admin
    .from("leads")
    .insert({
      contact_type: "Individual",
      first_name: first,
      last_name: last,
      phone: phone || null,
      email: null,
      notes: null,
      stage: "Unsorted",
      source: "AI Receptionist",
      company_id: companyId,
    })
    .select("id")
    .single();
  return (inserted as { id: string } | null)?.id ?? null;
}

/**
 * Turn a finished session into CRM records: the extraction, the lead
 * (matched by number or created), the note, the call-log update, and
 * the confirmation text. Claimed with a conditional update so the
 * after()-path and the sweeps can both call this without double-filing.
 */
export async function finalizeReceptionistCall(admin: Admin, sessionId: string): Promise<void> {
  const staleFinalizing = new Date(Date.now() - 15 * 60000).toISOString();
  const { data: claimed } = await admin
    .from("ai_receptionist_calls")
    .update({ status: "finalizing", updated_at: new Date().toISOString() })
    .eq("id", sessionId)
    .neq("status", "finalized")
    .or(`status.neq.finalizing,updated_at.lt.${staleFinalizing}`)
    .select("id, company_id, call_sid, from_number, to_number, turns")
    .maybeSingle<SessionRow & { call_sid: string }>();
  if (!claimed) return;

  const state = await receptionistState(admin, claimed.company_id);
  const turns = normalizeTurns(claimed.turns);
  const apiKey = process.env.ANTHROPIC_API_KEY;

  let extraction: ExtractedLead | null = null;
  if (turns.some((t) => t.role === "caller") && apiKey) {
    try {
      const client = new Anthropic({ apiKey });
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 400,
        output_config: { effort: "low" },
        system: extractSystem(state.facts),
        messages: [{ role: "user", content: transcriptText(turns) }],
      });
      if (response.stop_reason !== "refusal") extraction = parseExtraction(textOf(response));
    } catch {
      // A phone-only lead with the transcript is still a lead.
    }
  }

  const phone = toE164(claimed.from_number) || claimed.from_number;
  let leadId: string | null = null;
  let createdLead = false;
  if (claimed.from_number) {
    leadId = await leadForPhoneNumber(admin, claimed.company_id, claimed.from_number);
    if (!leadId && turns.some((t) => t.role === "caller")) {
      leadId = await createCallerLead(admin, claimed.company_id, extraction, phone);
      createdLead = leadId !== null;
    }
  }

  // Details only onto the contact this call just created -- an existing
  // customer's address is not overwritten by one garbled phone call.
  if (leadId && createdLead && extraction) {
    const patch: Record<string, string> = {};
    if (extraction.project_type) patch.project_type = extraction.project_type;
    if (extraction.address) patch.address = extraction.address;
    if (Object.keys(patch).length > 0) {
      await admin.from("leads").update(patch).eq("id", leadId).eq("company_id", claimed.company_id);
    }
  }

  // The penciled appointment: a real event, unassigned and unconfirmed,
  // so it shows on the schedule, the office assigns who drives out, and
  // the caller's YES (matched by the SMS webhook) confirms it.
  let booked: PenciledAppointment | null = null;
  const slot = appointmentFromExtraction(extraction, state.facts.todayISO);
  if (slot && leadId) {
    const { error: eventError } = await admin.from("events").insert({
      title: "Estimate visit — penciled by AI receptionist",
      date: slot.date,
      time: slot.time,
      event_type: "Estimate",
      assigned_to: null,
      notes:
        "Penciled in by the AI receptionist from a missed-call conversation. Assign a rep — the caller was told a text would confirm the time, and the reminder texts only run once someone is assigned.",
      lead_id: leadId,
      created_by: null,
      company_id: claimed.company_id,
      customer_confirmed: false,
    });
    if (eventError) {
      // The lead and the note still land; the requested time survives
      // in both, so the office can book it by hand.
      console.error("[ai-receptionist] penciling the appointment failed", eventError);
    } else {
      booked = slot;
      // Mirror bookAppointmentForLead: the lead now has an appointment,
      // and a pre-appointment stage advances to Appointment Scheduled.
      const { data: leadRow } = await admin
        .from("leads")
        .select("stage")
        .eq("id", leadId)
        .eq("company_id", claimed.company_id)
        .maybeSingle<{ stage: PipelineStage }>();
      const stage = leadRow?.stage;
      await admin
        .from("leads")
        .update({
          has_appt: true,
          ...(stage && PRE_APPOINTMENT_STAGES.includes(stage)
            ? { stage: "Appointment Scheduled" }
            : {}),
        })
        .eq("id", leadId)
        .eq("company_id", claimed.company_id);
    }
  }

  if (leadId && turns.length > 0) {
    await admin.from("lead_notes").insert({
      lead_id: leadId,
      author_id: null,
      body: `🤖 ${receptionistNote(extraction, turns, booked)}`,
      company_id: claimed.company_id,
    });
  }

  if (claimed.call_sid) {
    await admin
      .from("call_logs")
      .update({
        status: "completed",
        disposition: "AI Receptionist",
        notes: extraction?.summary || "AI receptionist took the call.",
        ...(leadId ? { lead_id: leadId } : {}),
      })
      .eq("twilio_call_sid", claimed.call_sid)
      .eq("company_id", claimed.company_id)
      .eq("direction", "inbound");
  }

  // A booking always earns its text -- the "reply YES to confirm" is
  // half the feature -- while a plain details-taken call keeps the old
  // "worth confirming at all" rule.
  const smsTo = toE164(claimed.from_number);
  if (smsTo && (booked || shouldSendConfirmationSms(extraction, smsTo))) {
    try {
      const twilioEnv = await getTwilioForCompany(claimed.company_id);
      if (twilioEnv) {
        await sendTwilioSms(smsTo, confirmationSms(state.facts.companyName, booked), twilioEnv);
      }
    } catch {
      // The lead and the note are the record; the text is a courtesy.
    }
  }

  await admin
    .from("ai_receptionist_calls")
    .update({
      status: "finalized",
      lead_id: leadId,
      summary: extraction?.summary ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);
}

/**
 * Catch the sessions no webhook will finish: a caller who hung up
 * mid-conversation leaves an "active" row Twilio never calls back
 * about. Runs after() on every inbound call and from the cron floor.
 */
export async function sweepReceptionistCalls(admin: Admin): Promise<number> {
  const quietCutoff = new Date(Date.now() - 5 * 60000).toISOString();
  const { data } = await admin
    .from("ai_receptionist_calls")
    .select("id, status, updated_at")
    .in("status", ["active", "done"])
    .limit(25)
    .returns<{ id: string; status: string; updated_at: string }[]>();

  const due = (data ?? []).filter(
    (row) => row.status === "done" || row.updated_at < quietCutoff
  );
  for (const row of due) {
    try {
      await finalizeReceptionistCall(admin, row.id);
    } catch (error) {
      console.error("[ai-receptionist] finalize failed", row.id, error);
    }
  }
  return due.length;
}

// Relative with extension: this module is under node:test, which
// resolves no @/ aliases (see DECISIONS #036).
import { xmlEscape } from "./voice-notice.ts";

/**
 * The AI receptionist's conversation policy — everything decidable
 * without Twilio or the model on the line. The webhook routes stay thin
 * adapters; what a caller hears, when a call wraps up, and what a
 * malformed model reply degrades to are all decided (and tested) here,
 * because a crash mid-call is a dead line with a homeowner on it.
 */

export type ReceptionistTurn = { role: "caller" | "assistant"; text: string };

export type ReceptionistFacts = {
  companyName: string;
  /** Owner-written opener from Settings; null means the default pitch. */
  greeting: string | null;
  /** The company's call script, used as background knowledge only. */
  callScript: string | null;
};

export type TurnReply = { say: string; done: boolean };

export type ExtractedLead = {
  first_name: string;
  last_name: string;
  project_type: string;
  address: string;
  callback_time: string;
  summary: string;
};

/** Amazon Polly neural voice — on every Twilio account, no add-on, and
 *  far closer to human than the basic "alice" the notices use. */
export const AI_VOICE = "Polly.Joanna-Neural";

/** The AI gets this many replies to collect the details, then it wraps
 *  up on the next turn whatever happens — a runaway conversation costs
 *  the caller's patience before it costs tokens. */
export const MAX_AI_TURNS = 10;

export const MAX_SPEECH_CHARS = 500;
const MAX_SAY_CHARS = 600;
const MAX_SCRIPT_CHARS = 1500;
const MAX_NOTE_CHARS = 3000;

export function sayTwiml(text: string): string {
  return `<Say voice="${AI_VOICE}">${xmlEscape(text)}</Say>`;
}

/**
 * Speak a prompt and listen for the answer. actionOnEmptyResult keeps
 * silence flowing back to the webhook — without it a quiet caller
 * leaves the session hanging with no way to say goodbye.
 */
export function gatherTwiml(input: { actionUrl: string; say: string }): string {
  return (
    `<Gather input="speech" speechTimeout="auto" speechModel="phone_call"` +
    ` actionOnEmptyResult="true" action="${xmlEscape(input.actionUrl)}" method="POST">` +
    sayTwiml(input.say) +
    `</Gather>`
  );
}

/**
 * The opener. The company can rewrite the pitch, but the first sentence
 * is fixed: who's talking (an AI) and that the call may be transcribed
 * are disclosure and consent, not copy — no setting removes them.
 */
export function aiGreetingText(facts: ReceptionistFacts): string {
  const disclosure = `Thanks for calling ${facts.companyName}! I'm the company's AI assistant, and this call may be transcribed.`;
  const pitch =
    facts.greeting?.trim() ||
    "I can take your details and have someone call you right back. How can I help?";
  return `${disclosure} ${pitch}`;
}

export function receptionistSystemPrompt(facts: ReceptionistFacts): string {
  const script = facts.callScript?.trim();
  return [
    `You are the phone receptionist for ${facts.companyName}, a contracting company. A caller reached you because nobody could pick up. Your one job: make them feel heard and collect what the team needs to call them back.`,
    "",
    `Reply ONLY with JSON on a single line: {"say":"<what you say next>","done":false}. Set "done" to true only when you are saying goodbye. No other text before or after the JSON.`,
    "",
    "How to speak:",
    "- Under 40 words per reply, one question at a time, warm and plain.",
    "- Speakable text only: no markdown, no emoji, no lists, no URLs.",
    "- The caller's words come from speech recognition and may be garbled — ask again rather than guess.",
    "",
    "What to collect, in order, skipping what they already said: their name; what the project or problem is; the property address; when is good for a call back. Their phone number is already on file from caller ID — confirm it only if they offer a different one.",
    "",
    "Hard rules:",
    "- Never give a price, a quote, a discount, or any dollar figure — pricing is always for the team to discuss on the callback.",
    "- Never promise a firm appointment time; someone from the office will call to confirm.",
    "- If they ask something you don't know from the company notes, say you'll pass the question to the team.",
    "- If it's clearly a wrong number or spam, wrap up politely.",
    "",
    `Once you have the essentials (or the caller is done), thank them by name, say the team will call back${facts.companyName ? ` from ${facts.companyName}` : ""}, and set done to true.`,
    ...(script
      ? ["", "COMPANY NOTES (background knowledge, not a script to read):", script.slice(0, MAX_SCRIPT_CHARS)]
      : []),
  ].join("\n");
}

/** The greeting lives in the system prompt, so stored turns start with
 *  the caller and map straight onto API roles. */
export function turnMessages(
  turns: ReceptionistTurn[]
): { role: "user" | "assistant"; content: string }[] {
  return turns.map((t) => ({
    role: t.role === "caller" ? "user" : "assistant",
    content: t.text,
  }));
}

/** The first {...} span in the reply, fences and prose tolerated. */
function jsonSpan(raw: string): string | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return raw.slice(start, end + 1);
}

function speakable(value: string, cap: number): string {
  return value
    .replace(/[*_`#]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, cap);
}

/**
 * The model's turn, or null when it sent something unusable — the route
 * then re-prompts with a stock line instead of dying mid-call.
 */
export function parseTurnReply(raw: string): TurnReply | null {
  const span = jsonSpan(raw);
  if (!span) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(span);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const say = (parsed as { say?: unknown }).say;
  if (typeof say !== "string" || !say.trim()) return null;
  return {
    say: speakable(say, MAX_SAY_CHARS),
    done: (parsed as { done?: unknown }).done === true,
  };
}

function extractedField(value: unknown, cap: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, cap) : "";
}

/** The end-of-call extraction; null degrades to a phone-only lead with
 *  the transcript as the record. */
export function parseExtraction(raw: string): ExtractedLead | null {
  const span = jsonSpan(raw);
  if (!span) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(span);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Record<string, unknown>;
  return {
    first_name: extractedField(p.first_name, 60),
    last_name: extractedField(p.last_name, 60),
    project_type: extractedField(p.project_type, 80),
    address: extractedField(p.address, 160),
    callback_time: extractedField(p.callback_time, 80),
    summary: extractedField(p.summary, 500),
  };
}

export function forceWrapUp(assistantTurns: number): boolean {
  return assistantTurns >= MAX_AI_TURNS;
}

export function cleanSpeechInput(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_SPEECH_CHARS);
}

/** Explicit true only: until migration 0160 runs, the column is missing
 *  and every call keeps today's voicemail behavior. */
export function receptionistAvailable(
  row: { ai_receptionist_enabled?: boolean | null } | null
): boolean {
  return row?.ai_receptionist_enabled === true;
}

/** The note filed on the lead: what was learned, then the whole
 *  exchange — the transcript IS the record, since nothing is recorded. */
export function receptionistNote(
  extraction: ExtractedLead | null,
  turns: ReceptionistTurn[]
): string {
  const lines: string[] = ["AI receptionist answered this call."];
  if (extraction?.summary) lines.push(`Summary: ${extraction.summary}`);
  if (extraction?.project_type) lines.push(`Project: ${extraction.project_type}`);
  if (extraction?.address) lines.push(`Address: ${extraction.address}`);
  if (extraction?.callback_time) lines.push(`Callback: ${extraction.callback_time}`);
  lines.push("", "Transcript:");
  for (const turn of turns) {
    lines.push(`${turn.role === "caller" ? "Caller" : "AI"}: ${turn.text}`);
  }
  return lines.join("\n").slice(0, MAX_NOTE_CHARS);
}

export function confirmationSms(companyName: string): string {
  return `Thanks for calling ${companyName}! We got your details and someone from our team will call you back shortly.`;
}

/** A text is a confirmation of something — with nothing captured and
 *  nobody to send to, it would just be spam. */
export function shouldSendConfirmationSms(
  extraction: ExtractedLead | null,
  toNumber: string
): boolean {
  if (!toNumber || !extraction) return false;
  return Boolean(
    extraction.first_name ||
      extraction.last_name ||
      extraction.project_type ||
      extraction.address ||
      extraction.summary
  );
}

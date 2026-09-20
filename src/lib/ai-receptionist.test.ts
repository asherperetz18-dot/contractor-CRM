import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AI_VOICE,
  MAX_AI_TURNS,
  MAX_SPEECH_CHARS,
  aiGreetingText,
  appointmentFromExtraction,
  approxRings,
  cleanSpeechInput,
  confirmationSms,
  forceWrapUp,
  friendlyApptLine,
  gatherTwiml,
  transferTwiml,
  parseExtraction,
  parseTurnReply,
  receptionistAvailable,
  receptionistNote,
  receptionistSystemPrompt,
  sayTwiml,
  shouldSendConfirmationSms,
  turnMessages,
  type ExtractedLead,
  type ReceptionistTurn,
} from "./ai-receptionist.ts";

/**
 * This module is the whole conversation policy for the AI receptionist:
 * what a caller hears, when the call wraps up, and what a malformed
 * model reply degrades to. It talks to real customers on a live phone
 * line, so the edges are pinned hard — a crash mid-call is a dead line
 * with a homeowner on the other end.
 */

const FACTS = {
  companyName: "Ace Roofing",
  greeting: null as string | null,
  callScript: null as string | null,
  todayISO: "2026-09-19",
  todayLabel: "Saturday, September 19, 2026",
  transferNumber: null as string | null,
};

function extraction(over: Partial<ExtractedLead> = {}): ExtractedLead {
  return {
    first_name: "",
    last_name: "",
    project_type: "",
    address: "",
    callback_time: "",
    summary: "",
    appointment_date: "",
    appointment_time: "",
    ...over,
  };
}

// ── TwiML rendering ──────────────────────────────────────────────────

test("say renders escaped text in the chosen voice", () => {
  const xml = sayTwiml(`Tom & Jerry's <roof> "quote"`);
  assert.ok(xml.startsWith(`<Say voice="${AI_VOICE}">`));
  assert.ok(xml.includes("Tom &amp; Jerry's &lt;roof&gt; &quot;quote&quot;"));
  assert.ok(!xml.includes("<roof>"), "raw angle brackets would break the TwiML document");
});

test("gather listens for speech and keypad both, and survives silence", () => {
  const xml = gatherTwiml({
    actionUrl: "https://app.example.com/api/voice/ai/turn?x=1&y=2",
    say: "How can I help?",
  });
  // dtmf too: pressing 0 is the universal "get me a person".
  assert.ok(xml.includes(`input="speech dtmf"`));
  assert.ok(xml.includes(`numDigits="1"`));
  // Silence must still call us back, or the session hangs open with no
  // way to say goodbye.
  assert.ok(xml.includes(`actionOnEmptyResult="true"`));
  assert.ok(xml.includes("&amp;y=2"), "action URL is XML-escaped");
  // The prompt plays inside the Gather so Twilio is already listening.
  const gatherOpen = xml.indexOf("<Gather");
  const sayAt = xml.indexOf("<Say");
  const gatherClose = xml.indexOf("</Gather>");
  assert.ok(gatherOpen < sayAt && sayAt < gatherClose);
});

// ── Greeting ─────────────────────────────────────────────────────────

test("the greeting names the company and always discloses the AI", () => {
  const text = aiGreetingText(FACTS);
  assert.ok(text.includes("Ace Roofing"));
  assert.ok(/AI assistant/i.test(text));
  assert.ok(/transcribed/i.test(text), "the transcription notice is part of consent");
});

test("a custom greeting replaces the pitch but never the disclosure", () => {
  const text = aiGreetingText({ ...FACTS, greeting: "Leave your name and our crew will call you back today." });
  assert.ok(text.includes("our crew will call you back today"));
  assert.ok(/AI assistant/i.test(text), "no setting can remove the AI disclosure");
  assert.ok(/transcribed/i.test(text));
});

// ── System prompt guardrails ─────────────────────────────────────────

test("the system prompt carries the hard rules and the company's own script", () => {
  const prompt = receptionistSystemPrompt({
    ...FACTS,
    callScript: "We do roofs, gutters and solar. Financing available.",
  });
  assert.ok(prompt.includes("Ace Roofing"));
  assert.ok(/never.*(price|quote|dollar)/i.test(prompt), "prices are a human's to give");
  assert.ok(prompt.includes("We do roofs, gutters and solar"));
});

test("a giant call script is capped instead of swallowing the prompt", () => {
  const prompt = receptionistSystemPrompt({ ...FACTS, callScript: "x".repeat(9000) });
  assert.ok(prompt.length < 8000);
});

test("the prompt knows today and books in pencil, never in ink", () => {
  const prompt = receptionistSystemPrompt(FACTS);
  // "Tuesday" from a caller means nothing without an anchor date.
  assert.ok(prompt.includes("2026-09-19"));
  assert.ok(prompt.includes("Saturday, September 19, 2026"));
  assert.ok(/pencil/i.test(prompt), "the offer is a penciled slot with a text to confirm");
});

// ── Turn mapping ─────────────────────────────────────────────────────

test("caller turns become user messages, assistant turns stay assistant", () => {
  const turns: ReceptionistTurn[] = [
    { role: "caller", text: "hi I need my roof looked at" },
    { role: "assistant", text: "Happy to help — what's your name?" },
    { role: "caller", text: "Bob Smith" },
  ];
  assert.deepEqual(turnMessages(turns), [
    { role: "user", content: "hi I need my roof looked at" },
    { role: "assistant", content: "Happy to help — what's your name?" },
    { role: "user", content: "Bob Smith" },
  ]);
});

// ── Parsing the model's turn reply ───────────────────────────────────

test("a clean JSON turn parses", () => {
  assert.deepEqual(parseTurnReply(`{"say": "What's your name?", "done": false}`), {
    say: "What's your name?",
    done: false,
    transfer: false,
  });
});

test("code fences and prose around the JSON are tolerated", () => {
  const fenced = parseTurnReply('```json\n{"say":"Thanks, goodbye!","done":true}\n```');
  assert.deepEqual(fenced, { say: "Thanks, goodbye!", done: true, transfer: false });
  const wrapped = parseTurnReply('Sure! Here is my reply: {"say":"And your address?","done":false} Hope that helps.');
  assert.deepEqual(wrapped, { say: "And your address?", done: false, transfer: false });
});

test("a transfer intent parses only from an explicit true", () => {
  const parsed = parseTurnReply('{"say":"Sure — connecting you now.","done":false,"transfer":true}');
  assert.ok(parsed);
  assert.equal(parsed.transfer, true);
  const stringy = parseTurnReply('{"say":"ok","done":false,"transfer":"yes"}');
  assert.ok(stringy);
  assert.equal(stringy.transfer, false, "an untrusted string never counts as a flag");
});

test("the transfer TwiML rings the human and comes back to us either way", () => {
  const xml = transferTwiml({
    number: "+18183008242",
    actionUrl: "https://app.example.com/api/voice/ai/transfer?x=1&y=2",
    say: "Sure — connecting you now.",
  });
  assert.ok(xml.includes("connecting you now"));
  assert.ok(xml.includes("<Number>+18183008242</Number>"));
  // The action is what lets a no-answer resume the AI instead of dying.
  assert.ok(xml.includes(`action="https://app.example.com/api/voice/ai/transfer?x=1&amp;y=2"`));
  assert.ok(/<Dial timeout="\d+"/.test(xml));
});

test("the prompt only knows about transfers when a number is configured", () => {
  const withTransfer = receptionistSystemPrompt({ ...FACTS, transferNumber: "+18183008242" });
  assert.ok(withTransfer.includes('"transfer": true'));
  assert.ok(withTransfer.includes("0"), "press-zero is part of the offer");
  const without = receptionistSystemPrompt(FACTS);
  assert.ok(!without.includes('"transfer"'), "no configured number, no transfer talk");
});

test("seconds read as rings the way a person counts them", () => {
  assert.equal(approxRings(25), 5);
  assert.equal(approxRings(5), 1);
  assert.equal(approxRings(60), 12);
  assert.equal(approxRings(3), 1);
});

test("garbage from the model is a null, not a crash on a live call", () => {
  assert.equal(parseTurnReply("I think we should ask their name"), null);
  assert.equal(parseTurnReply(""), null);
  assert.equal(parseTurnReply('{"done": true}'), null);
});

test("a spoken line is flattened and capped — nobody reads markdown aloud", () => {
  const parsed = parseTurnReply(
    JSON.stringify({ say: "**Great!**\nLine two\n" + "x".repeat(900), done: false })
  );
  assert.ok(parsed);
  assert.ok(!parsed.say.includes("\n"));
  assert.ok(!parsed.say.includes("**"));
  assert.ok(parsed.say.length <= 600);
});

// ── Parsing the end-of-call extraction ───────────────────────────────

test("extraction fills what it heard and defaults what it didn't", () => {
  const parsed = parseExtraction(
    '{"first_name":"Bob","last_name":"Smith","project_type":"Roof replacement","address":"","callback_time":"after 3pm","summary":"Leak over garage, wants estimate."}'
  );
  assert.ok(parsed);
  assert.equal(parsed.first_name, "Bob");
  assert.equal(parsed.address, "");
  assert.equal(parsed.callback_time, "after 3pm");
});

test("extraction carries an agreed slot and defaults it empty when none was", () => {
  const parsed = parseExtraction(
    '{"first_name":"Bob","summary":"Leak.","appointment_date":"2026-09-23","appointment_time":"14:00"}'
  );
  assert.ok(parsed);
  assert.equal(parsed.appointment_date, "2026-09-23");
  assert.equal(parsed.appointment_time, "14:00");
  const bare = parseExtraction('{"summary":"Leak."}');
  assert.ok(bare);
  assert.equal(bare.appointment_date, "");
});

// ── The penciled appointment ─────────────────────────────────────────

test("a concrete agreed slot books; garbage, the past, and the far future don't", () => {
  const today = "2026-09-19";
  assert.deepEqual(
    appointmentFromExtraction(extraction({ appointment_date: "2026-09-23", appointment_time: "14:00" }), today),
    { date: "2026-09-23", time: "14:00" }
  );
  assert.equal(appointmentFromExtraction(null, today), null);
  assert.equal(appointmentFromExtraction(extraction(), today), null);
  assert.equal(appointmentFromExtraction(extraction({ appointment_date: "next Tuesday" }), today), null);
  // Yesterday isn't a booking, and "sometime next spring" isn't either.
  assert.equal(appointmentFromExtraction(extraction({ appointment_date: "2026-09-18" }), today), null);
  assert.equal(appointmentFromExtraction(extraction({ appointment_date: "2026-12-25" }), today), null);
  // Today itself is fine -- "can someone come this afternoon" is real.
  assert.ok(appointmentFromExtraction(extraction({ appointment_date: "2026-09-19", appointment_time: "16:00" }), today));
});

test("a missing or absurd time lands mid-morning instead of failing the booking", () => {
  const today = "2026-09-19";
  assert.equal(
    appointmentFromExtraction(extraction({ appointment_date: "2026-09-23" }), today)?.time,
    "10:00"
  );
  assert.equal(
    appointmentFromExtraction(extraction({ appointment_date: "2026-09-23", appointment_time: "03:00" }), today)?.time,
    "10:00"
  );
  assert.equal(
    appointmentFromExtraction(extraction({ appointment_date: "2026-09-23", appointment_time: "18:30" }), today)?.time,
    "18:30"
  );
});

test("the penciled slot reads like a person wrote it", () => {
  assert.equal(friendlyApptLine("2026-09-23", "14:00"), "Wed, Sep 23 at 2:00 PM");
  assert.equal(friendlyApptLine("2026-10-04", "09:05"), "Sun, Oct 4 at 9:05 AM");
  assert.equal(friendlyApptLine("2026-09-21", "12:30"), "Mon, Sep 21 at 12:30 PM");
});

test("the confirmation text names the slot and asks for the YES", () => {
  const sms = confirmationSms("Ace Roofing", { date: "2026-09-23", time: "14:00" });
  assert.ok(sms.includes("Ace Roofing"));
  assert.ok(sms.includes("Wed, Sep 23 at 2:00 PM"));
  assert.ok(/reply yes/i.test(sms));
  // Without a slot, the plain callback promise stands unchanged.
  assert.ok(!/reply yes/i.test(confirmationSms("Ace Roofing")));
});

test("the note records the penciled slot for the office", () => {
  const note = receptionistNote(
    extraction({ summary: "Leak over garage.", appointment_date: "2026-09-23" }),
    [{ role: "caller", text: "my roof is leaking" }],
    { date: "2026-09-23", time: "14:00" }
  );
  assert.ok(note.includes("Penciled in: Wed, Sep 23 at 2:00 PM"));
  assert.ok(/assign/i.test(note), "the office's next move is named");
});

test("extraction garbage degrades to null, and long fields are capped", () => {
  assert.equal(parseExtraction("no json here"), null);
  const parsed = parseExtraction(JSON.stringify({ first_name: "x".repeat(300), summary: "y".repeat(2000) }));
  assert.ok(parsed);
  assert.ok(parsed.first_name.length <= 60);
  assert.ok(parsed.summary.length <= 500);
});

// ── Call shape limits ────────────────────────────────────────────────

test("the call wraps up at the turn budget, not one turn later", () => {
  assert.equal(forceWrapUp(MAX_AI_TURNS - 1), false);
  assert.equal(forceWrapUp(MAX_AI_TURNS), true);
});

test("caller speech is trimmed and capped before it reaches the model", () => {
  assert.equal(cleanSpeechInput("  hello   there \n"), "hello there");
  assert.equal(cleanSpeechInput("x".repeat(MAX_SPEECH_CHARS + 100)).length, MAX_SPEECH_CHARS);
  assert.equal(cleanSpeechInput("   "), "");
});

// ── Availability: the migration might not have run ───────────────────

test("the receptionist answers only on an explicit true", () => {
  assert.equal(receptionistAvailable(null), false);
  assert.equal(receptionistAvailable({}), false);
  assert.equal(receptionistAvailable({ ai_receptionist_enabled: false }), false);
  assert.equal(receptionistAvailable({ ai_receptionist_enabled: true }), true);
});

// ── What lands on the lead ───────────────────────────────────────────

test("the call note carries the summary and the whole exchange", () => {
  const note = receptionistNote(
    extraction({
      first_name: "Bob",
      last_name: "Smith",
      project_type: "Roof replacement",
      address: "123 Main St",
      callback_time: "after 3pm",
      summary: "Leak over garage.",
    }),
    [
      { role: "caller", text: "my roof is leaking" },
      { role: "assistant", text: "Sorry to hear that — what's your name?" },
    ]
  );
  assert.ok(note.includes("Leak over garage."));
  assert.ok(note.includes("after 3pm"));
  assert.ok(note.includes("Caller: my roof is leaking"));
  assert.ok(note.includes("AI: Sorry to hear that"));
});

test("confirmation text names the company and only sends when there is something to confirm", () => {
  const sms = confirmationSms("Ace Roofing");
  assert.ok(sms.includes("Ace Roofing"));
  assert.ok(sms.length <= 320);

  const good = extraction({ first_name: "Bob", summary: "Roof leak" });
  assert.equal(shouldSendConfirmationSms(good, "+18183008242"), true);
  // Nothing captured means nothing to confirm -- a text would be spam.
  assert.equal(shouldSendConfirmationSms(extraction(), "+18183008242"), false);
  assert.equal(shouldSendConfirmationSms(good, ""), false);
});

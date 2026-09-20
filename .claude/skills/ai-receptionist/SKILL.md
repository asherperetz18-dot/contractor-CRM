---
name: ai-receptionist
description: The AI receptionist's architecture, hard invariants, and the designed-but-unbuilt controls (pickup ring time, transfer-to-human, business hours). Read before touching src/lib/ai-receptionist*, src/app/api/voice/ai/*, the AI Receptionist settings page, or the voice inbound/status seams — and before building any of the planned controls, which are speced here.
---

# AI receptionist — how it works, what must stay true

The AI answers a call that would have hit voicemail, collects details,
pencils in the visit, and files everything. Shipped across PRs #196,
#203; decisions #040 and #043.

## Map

- `src/lib/ai-receptionist.ts` — ALL conversation policy, pure and
  tested (node:test, relative `.ts` imports): TwiML builders, greeting
  (fixed AI+transcription disclosure), system prompt, turn/extraction
  JSON parsers (hardened — garbage degrades to a re-prompt, never a
  crash), turn budget (10), silence policy (one nudge, then goodbye),
  `appointmentFromExtraction` (past/60-day/absurd-hours rules),
  `friendlyApptLine`, note/SMS composers.
- `src/lib/ai-receptionist-engine.ts` — the impure half: Claude per
  turn (claude-opus-5, effort low), session rows, and finalize (lead
  match/create via the 0129 RPC with plain-insert fallback, 🤖
  `lead_notes` transcript, `call_logs` → "AI Receptionist", penciled
  `events` insert, confirmation SMS, lead stage advance via
  `PRE_APPOINTMENT_STAGES`).
- Takeover seams: `api/voice/inbound` (no forwarding number branch) and
  `api/voice/inbound/status` (Dial rang out). Per-turn webhook:
  `api/voice/ai/turn`. All Twilio-signature-validated per company.
- Session table `ai_receptionist_calls` (migration 0160): turns jsonb,
  status active→done→finalizing→finalized, claimed by conditional
  update so no path double-files.
- Finalize runs three ways: `after()` on the goodbye turn (instant), a
  sweep on every inbound call, a 2-hourly GitHub-Actions cron floor —
  NOT a tighter cron: each Actions run bills a full minute.

## Invariants — never break these

- The greeting's first sentence always discloses the AI and the
  transcription; no setting removes it (`aiGreetingText` composes the
  owner's opener AFTER the fixed disclosure).
- Never a price, never a firm booking: appointments are penciled —
  `events` row with status New, `customer_confirmed` false,
  `assigned_to` NULL (the dispatcher is the control point), and the SMS
  says "reply YES to confirm" because the SMS webhook really matches
  that YES to the lead's appointment.
- A caller on a live line never gets a dead line: every failure path
  returns spoken TwiML or falls back to the old voicemail behavior
  (`failsafeTwiml`, the null return from `maybeStartReceptionist`).
- Ships dark pre-migration: settings columns read tolerantly, a missing
  session table falls back to voicemail, the settings form names the
  exact migration file in bold.
- Dates resolve in the COMPANY's timezone (`nowInZone` +
  `TIMEZONE_IANA`), threaded through both the turn prompt and the
  extraction prompt as "today is …" — at 11pm Pacific the server and
  the company disagree about what day it is.
- Model replies are untrusted JSON: parse with the tested parsers, and
  a null parse is a stock re-prompt bounded by the turn budget.

## Planned controls — designed, not built (owner asked; specs agreed)

Build these on the AI Receptionist settings page when asked; each was
scoped deliberately small:

1. **Pickup ring time.** Already exists as
   `company_profile.call_forward_timeout` (SECONDS — the `<Dial
   timeout>` before the status callback hands the call to the AI;
   ~5s ≈ one ring; default 25). Do NOT add a column. Surface the same
   column on the AI Receptionist panel with an "≈ N rings" hint, keep
   Company Profile as the other door to it (one source of truth, two
   doors — the social-links precedent).
2. **Transfer to a human.** New column
   `ai_receptionist_transfer_number text` (next free migration number —
   CHECK MAIN FIRST, see crm-owner-workflow). Blank = feature off.
   Mechanics: the turn JSON contract gains `"transfer": true` (model
   sets it when the caller asks for a person; prompt: offer only when
   configured, offer proactively on emergency vibes); the turn route
   then returns `<Say>` + `<Dial timeout=~25 action=…>` to the number;
   the Dial action on no-answer RESUMES the AI ("Couldn't reach anyone
   — let me take your details instead") so a failed transfer is never a
   dead end. Also accept DTMF 0: `<Gather input="speech dtmf">`, treat
   `Digits === "0"` as transfer intent. Log the transfer in the session
   turns so the note shows it.
3. **Business hours / working days** (later): per-company setting the
   prompt AND `appointmentFromExtraction` both respect; also cures the
   "penciled a Sunday" TECH_DEBT entry and can gate WHEN the AI answers
   at all (after-hours only mode).

## Conventions when changing this feature

- Policy changes go in the pure module with a failing test first; the
  engine and routes stay thin adapters.
- New request shapes to the model get a conservative fallback or a
  surfaced reason (`aiFailureMessage` pattern) — a 400 in production
  taught this; local tests never call the real API.
- Anything spoken goes through `xmlEscape`/`sayTwiml`; Polly voice is
  the `AI_VOICE` constant.
- The owner pilots on his own company only; every rollout is a
  default-off toggle.

## Owner's test-call runbook

Call the company Twilio number, let it ring out, say a name, "roof
leak", an address, "Tuesday afternoon". Expect: lead (source "AI
Receptionist" if new), 🤖 transcript note, call log disposition "AI
Receptionist", penciled Estimate event Tuesday 2 PM with no rep, lead
in Appointment Scheduled, confirmation SMS; replying YES flips the
event to Confirmed. Asking prices must get a polite dodge.

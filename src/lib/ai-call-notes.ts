import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchTranscriptText } from "@/lib/voice-intelligence";
import { leadDisplayName } from "@/lib/data/types";

/**
 * Turns a finished call transcript into the note the rep would have
 * typed. Runs from the transcript-completion webhook, entirely without
 * a signed-in user, so everything here is service-role and every guard
 * is explicit.
 */

const MAX_TRANSCRIPT_CHARS = 30000;

const SYSTEM = `You turn a phone call transcript into a short CRM note for a construction contractor. The transcript is labelled Rep (the contractor's caller) and Customer, from separate audio channels; if the labels look swapped, trust the content.

Write the note a good rep would have typed during the call:
- what the customer wants done (project, scope)
- concrete details that were said: address corrections, budget, timing, decision makers
- objections or hesitations
- what was agreed as the next step, with any day or time mentioned

Rules: only things actually said in the transcript — never invent or pad. Plain short lines, no headings, no markdown. At most 6 lines. If the call was too short or empty to say anything useful, reply with exactly NO_NOTE.`;

export async function writeAiCallNote(callLogId: string): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return;

  const admin = createAdminClient();
  const { data: log } = await admin
    .from("call_logs")
    .select("id, lead_id, rep_id, company_id, transcript_sid, ai_note_at, duration_seconds")
    .eq("id", callLogId)
    .maybeSingle<{
      id: string;
      lead_id: string | null;
      rep_id: string | null;
      company_id: string | null;
      transcript_sid: string | null;
      ai_note_at: string | null;
      duration_seconds: number;
    }>();
  if (!log?.lead_id || !log.company_id || !log.transcript_sid) return;
  // Twilio retries webhooks; one call gets one note.
  if (log.ai_note_at) return;

  const { data: settings } = await admin
    .from("company_profile")
    .select("ai_call_notes_enabled, ai_analysis_model")
    .eq("company_id", log.company_id)
    .maybeSingle<{ ai_call_notes_enabled: boolean; ai_analysis_model: string | null }>();
  if (!settings?.ai_call_notes_enabled) return;

  const transcript = await fetchTranscriptText(log.company_id, log.transcript_sid);
  if (!transcript || transcript.length < 40) return;

  const { data: lead } = await admin
    .from("leads")
    .select("contact_type, company_name, first_name, last_name, project_type, stage")
    .eq("id", log.lead_id)
    .maybeSingle<Parameters<typeof leadDisplayName>[0] & { project_type: string | null; stage: string }>();

  const header = lead
    ? `CONTACT: ${leadDisplayName(lead)} | stage: ${lead.stage} | project on file: ${lead.project_type ?? "-"}\n\n`
    : "";
  const bundle = (header + "TRANSCRIPT:\n" + transcript).slice(0, MAX_TRANSCRIPT_CHARS);

  let note = "";
  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: settings.ai_analysis_model || "claude-opus-5",
      max_tokens: 1000,
      system: SYSTEM,
      thinking: { type: "adaptive" },
      messages: [{ role: "user", content: bundle }],
    });
    if (response.stop_reason === "refusal") return;
    note = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  } catch {
    return;
  }
  if (!note || note === "NO_NOTE") return;

  // Stamp first, note second: if the insert races a webhook retry the
  // stamp is what keeps the loser from writing a duplicate.
  const { data: stamped } = await admin
    .from("call_logs")
    .update({ ai_note_at: new Date().toISOString() })
    .eq("id", callLogId)
    .is("ai_note_at", null)
    .select("id");
  if (!stamped?.length) return;

  await admin.from("lead_notes").insert({
    lead_id: log.lead_id,
    author_id: log.rep_id,
    body: `🤖 AI call notes (${Math.round(log.duration_seconds / 60) || 1} min call):\n${note.slice(0, 3000)}`,
    company_id: log.company_id,
  });
}

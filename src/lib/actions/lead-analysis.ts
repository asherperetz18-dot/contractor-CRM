"use server";

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import { leadDisplayName } from "@/lib/data/types";
import {
  DEFAULT_NEGATIVE_SIGNALS,
  DEFAULT_POSITIVE_SIGNALS,
  type LeadAnalysis,
  type SignalHit,
} from "@/lib/data/ai-analysis";

/**
 * The conversation analyzer: reads everything the CRM knows about one
 * contact -- texts both ways, call outcomes, the note timeline,
 * appointment results -- and reports the buying signals in it.
 *
 * There are no call transcripts (recordings live at Twilio, untranscribed),
 * so calls contribute their metadata: duration, disposition, and the
 * rep's own "what was said" notes. That is stated to the model rather
 * than papered over, so it never pretends to have heard a call.
 */

const MAX_TEXTS = 150;
const MAX_CALLS = 50;
const MAX_NOTES = 50;
const MAX_EVENTS = 30;
const MAX_BUNDLE_CHARS = 24000;

type SettingsRow = {
  ai_analysis_enabled: boolean;
  ai_analysis_model: string;
  ai_analysis_positive_signals: string | null;
  ai_analysis_negative_signals: string | null;
};

export async function getLeadAnalysis(
  leadId: string
): Promise<{ error?: string; enabled?: boolean; analysis?: LeadAnalysis | null }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const supabase = await createClient();
  const [{ data: settings }, { data: row }] = await Promise.all([
    supabase
      .from("company_profile")
      .select("ai_analysis_enabled")
      .eq("company_id", profile.company_id)
      .maybeSingle<{ ai_analysis_enabled: boolean }>(),
    supabase
      .from("lead_ai_analysis")
      .select(
        "temperature, summary, positive_signals, negative_signals, next_step, source_counts, analyzed_at"
      )
      .eq("lead_id", leadId)
      .maybeSingle<LeadAnalysis>(),
  ]);

  return { enabled: !!settings?.ai_analysis_enabled, analysis: row ?? null };
}

export async function analyzeLeadConversation(
  leadId: string
): Promise<{ error?: string; analysis?: LeadAnalysis }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: "AI isn't configured yet." };

  // The lead is loaded as the signed-in user, so RLS decides whether
  // this person can see this contact at all -- the analyzer must not be
  // a side door into someone else's book.
  const supabase = await createClient();
  const { data: lead } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .eq("company_id", profile.company_id)
    .maybeSingle<Record<string, unknown>>();
  if (!lead) return { error: "Contact not found." };

  const admin = createAdminClient();
  const { data: settingsRow } = await admin
    .from("company_profile")
    .select(
      "ai_analysis_enabled, ai_analysis_model, ai_analysis_positive_signals, ai_analysis_negative_signals"
    )
    .eq("company_id", profile.company_id)
    .maybeSingle<SettingsRow>();
  if (!settingsRow?.ai_analysis_enabled) {
    return { error: "AI Analysis is switched off. Turn it on in Admin Settings → AI Analysis." };
  }

  const [texts, calls, notes, events, members] = await Promise.all([
    admin
      .from("sms_messages")
      .select("direction, body, channel, delivery_status, created_at")
      .eq("lead_id", leadId)
      .neq("channel", "rep")
      .order("created_at", { ascending: false })
      .limit(MAX_TEXTS),
    admin
      .from("call_logs")
      .select("direction, status, duration_seconds, disposition, notes, rep_id, created_at")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(MAX_CALLS),
    admin
      .from("lead_notes")
      .select("author_id, body, created_at")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(MAX_NOTES),
    admin
      .from("events")
      .select("title, date, time, status, notes")
      .eq("lead_id", leadId)
      .order("date", { ascending: false })
      .limit(MAX_EVENTS),
    getCompanyMembers(profile.company_id),
  ]);

  const nameById = new Map(members.map((m) => [m.id, m.name || m.email || "staff"]));
  const day = (iso: unknown) => String(iso ?? "").slice(0, 10);

  const lines: string[] = [];
  lines.push(
    `CONTACT: ${leadDisplayName(lead as Parameters<typeof leadDisplayName>[0])} | stage: ${lead.stage} | est. value: $${lead.value ?? 0} | source: ${lead.source ?? "-"} | project: ${lead.project_type ?? "-"} | received: ${day(String(lead.date_received ?? lead.created_at))}`
  );
  if (lead.notes) lines.push(`CONTACT CARD NOTES: ${String(lead.notes).slice(0, 1500)}`);

  const evs = (events.data ?? []).reverse();
  if (evs.length) {
    lines.push("\nAPPOINTMENTS (status is the outcome; No-show and Cancelled mean exactly that):");
    for (const e of evs)
      lines.push(
        `- ${e.date} ${e.time ?? ""} [${e.status}] ${e.title ?? ""}${e.notes ? ` — ${String(e.notes).slice(0, 200)}` : ""}`
      );
  }

  const callRows = (calls.data ?? []).reverse();
  if (callRows.length) {
    lines.push(
      "\nCALLS (no transcripts exist — only duration, outcome, and the rep's own notes):"
    );
    for (const c of callRows)
      lines.push(
        `- ${day(c.created_at)} ${c.direction} ${c.duration_seconds}s [${c.disposition}] by ${nameById.get(String(c.rep_id ?? "")) ?? "staff"}${c.notes ? ` — ${String(c.notes).slice(0, 300)}` : ""}`
      );
  }

  const noteRows = (notes.data ?? []).reverse();
  if (noteRows.length) {
    lines.push("\nSTAFF NOTES:");
    for (const n of noteRows)
      lines.push(
        `- ${day(n.created_at)} ${nameById.get(String(n.author_id ?? "")) ?? "staff"}: ${String(n.body).slice(0, 500)}`
      );
  }

  const textRows = (texts.data ?? []).reverse();
  if (textRows.length) {
    lines.push("\nTEXT CONVERSATION (IN = the customer wrote it):");
    for (const t of textRows) {
      const undelivered =
        t.delivery_status === "undelivered" || t.delivery_status === "failed"
          ? " [NEVER DELIVERED]"
          : "";
      lines.push(
        `- ${day(t.created_at)} ${t.direction === "inbound" ? "IN" : "OUT"}${undelivered}: ${String(t.body).slice(0, 400)}`
      );
    }
  }

  let bundle = lines.join("\n");
  if (bundle.length > MAX_BUNDLE_CHARS) bundle = bundle.slice(-MAX_BUNDLE_CHARS);

  const positive = settingsRow.ai_analysis_positive_signals?.trim() || DEFAULT_POSITIVE_SIGNALS;
  const negative = settingsRow.ai_analysis_negative_signals?.trim() || DEFAULT_NEGATIVE_SIGNALS;

  const system = `You analyze sales conversations for a construction contractor's CRM. You are given the full communication history with one prospect. Report the buying signals actually present in it.

POSITIVE SIGNALS to look for:
${positive}

NEGATIVE SIGNALS to look for:
${negative}

Signals beyond these lists count too when they are clearly meaningful. Every signal you report must point at something that actually happened in the history — quote or closely paraphrase the evidence; never invent, never pad. No signals of a kind means an empty list.

Weigh recency: a price objection three months ago followed by a signed-looking conversation last week is a warm-to-hot picture, not a cold one. Silence matters: many unanswered outbound messages is itself a negative signal.

Reply with ONLY a JSON object, no code fences:
{"temperature":"Hot"|"Warm"|"Cold","summary":"2-3 plain sentences a salesperson would want","positive_signals":[{"signal":"short label","evidence":"what happened, briefly"}],"negative_signals":[{"signal":"short label","evidence":"what happened, briefly"}],"next_step":"one concrete suggested action, or null"}`;

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: settingsRow.ai_analysis_model || "claude-opus-5",
      max_tokens: 2500,
      system,
      thinking: { type: "adaptive" },
      messages: [{ role: "user", content: bundle }],
    });
    if (response.stop_reason === "refusal") {
      return { error: "The model declined to analyze that conversation." };
    }

    const raw = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/, "")
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { error: "The AI returned something unreadable. Try again." };
    }
    const p = parsed as Record<string, unknown>;
    const temperature = ["Hot", "Warm", "Cold"].includes(String(p.temperature))
      ? (String(p.temperature) as LeadAnalysis["temperature"])
      : "Warm";
    const cleanHits = (v: unknown): SignalHit[] =>
      Array.isArray(v)
        ? v
            .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
            .map((x) => ({
              signal: String(x.signal ?? "").slice(0, 120),
              evidence: String(x.evidence ?? "").slice(0, 300),
            }))
            .filter((x) => x.signal)
            .slice(0, 12)
        : [];

    const analysis: LeadAnalysis = {
      temperature,
      summary: String(p.summary ?? "").slice(0, 1500) || "No summary produced.",
      positive_signals: cleanHits(p.positive_signals),
      negative_signals: cleanHits(p.negative_signals),
      next_step: p.next_step ? String(p.next_step).slice(0, 500) : null,
      source_counts: {
        texts: textRows.length,
        calls: callRows.length,
        notes: noteRows.length,
        appointments: evs.length,
      },
      analyzed_at: new Date().toISOString(),
    };

    const { error: saveErr } = await admin.from("lead_ai_analysis").upsert({
      lead_id: leadId,
      company_id: profile.company_id,
      temperature: analysis.temperature,
      summary: analysis.summary,
      positive_signals: analysis.positive_signals,
      negative_signals: analysis.negative_signals,
      next_step: analysis.next_step,
      source_counts: analysis.source_counts,
      analyzed_by: profile.id,
      analyzed_at: analysis.analyzed_at,
    });
    if (saveErr) return { error: saveErr.message };

    return { analysis };
  } catch {
    return { error: "Couldn't reach the AI right now. Try again in a moment." };
  }
}

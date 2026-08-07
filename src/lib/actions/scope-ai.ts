"use server";

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { canCreateEstimates } from "@/lib/data/types";

const MAX_INPUT_CHARS = 6000;

type EstimatorSettings = {
  ai_estimator_enabled: boolean;
  ai_estimator_model: string;
  ai_estimator_instructions: string | null;
  ai_estimator_rate_card: string | null;
};

async function loadEstimatorSettings(
  companyId: string
): Promise<{ error: string } | { settings: EstimatorSettings }> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("company_profile")
    .select(
      "ai_estimator_enabled, ai_estimator_model, ai_estimator_instructions, ai_estimator_rate_card"
    )
    .eq("company_id", companyId)
    .maybeSingle<EstimatorSettings>();
  if (!data) return { error: "Company settings not found." };
  if (!data.ai_estimator_enabled) {
    return {
      error: "The AI estimator is switched off. Turn it on in Admin Settings → AI Estimator.",
    };
  }
  return { settings: data };
}

export type ProposedLine = {
  name: string;
  description: string;
  quantity: number;
  unit: string;
  unit_price_cents: number;
  priced: boolean;
};

const ALLOWED_UNITS = ["ea", "sf", "lf", "sq", "hr", "day", "ls"];

/**
 * Tidies a scope-of-work description into something a homeowner can read.
 *
 * Deliberately a formatter, not a writer: it reorganises and cleans what
 * the rep typed and is told not to invent scope. An estimate is a priced
 * commitment, and a model that helpfully adds "includes haul-away" has
 * committed the contractor to unpriced work.
 */
export async function formatScopeWithAI(
  text: string
): Promise<{ error?: string; formatted?: string }> {
  const input = (text ?? "").trim();
  if (!input) return { error: "Write some scope first, then format it." };
  if (input.length > MAX_INPUT_CHARS) {
    return { error: "That scope is too long to format. Trim it a little and try again." };
  }

  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canCreateEstimates(profile)) {
    return { error: "You don't have permission to edit estimates." };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: "AI isn't configured yet." };

  const system = [
    "You clean up scope-of-work text for a residential construction estimate that a homeowner will read and sign.",
    "",
    "Rules:",
    "- Do NOT add, remove, or change any scope. Never introduce work, materials, exclusions, quantities, or prices that are not already in the text. If something is ambiguous, keep it ambiguous.",
    "- Reorganise into short labelled lines grouped by phase or area, in the order the work happens.",
    "- Use the trade's plain language. Expand obvious shorthand (demo -> demolition), fix spelling and capitalisation.",
    "- Plain text only. No markdown, no bold, no headers. Use '- ' for list items.",
    "- Keep it tight. A homeowner should be able to read it in under a minute.",
    "- Return ONLY the rewritten scope. No preamble, no commentary, no explanation of what you changed.",
  ].join("\n");

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 2000,
      system,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: input }],
    });

    if (response.stop_reason === "refusal") {
      return { error: "The model declined to format that text." };
    }

    const formatted = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    if (!formatted) return { error: "Got an empty result. Try again." };
    return { formatted };
  } catch {
    // The rep's typing is still in the textarea either way -- a failure
    // here must never cost them what they wrote.
    return { error: "Couldn't reach the AI right now. Your text is unchanged." };
  }
}

/**
 * Writes a scope of work from a short brief.
 *
 * Unlike the formatter this genuinely authors text, so it is framed as a
 * first draft the rep edits -- and it is told to leave gaps visible as
 * [TBD] rather than inventing specifics it was not given. A confident
 * fabrication in a scope is worse than an obvious blank: the blank gets
 * filled in, the fabrication gets signed.
 */
export async function generateScopeWithAI(
  brief: string
): Promise<{ error?: string; scope?: string }> {
  const input = (brief ?? "").trim();
  if (!input) return { error: "Describe the job first, even roughly." };
  if (input.length > MAX_INPUT_CHARS) return { error: "That brief is too long." };

  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canCreateEstimates(profile)) return { error: "You don't have permission to edit estimates." };

  const loaded = await loadEstimatorSettings(profile.company_id);
  if ("error" in loaded) return loaded;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: "AI isn't configured yet." };

  const system = [
    "You draft the scope of work for a residential construction estimate, from a contractor's short brief.",
    "",
    "Rules:",
    "- Write only work the brief implies. Do not invent scope to pad it out.",
    "- Where a specific is missing (dimensions, materials, fixture models, counts), write [TBD] rather than guessing. The rep fills those in.",
    "- Group by phase in the order the work happens, with a short heading line and '- ' bullets.",
    "- Plain text only. No markdown, no bold, no headers.",
    "- Never state a price, a total, or a timeline. Those are set elsewhere on the estimate.",
    "- Return ONLY the scope. No preamble.",
    loaded.settings.ai_estimator_instructions
      ? `\nHouse style from this contractor:\n${loaded.settings.ai_estimator_instructions}`
      : "",
  ].join("\n");

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: loaded.settings.ai_estimator_model || "claude-opus-5",
      max_tokens: 3000,
      system,
      thinking: { type: "adaptive" },
      messages: [{ role: "user", content: input }],
    });
    if (response.stop_reason === "refusal") return { error: "The model declined that request." };
    const scope = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!scope) return { error: "Got an empty result. Try again." };
    return { scope };
  } catch {
    return { error: "Couldn't reach the AI right now." };
  }
}

/**
 * Turns a scope into proposed line items.
 *
 * Nothing here is saved. It returns a list the rep reviews and ticks
 * before any of it reaches the estimate, because these numbers end up on
 * a document a homeowner signs.
 *
 * Pricing comes from the company's own rate card. With no rate card the
 * model is explicitly told to return zero prices: a guess at market rates
 * dressed up as an estimate is the one output here that could actually
 * cost the contractor money.
 */
export async function generatePricedLines(
  scope: string
): Promise<{ error?: string; lines?: ProposedLine[]; priced?: boolean }> {
  const input = (scope ?? "").trim();
  if (!input) return { error: "Write or generate a scope first." };
  if (input.length > MAX_INPUT_CHARS) return { error: "That scope is too long to price." };

  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!canCreateEstimates(profile)) return { error: "You don't have permission to edit estimates." };

  const loaded = await loadEstimatorSettings(profile.company_id);
  if ("error" in loaded) return loaded;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: "AI isn't configured yet." };

  const rateCard = (loaded.settings.ai_estimator_rate_card ?? "").trim();
  const canPrice = rateCard.length > 0;

  const system = [
    "You break a construction scope of work into estimate line items.",
    "",
    "Return ONLY a JSON array, with no prose and no code fence. Each element has the shape:",
    '{"name": string, "description": string, "quantity": number, "unit": string, "unit_price_cents": integer}',
    "",
    "Rules:",
    "- One line per distinct billable piece of work. Between 3 and 25 lines.",
    "- name is short, a few words. description is one sentence of detail, or an empty string.",
    `- unit is one of: ${ALLOWED_UNITS.join(", ")}`,
    "- quantity is a number. If the scope states no quantity, use 1 with unit 'ls' (lump sum).",
    "- unit_price_cents is an INTEGER number of cents. $1,250.50 is 125050.",
    canPrice
      ? [
          "- Price ONLY from the contractor's rate card below. Where the rate card does not cover a line, set unit_price_cents to 0 rather than guessing.",
          "",
          "Contractor's rate card:",
          rateCard,
        ].join("\n")
      : "- This contractor has not set a rate card, so you have no basis for pricing. Set unit_price_cents to 0 on EVERY line. Do not guess at market rates.",
    loaded.settings.ai_estimator_instructions
      ? `\nHouse style:\n${loaded.settings.ai_estimator_instructions}`
      : "",
  ].join("\n");

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: loaded.settings.ai_estimator_model || "claude-opus-5",
      max_tokens: 4000,
      system,
      thinking: { type: "adaptive" },
      messages: [{ role: "user", content: input }],
    });
    if (response.stop_reason === "refusal") return { error: "The model declined that request." };

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
    if (!Array.isArray(parsed)) return { error: "The AI didn't return a list of lines." };

    const lines: ProposedLine[] = [];
    for (const row of parsed.slice(0, 25)) {
      const r = row as Record<string, unknown>;
      const name = String(r.name ?? "").trim();
      if (!name) continue;
      // Every field is re-validated rather than trusted. This output feeds
      // money fields, and a string where a number belongs would surface as
      // NaN in a total that somebody signs.
      const qty = Number(r.quantity);
      const cents = Math.round(Number(r.unit_price_cents));
      const unit = String(r.unit ?? "ea").trim().toLowerCase();
      const validPrice = Number.isFinite(cents) && cents > 0;
      lines.push({
        name: name.slice(0, 200),
        description: String(r.description ?? "").trim().slice(0, 2000),
        quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
        unit: ALLOWED_UNITS.includes(unit) ? unit : "ea",
        // Floored to zero rather than rejected, so one malformed row can't
        // discard an otherwise usable draft.
        unit_price_cents: validPrice ? cents : 0,
        priced: validPrice,
      });
    }
    if (lines.length === 0) return { error: "The AI didn't produce any usable lines." };
    return { lines, priced: canPrice };
  } catch {
    return { error: "Couldn't reach the AI right now." };
  }
}

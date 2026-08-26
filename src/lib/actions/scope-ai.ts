"use server";

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { canCreateEstimates } from "@/lib/data/types";

// Roomy on purpose: a commercial remodel's scope ran past the old
// 6,000 and the feature refused exactly the documents that needed
// tidying most. ~24k chars is a few thousand tokens -- still cheap.
const MAX_INPUT_CHARS = 24000;

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

const MAX_EXAMPLES = 2;
const MAX_EXAMPLE_CHARS = 4000;

/**
 * Pulls worked examples from the company's scope library.
 *
 * Examples matching this job's project type come first, then untagged
 * house-standard ones. Capped at two: a third rarely teaches anything new
 * and every example crowds the model's attention away from the actual
 * brief, which is how you get a scope for the wrong job.
 */
async function loadScopeExamples(
  companyId: string,
  estimateId?: string
): Promise<{ name: string; body: string }[]> {
  const supabase = await createClient();

  let projectType: string | null = null;
  if (estimateId) {
    const { data } = await supabase
      .from("estimates")
      .select("leads(project_type)")
      .eq("id", estimateId)
      .eq("company_id", companyId)
      .maybeSingle<{ leads: { project_type: string | null } | null }>();
    projectType = data?.leads?.project_type ?? null;
  }

  const { data: rows } = await supabase
    .from("scope_templates")
    .select("name, project_type, body")
    .eq("company_id", companyId)
    .returns<{ name: string; project_type: string | null; body: string }[]>();

  // Trimmed and lowercased before comparing. Lead project types are part
  // free text and carry trailing spaces and casing variants -- "ADU ",
  // "Adu" and "ADU / Accessory buildings" all exist in this data -- and an
  // exact match would silently find nothing, which looks identical to
  // having no examples at all.
  const norm = (s: string | null) => (s ?? "").trim().toLowerCase();
  const want = norm(projectType);

  const all = rows ?? [];
  const matching = want
    ? all.filter((t) => {
        const have = norm(t.project_type);
        if (!have) return false;
        // Either containing the other counts, so a "Bathroom Remodel"
        // example still serves a lead simply tagged "Bathroom".
        return have === want || have.includes(want) || want.includes(have);
      })
    : [];
  const generic = all.filter((t) => !norm(t.project_type));

  return [...matching, ...generic]
    .slice(0, MAX_EXAMPLES)
    .map((t) => ({ name: t.name, body: t.body.slice(0, MAX_EXAMPLE_CHARS) }));
}

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
      // Must fit a formatted copy of the whole input, or the response
      // truncates -- and a silently cut-off scope replacing the rep's
      // full text destroys priced commitments. Guarded below as well.
      max_tokens: 8000,
      system,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: input }],
    });

    if (response.stop_reason === "refusal") {
      return { error: "The model declined to format that text." };
    }
    if (response.stop_reason === "max_tokens") {
      // Never hand back a truncated scope as if it were the whole thing.
      return { error: "That scope is too long to format in one pass. Split it and try again." };
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
  brief: string,
  estimateId?: string
): Promise<{ error?: string; scope?: string; examplesUsed?: number }> {
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

  // Worked examples from this contractor's own scope library, preferring
  // ones tagged with this job's project type. Examples teach structure and
  // depth far better than instructions do -- "group by phase" is a rule a
  // model can follow badly; a real scope is a target it can match.
  const examples = await loadScopeExamples(profile.company_id, estimateId);

  const system = [
    "You draft the scope of work for a residential construction estimate, from a contractor's short brief.",
    "",
    "Rules:",
    "- Write only work the brief implies. Do not invent scope to pad it out.",
    "- Where a specific is missing (dimensions, materials, fixture models, counts), write [TBD] rather than guessing. The rep fills those in.",
    "- Group by phase in the order the work happens, with a short heading line and simple text bullets.",
    // Without this the built-in bullet rule quietly overrides the
    // contractor's own convention, which is the one thing the examples
    // exist to teach -- verified: numbered sections transferred but the
    // example's bullet character did not, until this line was added.
    "- If examples are provided below, match their bullet character, numbering and heading style exactly, in preference to any formatting habit of your own.",
    "- Plain text only. No markdown, no bold, no headers.",
    "- Never state a price, a total, or a timeline. Those are set elsewhere on the estimate.",
    "- Return ONLY the scope. No preamble.",
    loaded.settings.ai_estimator_instructions
      ? `\nHouse style from this contractor:\n${loaded.settings.ai_estimator_instructions}`
      : "",
    examples.length
      ? [
          "",
          "=== EXAMPLES OF THIS CONTRACTOR'S OWN SCOPES ===",
          "Match their structure, heading style, level of detail and vocabulary.",
          "These are style references for a DIFFERENT job -- do not copy their scope",
          "into your answer, and do not include work from them that the brief does",
          "not call for.",
          "",
          ...examples.map((e) => `--- ${e.name} ---\n${e.body}`),
          "=== END EXAMPLES ===",
        ].join("\n")
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
    return { scope, examplesUsed: examples.length };
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

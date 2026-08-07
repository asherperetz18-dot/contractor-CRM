"use server";

import Anthropic from "@anthropic-ai/sdk";
import { getCurrentProfile } from "@/lib/data/profile";
import { canCreateEstimates } from "@/lib/data/types";

const MAX_INPUT_CHARS = 6000;

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

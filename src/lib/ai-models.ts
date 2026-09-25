/**
 * The thinking setting for a model a company picked in Settings (AI
 * Estimator / AI Analysis). Opus 5 and Sonnet 5 take adaptive thinking;
 * Haiku 4.5 rejects it with a 400, so it runs without -- it's offered as
 * the fastest option, and thinking off is the fast path anyway.
 * Spread into the request: `{ model, ...thinkingFor(model), ... }`.
 */
export function thinkingFor(model: string): { thinking?: { type: "adaptive" } } {
  if (model.startsWith("claude-haiku-")) return {};
  return { thinking: { type: "adaptive" } };
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { SETTINGS_SECTIONS } from "./settings-catalog.ts";

// The CRM's AI features run on Claude through one platform-wide key set in
// Vercel (ANTHROPIC_API_KEY) — a company has no AI key of its own to enter.
// An "OpenAI API Key — Soon" tile told new subscribers otherwise.
test("no settings tile asks a company for an OpenAI key", () => {
  const openAi = SETTINGS_SECTIONS.flatMap((s) => s.cards).filter((c) =>
    /openai/i.test(`${c.title} ${c.desc}`)
  );
  assert.deepEqual(openAi, []);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { thinkingFor } from "./ai-models.ts";

// Settings offer Opus 5, Sonnet 5 and Haiku 4.5 for the AI Estimator and
// AI Analysis. Every call sent adaptive thinking, which Haiku 4.5 rejects
// with "HTTP 400: adaptive thinking is not supported on this model" -- so a
// company that picked the "fastest" option had a feature that never worked.

test("Haiku 4.5 is sent no adaptive thinking", () => {
  assert.deepEqual(thinkingFor("claude-haiku-4-5"), {});
});

test("Opus 5 and Sonnet 5 keep adaptive thinking", () => {
  for (const model of ["claude-opus-5", "claude-sonnet-5"]) {
    assert.deepEqual(thinkingFor(model), { thinking: { type: "adaptive" } }, model);
  }
});

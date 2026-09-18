import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_CHECKLIST_ITEMS_PER_PROPOSAL,
  MAX_TARGETS_PER_PROPOSAL,
  parseChecklistAddParams,
  parseChecklistCheckParams,
} from "./ai-proposals.ts";

/**
 * The AI's checklist proposals arrive as untrusted JSON and are parsed
 * twice — once when the suggestion is stored, once when a human applies
 * it. These validators are that trust boundary: whatever shape the
 * model invents, only clean targets reach the database.
 */

test("a well-formed add proposal parses with labels trimmed and junk dropped", () => {
  const parsed = parseChecklistAddParams({
    project_id: "est-1",
    items: [
      { label: "  Order shingles  ", due_date: "2026-10-01" },
      { label: "" },
      "junk",
      { label: "Call for inspection", due_date: "next week" },
    ],
    summary: "two steps",
  });
  assert.ok(parsed);
  assert.equal(parsed.estimateId, "est-1");
  assert.deepEqual(parsed.items, [
    { label: "Order shingles", dueDate: "2026-10-01" },
    // A due date the model made up in prose is no date, not a crash.
    { label: "Call for inspection", dueDate: null },
  ]);
});

test("an add proposal without a real project or any usable step is refused", () => {
  assert.equal(parseChecklistAddParams({ items: [{ label: "x" }] }), null);
  assert.equal(parseChecklistAddParams({ project_id: "e", items: "not a list" }), null);
  assert.equal(parseChecklistAddParams({ project_id: "e", items: [{ label: "   " }] }), null);
});

test("labels are capped and an oversized batch is refused outright", () => {
  const parsed = parseChecklistAddParams({
    project_id: "e",
    items: [{ label: "x".repeat(500) }],
  });
  assert.ok(parsed);
  assert.equal(parsed.items[0].label.length, 200);

  const tooMany = parseChecklistAddParams({
    project_id: "e",
    items: Array.from({ length: MAX_CHECKLIST_ITEMS_PER_PROPOSAL + 1 }, (_, i) => ({
      label: `step ${i}`,
    })),
  });
  // Same backstop as lead proposals: the AI can ask for more, it just
  // won't get a proposal a human can apply.
  assert.equal(tooMany, null);
});

test("a check-off proposal keeps unique string ids and nothing else", () => {
  const parsed = parseChecklistCheckParams({ item_ids: ["a", "a", "b", 42, null] });
  assert.ok(parsed);
  assert.deepEqual(parsed.itemIds, ["a", "b"]);
});

test("an empty or oversized check-off is refused", () => {
  assert.equal(parseChecklistCheckParams({ item_ids: [] }), null);
  assert.equal(parseChecklistCheckParams({}), null);
  assert.equal(
    parseChecklistCheckParams({
      item_ids: Array.from({ length: MAX_TARGETS_PER_PROPOSAL + 1 }, (_, i) => `id-${i}`),
    }),
    null
  );
});

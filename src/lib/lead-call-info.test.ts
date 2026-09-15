import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeLeadCalls } from "./lead-call-info.ts";

/**
 * The Power Dialer warns when a queued contact was already called today
 * (and pauses auto-dial on them), so a lead who landed in two sessions
 * -- or a re-dialed saved queue -- doesn't get rung three times in an
 * afternoon. These tests pin how the per-lead call summary is derived
 * from their outbound log rows.
 */

test("counts only calls since the boundary; last call is the newest overall", () => {
  const info = summarizeLeadCalls(
    [
      { lead_id: "a", created_at: "2026-09-15T18:30:00Z" },
      { lead_id: "a", created_at: "2026-09-15T15:10:00Z" },
      { lead_id: "a", created_at: "2026-09-10T09:00:00Z" }, // last week: not "today"
      { lead_id: "b", created_at: "2026-09-01T12:00:00Z" }, // only ever called long ago
    ],
    "2026-09-15T07:00:00Z"
  );
  assert.deepEqual(info.get("a"), { callsSince: 2, lastAt: "2026-09-15T18:30:00Z" });
  assert.deepEqual(info.get("b"), { callsSince: 0, lastAt: "2026-09-01T12:00:00Z" });
});

test("a lead with no rows has no entry — never called reads as nothing to warn about", () => {
  const info = summarizeLeadCalls([], "2026-09-15T07:00:00Z");
  assert.equal(info.size, 0);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { analyticsWindowOrFilter, nextDay } from "./analytics-window.ts";

/**
 * Marketing Analytics fetches only the leads its window can use: created
 * in the window, or won in it. The SQL prefilter built here must be a
 * SUPERSET of withinWindow (the client re-filters exactly, DECISIONS
 * #008's pattern) -- so the day bounds translate to timestamp bounds by
 * covering the whole inclusive 'to' day, never by trimming it.
 */

test("nextDay steps calendar days, month and year ends included", () => {
  assert.equal(nextDay("2026-09-16"), "2026-09-17");
  assert.equal(nextDay("2026-09-30"), "2026-10-01");
  assert.equal(nextDay("2026-12-31"), "2027-01-01");
  assert.equal(nextDay("2028-02-28"), "2028-02-29"); // leap year
});

test("all time means no filter at all", () => {
  assert.equal(analyticsWindowOrFilter({ from: null, to: null }), null);
});

test("a from-only window bounds both dates from below", () => {
  assert.equal(
    analyticsWindowOrFilter({ from: "2026-08-01", to: null }),
    "created_at.gte.2026-08-01,won_at.gte.2026-08-01"
  );
});

test("a to-only window covers the whole inclusive final day", () => {
  assert.equal(
    analyticsWindowOrFilter({ from: null, to: "2026-08-31" }),
    "created_at.lt.2026-09-01,won_at.lt.2026-09-01"
  );
});

test("a closed window brackets each date column with and()", () => {
  assert.equal(
    analyticsWindowOrFilter({ from: "2026-08-01", to: "2026-08-31" }),
    "and(created_at.gte.2026-08-01,created_at.lt.2026-09-01)," +
      "and(won_at.gte.2026-08-01,won_at.lt.2026-09-01)"
  );
});

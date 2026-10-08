import { test } from "node:test";
import assert from "node:assert/strict";
import { briefBreakdown } from "./daily-brief.ts";

/**
 * The Daily Brief's two lower tables: where leads came from, and each
 * rep's appointments and calls. They were worked out once, over the last
 * 7 days, so picking Today or This Month changed the numbers above them
 * and left these two still reading a week.
 */

const NOW = Date.parse("2026-10-08T02:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW - n * 86400000).toISOString();

const rows = {
  leads: [
    { created_at: daysAgo(0.5), source: "Google Ads" },
    { created_at: daysAgo(3), source: "Google Ads" },
    { created_at: daysAgo(20), source: "CallRail" },
    { created_at: daysAgo(20), source: "CallRail" },
    { created_at: daysAgo(20), source: "CallRail" },
    // A bought list and a sourceless contact aren't leads (DECISIONS #156).
    { created_at: daysAgo(20), source: "Cold List" },
    { created_at: daysAgo(0.5), source: null },
  ],
  events: [
    { created_at: daysAgo(0.5), assigned_to: "isaac" },
    { created_at: daysAgo(0.5), assigned_to: "isaac" },
    { created_at: daysAgo(3), assigned_to: "isaac" },
    { created_at: daysAgo(20), assigned_to: "simon" },
    { created_at: daysAgo(20), assigned_to: "simon" },
    { created_at: daysAgo(20), assigned_to: "simon" },
    { created_at: daysAgo(20), assigned_to: "simon" },
    { created_at: daysAgo(20), assigned_to: null },
  ],
  calls: [
    { created_at: daysAgo(0.5), rep_id: "simon" },
    { created_at: daysAgo(20), rep_id: "frank" },
    { created_at: daysAgo(20), rep_id: null },
  ],
};
const bought = ["cold list"];
const names = new Map([
  ["isaac", "Isaac Shlush"],
  ["simon", "Simon Benhamo"],
  ["frank", "Frank N"],
]);

test("today's tables hold only the last day's leads and rep activity", () => {
  assert.deepEqual(briefBreakdown(rows, daysAgo(1), bought, names), {
    topSources: [{ source: "Google Ads", count: 1 }],
    repActivity: [
      { name: "Isaac Shlush", appts: 2, calls: 0 },
      { name: "Simon Benhamo", appts: 0, calls: 1 },
    ],
  });
});

test("the week's tables hold the last 7 days", () => {
  assert.deepEqual(briefBreakdown(rows, daysAgo(7), bought, names), {
    topSources: [{ source: "Google Ads", count: 2 }],
    repActivity: [
      { name: "Isaac Shlush", appts: 3, calls: 0 },
      { name: "Simon Benhamo", appts: 0, calls: 1 },
    ],
  });
});

test("the month's tables reach back past the week, busiest first", () => {
  assert.deepEqual(briefBreakdown(rows, daysAgo(30), bought, names), {
    topSources: [
      { source: "CallRail", count: 3 },
      { source: "Google Ads", count: 2 },
    ],
    repActivity: [
      { name: "Simon Benhamo", appts: 4, calls: 1 },
      { name: "Isaac Shlush", appts: 3, calls: 0 },
      { name: "Frank N", appts: 0, calls: 1 },
    ],
  });
});

test("the tables keep the top 5 sources and top 6 reps", () => {
  const many = {
    leads: Array.from({ length: 8 }, (_, i) => ({ created_at: daysAgo(1), source: `Source ${i}` })),
    events: Array.from({ length: 8 }, (_, i) => ({ created_at: daysAgo(1), assigned_to: `rep${i}` })),
    calls: [],
  };
  const out = briefBreakdown(many, daysAgo(7), [], new Map());
  assert.equal(out.topSources.length, 5);
  assert.equal(out.repActivity.length, 6);
  // A rep no longer on the roster still shows, unnamed.
  assert.equal(out.repActivity[0].name, "Unknown");
});

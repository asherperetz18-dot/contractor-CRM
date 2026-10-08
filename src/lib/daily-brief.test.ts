import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { briefBreakdown, briefPeriodStart } from "./daily-brief.ts";

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

/**
 * Today used to mean the last 24 hours, so at 9am it still counted most
 * of yesterday, and its appointments ran from yesterday's date. It now
 * starts at midnight on the company's clock. This Week and This Month
 * stay the last 7 and 30 days.
 */
const LA = "America/Los_Angeles";

test("today starts at midnight on the company's clock, not 24 hours ago", () => {
  // 9am Pacific on Oct 7: two hours of today, none of yesterday.
  assert.deepEqual(briefPeriodStart("today", new Date("2026-10-07T16:00:00.000Z"), LA), {
    since: "2026-10-07T07:00:00.000Z",
    sinceDay: "2026-10-07",
  });
  // 9:30pm Pacific is already Oct 8 in UTC; today is still Oct 7 here.
  assert.deepEqual(briefPeriodStart("today", new Date("2026-10-08T04:30:00.000Z"), LA), {
    since: "2026-10-07T07:00:00.000Z",
    sinceDay: "2026-10-07",
  });
  // Midnight follows the zone, daylight saving included.
  assert.equal(
    briefPeriodStart("today", new Date("2026-12-15T20:00:00.000Z"), LA).since,
    "2026-12-15T08:00:00.000Z"
  );
  assert.equal(
    briefPeriodStart("today", new Date("2026-10-07T16:00:00.000Z"), "America/New_York").since,
    "2026-10-07T04:00:00.000Z"
  );
});

test("this week and this month are still the last 7 and 30 days", () => {
  const now = new Date("2026-10-07T16:00:00.000Z");
  assert.deepEqual(briefPeriodStart("week", now, LA), {
    since: "2026-09-30T16:00:00.000Z",
    sinceDay: "2026-09-30",
  });
  assert.deepEqual(briefPeriodStart("month", now, LA), {
    since: "2026-09-07T16:00:00.000Z",
    sinceDay: "2026-09-07",
  });
});

const action = readFileSync(new URL("./actions/daily-brief.ts", import.meta.url), "utf8");

test("calls and texts are read in full for the last 30 days, not cut off at 1000 rows", () => {
  // A bare select stops at 1000 rows without a word. Past 1000 calls or
  // texts in total, the Calls, talk time, Texts and each rep's Calls
  // were counted over whichever 1000 came back. No period looks back
  // further than the month, so that's all that's read, and it's paged
  // like the leads and appointments.
  assert.match(action, /const monthAgo = periodStart\("month"\)\.since;/);
  for (const table of ["call_logs", "sms_messages"]) {
    const at = action.indexOf(`.from("${table}")`);
    assert.ok(at > 0, table);
    assert.match(action.slice(at - 250, at), /selectAll<[\s\S]*\(rangeFrom, rangeTo\) =>\s*supabase\s*$/, table);
    const query = action.slice(at, action.indexOf("),", at));
    assert.match(query, /\.gte\("created_at", monthAgo\)/, table);
    assert.match(query, /\.order\("id"\)/, table);
    assert.match(query, /\.range\(rangeFrom, rangeTo\)/, table);
  }
});

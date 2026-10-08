import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { briefBreakdown, briefEarliestStart, briefPeriodStart } from "./daily-brief.ts";

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

test("today's tables hold only today's leads and rep activity", () => {
  assert.deepEqual(briefBreakdown(rows, daysAgo(1), bought, names), {
    topSources: [{ source: "Google Ads", count: 1 }],
    repActivity: [
      { name: "Isaac Shlush", appts: 2, calls: 0 },
      { name: "Simon Benhamo", appts: 0, calls: 1 },
    ],
  });
});

test("the week's tables hold everything since the week began", () => {
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
 * Every period starts at midnight on the company's clock: Today that
 * morning, This Week on Monday, This Month on the 1st. Today used to be
 * the last 24 hours (at 9am it still counted most of yesterday), and
 * This Week and This Month the last 7 and 30 days -- This Month on
 * Oct 7 reached back into early September.
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

test("this week starts on Monday at midnight on the company's clock", () => {
  // Wednesday Oct 7, 9am Pacific: since Monday Oct 5.
  assert.deepEqual(briefPeriodStart("week", new Date("2026-10-07T16:00:00.000Z"), LA), {
    since: "2026-10-05T07:00:00.000Z",
    sinceDay: "2026-10-05",
  });
  // On a Monday the week is just today.
  assert.equal(briefPeriodStart("week", new Date("2026-10-05T16:00:00.000Z"), LA).sinceDay, "2026-10-05");
  // Sunday is the week's last day, not the next one's first.
  assert.equal(briefPeriodStart("week", new Date("2026-10-11T16:00:00.000Z"), LA).sinceDay, "2026-10-05");
  // Sunday 9:30pm Pacific is already Monday in UTC; it's still this week here.
  assert.equal(briefPeriodStart("week", new Date("2026-10-12T04:30:00.000Z"), LA).sinceDay, "2026-10-05");
});

test("this month starts on the 1st at midnight on the company's clock", () => {
  assert.deepEqual(briefPeriodStart("month", new Date("2026-10-07T16:00:00.000Z"), LA), {
    since: "2026-10-01T07:00:00.000Z",
    sinceDay: "2026-10-01",
  });
  // Sep 30, 9:30pm Pacific is already Oct 1 in UTC; it's still September here.
  assert.deepEqual(briefPeriodStart("month", new Date("2026-10-01T04:30:00.000Z"), LA), {
    since: "2026-09-01T07:00:00.000Z",
    sinceDay: "2026-09-01",
  });
  // December's midnight is on standard time.
  assert.equal(
    briefPeriodStart("month", new Date("2026-12-15T20:00:00.000Z"), LA).since,
    "2026-12-01T08:00:00.000Z"
  );
});

test("calls and texts are read back to whichever period starts first", () => {
  // Usually the 1st...
  assert.equal(briefEarliestStart(new Date("2026-10-07T16:00:00.000Z"), LA), "2026-10-01T07:00:00.000Z");
  // ...but on Friday Oct 2 the week began Monday Sep 28, before the month did.
  assert.equal(briefEarliestStart(new Date("2026-10-02T16:00:00.000Z"), LA), "2026-09-28T07:00:00.000Z");
});

const action = readFileSync(new URL("./actions/daily-brief.ts", import.meta.url), "utf8");

test("calls and texts are read in full for the brief's periods, not cut off at 1000 rows", () => {
  // A bare select stops at 1000 rows without a word. Past 1000 calls or
  // texts in total, the Calls, talk time, Texts and each rep's Calls
  // were counted over whichever 1000 came back. Only what the periods
  // cover is read, and it's paged like the leads and appointments.
  assert.match(action, /const readFrom = briefEarliestStart\(now, zone\);/);
  for (const table of ["call_logs", "sms_messages"]) {
    const at = action.indexOf(`.from("${table}")`);
    assert.ok(at > 0, table);
    assert.match(action.slice(at - 250, at), /selectAll<[\s\S]*\(rangeFrom, rangeTo\) =>\s*supabase\s*$/, table);
    const query = action.slice(at, action.indexOf("),", at));
    assert.match(query, /\.gte\("created_at", readFrom\)/, table);
    assert.match(query, /\.order\("id"\)/, table);
    assert.match(query, /\.range\(rangeFrom, rangeTo\)/, table);
  }
});

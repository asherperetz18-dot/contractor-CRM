import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { briefBreakdown, briefNumbers, briefPeriodStart, briefReadWindow, type BriefRows } from "./daily-brief.ts";

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

test("the brief reads back to whichever period starts first, and a week ahead", () => {
  // Usually the 1st...
  assert.deepEqual(briefReadWindow(new Date("2026-10-07T16:00:00.000Z"), LA), {
    since: "2026-10-01T07:00:00.000Z",
    sinceDay: "2026-10-01",
    today: "2026-10-07",
    weekAhead: "2026-10-14",
  });
  // ...but on Friday Oct 2 the week began Monday Sep 28, before the month did.
  assert.deepEqual(briefReadWindow(new Date("2026-10-02T16:00:00.000Z"), LA), {
    since: "2026-09-28T07:00:00.000Z",
    sinceDay: "2026-09-28",
    today: "2026-10-02",
    weekAhead: "2026-10-09",
  });
});

/**
 * A company's whole history, and every figure the brief shows for it.
 * Friday Oct 2, 9am Pacific: Today is since midnight, This Week since
 * Monday Sep 28 -- before the month began -- and This Month since Oct 1.
 * Most of the history is older than any period, which is the point:
 * nothing out there may move a number.
 */
const FRI = new Date("2026-10-02T16:00:00.000Z");
const TODAY = "2026-10-02T15:00:00.000Z";
const OCT1 = "2026-10-01T18:00:00.000Z";
const SEP29 = "2026-09-29T18:00:00.000Z";
const AUG = "2026-08-15T18:00:00.000Z";
const OLD = "2025-01-10T18:00:00.000Z";

type BookLead = {
  id: string; created_at: string; stage_key: string | null; value: number | null; won_at: string | null;
  source: string | null; refund_status: string; refund_requested_at: string | null; has_appt: string | null;
};
type BookEvent = {
  created_at: string; date: string; status: string; assigned_to: string | null; customer_confirmed: boolean;
  rain_alert_pop: number | null;
};
type Book = {
  leads: BookLead[];
  events: BookEvent[];
  calls: BriefRows["calls"];
  texts: BriefRows["texts"];
  tasks: { lead_id: string; due_date: string; completed_at: string | null }[];
};

const lead = (over: Partial<BookLead> & { id: string; created_at: string }): BookLead => ({
  stage_key: "new",
  value: null,
  won_at: null,
  source: "Google Ads",
  refund_status: "None",
  refund_requested_at: null,
  has_appt: null,
  ...over,
});
const event = (over: Partial<BookEvent> & { created_at: string; date: string }): BookEvent => ({
  status: "New",
  assigned_to: null,
  customer_confirmed: false,
  rain_alert_pop: null,
  ...over,
});

const book: Book = {
  leads: [
    lead({ id: "l1", created_at: TODAY }),
    lead({ id: "l2", created_at: OCT1, source: "CallRail" }),
    lead({ id: "l3", created_at: SEP29 }),
    lead({ id: "l4", created_at: TODAY, source: "Cold List" }),
    // Came in back in August, won this morning.
    lead({ id: "l5", created_at: AUG, stage_key: "won", value: 1_200_000, won_at: TODAY }),
    lead({ id: "l6", created_at: SEP29, stage_key: "won", value: 500_000, won_at: "2026-09-30T18:00:00.000Z", source: "Referral" }),
    // Refund asked for two months ago, and again last week.
    lead({ id: "l7", created_at: OLD, stage_key: "lost", refund_status: "Requested", refund_requested_at: "2026-08-01T18:00:00.000Z" }),
    lead({ id: "l8", created_at: AUG, refund_status: "Requested", refund_requested_at: "2026-09-25T18:00:00.000Z", has_appt: "2026-08-20" }),
    lead({ id: "l9", created_at: OLD }),
    lead({ id: "l10", created_at: OLD, stage_key: null }),
  ],
  events: [
    event({ created_at: TODAY, date: "2026-10-02", status: "Showed", assigned_to: "isaac", customer_confirmed: true }),
    event({ created_at: AUG, date: "2026-10-01", status: "Won", assigned_to: "simon" }),
    event({ created_at: SEP29, date: "2026-09-30", status: "No-show", assigned_to: "isaac" }),
    // Tomorrow, unconfirmed, rain likely.
    event({ created_at: AUG, date: "2026-10-03", rain_alert_pop: 70, assigned_to: "simon" }),
    event({ created_at: AUG, date: "2026-10-08", status: "Confirmed", customer_confirmed: true, rain_alert_pop: 60 }),
    event({ created_at: AUG, date: "2026-10-03", status: "Cancelled", rain_alert_pop: 80 }),
    event({ created_at: OLD, date: "2025-01-20", status: "Showed", assigned_to: "frank" }),
    event({ created_at: OCT1, date: "2026-11-15", assigned_to: "frank" }),
    event({ created_at: AUG, date: "2026-10-12", rain_alert_pop: 90 }),
  ],
  calls: [
    { created_at: TODAY, duration_seconds: 120, rep_id: "simon" },
    { created_at: SEP29, duration_seconds: 600, rep_id: "isaac" },
    { created_at: AUG, duration_seconds: 300, rep_id: "frank" },
  ],
  texts: [
    { created_at: TODAY, direction: "outbound" },
    { created_at: OCT1, direction: "inbound" },
    { created_at: SEP29, direction: "outbound" },
    { created_at: AUG, direction: "outbound" },
  ],
  tasks: [
    { lead_id: "l9", due_date: "2026-09-20", completed_at: null },
    // Overdue, but on a lost lead.
    { lead_id: "l7", due_date: "2026-09-20", completed_at: null },
    { lead_id: "l1", due_date: "2026-10-05", completed_at: null },
    { lead_id: "l9", due_date: "2026-09-01", completed_at: TODAY },
    { lead_id: "l2", due_date: "2026-09-28", completed_at: SEP29 },
    { lead_id: "l10", due_date: "2025-01-01", completed_at: OLD },
    // Due today is not overdue yet.
    { lead_id: "l9", due_date: "2026-10-02", completed_at: null },
    { lead_id: "l10", due_date: "2026-01-01", completed_at: null },
  ],
};

const EXPECTED = {
  periods: {
    today: {
      leadsAdded: 1, apptsBooked: 1, apptsScheduled: 1, showed: 1, noShow: 0, calls: 1, talkMinutes: 2,
      textsOut: 1, textsIn: 0, tasksCompleted: 1, won: 1, wonValue: 1_200_000,
    },
    week: {
      leadsAdded: 4, apptsBooked: 3, apptsScheduled: 3, showed: 2, noShow: 1, calls: 2, talkMinutes: 12,
      textsOut: 2, textsIn: 1, tasksCompleted: 2, won: 2, wonValue: 1_700_000,
    },
    month: {
      leadsAdded: 2, apptsBooked: 2, apptsScheduled: 2, showed: 2, noShow: 0, calls: 1, talkMinutes: 2,
      textsOut: 1, textsIn: 1, tasksCompleted: 1, won: 1, wonValue: 1_200_000,
    },
  },
  attention: { overdueTasks: 2, unconfirmedSoon: 1, staleRefunds: 1, rainRisk: 2 },
  breakdown: {
    today: {
      topSources: [{ source: "Google Ads", count: 1 }],
      repActivity: [
        { name: "Isaac Shlush", appts: 1, calls: 0 },
        { name: "Simon Benhamo", appts: 0, calls: 1 },
      ],
    },
    week: {
      topSources: [
        { source: "Google Ads", count: 2 },
        { source: "CallRail", count: 1 },
        { source: "Referral", count: 1 },
      ],
      repActivity: [
        { name: "Isaac Shlush", appts: 2, calls: 1 },
        { name: "Frank N", appts: 1, calls: 0 },
        { name: "Simon Benhamo", appts: 0, calls: 1 },
      ],
    },
    month: {
      topSources: [
        { source: "Google Ads", count: 1 },
        { source: "CallRail", count: 1 },
      ],
      repActivity: [
        { name: "Isaac Shlush", appts: 1, calls: 0 },
        { name: "Frank N", appts: 1, calls: 0 },
        { name: "Simon Benhamo", appts: 0, calls: 1 },
      ],
    },
  },
};

/**
 * The book as the brief reads it: the same bounds as each of its queries
 * (pinned against the action below). It used to read the whole book --
 * every lead, appointment and task the company ever had -- each time it
 * opened. The figures above were worked out on that whole book, before
 * the reads were narrowed, and haven't moved.
 */
function asRead(b: Book, now: Date, zone: string): BriefRows {
  const read = briefReadWindow(now, zone);
  const stageOf = new Map(b.leads.map((l) => [l.id, l.stage_key]));
  return {
    newLeads: b.leads.filter((l) => l.created_at >= read.since),
    wonLeads: b.leads.flatMap((l) => (l.won_at && l.won_at >= read.since ? [{ won_at: l.won_at, value: l.value }] : [])),
    openRefunds: b.leads.filter((l) => l.refund_status === "Requested"),
    bookedEvents: b.events.filter((e) => e.created_at >= read.since),
    datedEvents: b.events.filter((e) => e.date >= read.sinceDay && e.date <= read.weekAhead),
    calls: b.calls.filter((c) => c.created_at >= read.since),
    texts: b.texts.filter((t) => t.created_at >= read.since),
    doneTasks: b.tasks.flatMap((t) =>
      t.completed_at && t.completed_at >= read.since ? [{ completed_at: t.completed_at }] : []
    ),
    overdueTasks: b.tasks
      .filter((t) => !t.completed_at && t.due_date < read.today)
      .map((t) => ({ leads: { stage_key: stageOf.get(t.lead_id) ?? null } })),
  };
}

test("every figure on the brief, for a company with years of history", () => {
  assert.deepEqual(briefNumbers(asRead(book, FRI, LA), FRI, LA, bought, names), EXPECTED);
});

const action = readFileSync(new URL("./actions/daily-brief.ts", import.meta.url), "utf8");

/** Each paged read of `table` in the action: the filters it adds past the company. */
function readsOf(table: string): { bounds: string; ordered: boolean }[] {
  const pattern = new RegExp(
    `selectAll<[^(]*\\(\\s*\\(rangeFrom, rangeTo\\) =>\\s*supabase\\s*\\.from\\("${table}"\\)([\\s\\S]*?)\\.range\\(rangeFrom, rangeTo\\)`,
    "g"
  );
  return [...action.matchAll(pattern)].map(([, chain]) => ({
    bounds: (chain.replace(/\s+/g, "").match(/\.(gte|lte|lt|eq|is)\([^)]*\)/g) ?? [])
      .filter((f) => !f.startsWith('.eq("company_id"'))
      .join(""),
    ordered: chain.includes('.order("id")'),
  }));
}

test("every read is paged and goes only as far back as a figure needs", () => {
  // Calls and texts were a bare select, which stops at 1000 rows without
  // a word. Leads, appointments and tasks were read in full -- every one
  // the company ever had, some 79 pages of 1,000 at 79,000 contacts --
  // each time the brief opened. Each read now carries asRead's bounds,
  // paged in id order so the pages don't overlap.
  assert.match(action, /const read = briefReadWindow\(now, zone\);/);
  const expected: Record<string, string[]> = {
    leads: ['.gte("created_at",read.since)', '.gte("won_at",read.since)', '.eq("refund_status","Requested")'],
    events: ['.gte("created_at",read.since)', '.gte("date",read.sinceDay).lte("date",read.weekAhead)'],
    lead_tasks: ['.gte("completed_at",read.since)', '.is("completed_at",null).lt("due_date",read.today)'],
    call_logs: ['.gte("created_at",read.since)'],
    sms_messages: ['.gte("created_at",read.since)'],
  };
  for (const [table, bounds] of Object.entries(expected)) {
    const reads = readsOf(table);
    assert.deepEqual(reads.map((r) => r.bounds), bounds, table);
    assert.ok(reads.every((r) => r.ordered), table);
    // No other, unbounded read of the table hides elsewhere.
    assert.equal(action.split(`.from("${table}")`).length - 1, reads.length, table);
  }
  // An overdue task brings its lead's stage, so one on a closed lead is
  // skipped without reading the leads.
  assert.match(action, /\.select\("id, leads\(stage_key\)"\)/);
});

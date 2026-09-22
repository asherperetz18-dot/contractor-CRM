import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDashboardRollup,
  coerceDashboardRollup,
  rollupBoundaries,
  winRates,
  type RollupInputs,
} from "./dashboard-rollup.ts";

/**
 * The dashboard is reduced in the database (dashboard_rollup, migration
 * 0162) with this pure builder as the tested mirror and the fallback
 * until that migration runs. These tests pin the buckets the SQL must
 * agree with. Every clock-dependent edge is passed in as a boundary
 * date, so the SQL and this mirror can never disagree about "today".
 *
 * Units follow the app's own split: signed/collected/owed figures are
 * integer cents (estimates.total_cents, portal_payments.amount_cents),
 * pipeline stage `value` stays in the dollars the leads table stores.
 */

// September 20th, mid-month: the window is "this month".
const NOW = new Date(2026, 8, 20, 12, 0, 0);
const WIN = { from: "2026-09-01", to: null };
const B = rollupBoundaries(WIN, NOW);

test("boundaries: every cutoff the SQL needs, precomputed", () => {
  assert.equal(B.today, "2026-09-20");
  assert.deepEqual({ from: B.from, to: B.to }, { from: "2026-09-01", to: null });
  // This-month-to-date compares against the same span of last month --
  // "vs August" means Aug 1-20, not a 20-day window straddling August.
  assert.deepEqual({ from: B.prevFrom, to: B.prevTo }, { from: "2026-08-01", to: "2026-08-20" });
  assert.equal(B.monthsFrom, "2025-10-01");
  assert.equal(B.d30, "2026-08-21");
  assert.equal(B.d60, "2026-07-22");
  assert.equal(B.d90, "2026-06-22");
  assert.equal(B.callsFrom, "2026-09-07");
  // The fallback fetch must cover the month series AND both windows.
  assert.equal(B.fetchFrom, "2025-10-01");
});

test("boundaries: a custom range compares to the equal span right before it", () => {
  const b = rollupBoundaries({ from: "2026-03-01", to: "2026-03-31" }, NOW);
  assert.deepEqual({ from: b.prevFrom, to: b.prevTo }, { from: "2026-01-29", to: "2026-02-28" });
  // The month series still reaches further back, so it stays the floor.
  assert.equal(b.fetchFrom, "2025-10-01");
  // A window older than the month series widens the floor to reach its
  // own comparison span.
  const old = rollupBoundaries({ from: "2025-03-01", to: "2025-03-31" }, NOW);
  assert.equal(old.fetchFrom, "2025-01-29");
});

test("boundaries: month-to-date at a month's edge clamps the previous month's day", () => {
  // March 31st: "vs February" cannot be February 31st.
  const b = rollupBoundaries({ from: "2026-03-01", to: null }, new Date(2026, 2, 31, 9));
  assert.deepEqual({ from: b.prevFrom, to: b.prevTo }, { from: "2026-02-01", to: "2026-02-28" });
});

const inputs: RollupInputs = {
  boundaries: B,
  leadsInWindow: [
    { id: "L1", created_at: "2026-09-02T10:00:00Z", stage: "New Leads", value: 1000, has_appt: true, source: "Meta", assigned_to: "r1" },
    { id: "L2", created_at: "2026-09-05T10:00:00Z", stage: "Estimate Sent", value: 2000, has_appt: true, source: "Meta", assigned_to: "r1" },
    { id: "L3", created_at: "2026-09-10T10:00:00Z", stage: "Won", value: 3000, has_appt: false, source: "", assigned_to: "r2" },
    { id: "L4", created_at: "2026-09-12T10:00:00Z", stage: "New Leads", value: 0, has_appt: false, source: "Referral", assigned_to: null },
  ],
  prevLeadCount: 7,
  openLeads: [
    { stage: "New Leads", value: 100, updated_at: "2026-09-15T08:00:00Z" },
    { stage: "New Leads", value: 200, updated_at: "2026-08-01T08:00:00Z" },
    { stage: "Estimate Sent", value: 300, updated_at: "2026-05-01T08:00:00Z" },
    // Defensive: a closed stage never reaches the panel even if fetched.
    { stage: "Won", value: 999, updated_at: "2026-09-15T08:00:00Z" },
  ],
  signedSinceMonths: [
    { assigned_to: "r1", signed_at: "2026-09-03T10:00:00Z", total_cents: 200000, kind: "contract", status: "Signed" },
    { assigned_to: "r2", signed_at: "2026-09-15T10:00:00Z", total_cents: 300000, kind: "contract", status: "Signed" },
    { assigned_to: "r1", signed_at: "2026-08-10T10:00:00Z", total_cents: 150000, kind: "contract", status: "Signed" },
    { assigned_to: "r1", signed_at: "2026-08-25T10:00:00Z", total_cents: 111100, kind: "contract", status: "Signed" },
    { assigned_to: "r2", signed_at: "2025-11-05T10:00:00Z", total_cents: 50000, kind: "contract", status: "Signed" },
    // Change orders are not sales -- excluded everywhere, same rule as
    // Marketing Analytics.
    { assigned_to: "r1", signed_at: "2026-09-04T10:00:00Z", total_cents: 77777, kind: "change_order", status: "Signed" },
  ],
  paymentsSinceMonths: [
    { amount_cents: 100000, status: "succeeded", paid_at: "2026-09-05T10:00:00Z", created_at: "2026-09-01T10:00:00Z" },
    // No paid_at: the record date stands in, same as the Payments page.
    { amount_cents: 50000, status: "succeeded", paid_at: null, created_at: "2026-08-15T10:00:00Z" },
    { amount_cents: 25000, status: "pending", paid_at: null, created_at: "2026-09-10T10:00:00Z" },
  ],
  estimatesForFunnel: [
    { lead_id: "L2", status: "Sent", kind: "contract", total_cents: 0 },
    { lead_id: "L3", status: "Signed", kind: "contract", total_cents: 500000 },
    { lead_id: "L3", status: "Signed", kind: "change_order", total_cents: 99999 },
    { lead_id: "L1", status: "Draft", kind: "contract", total_cents: 0 },
  ],
  awaiting: [{ total_cents: 80000 }, { total_cents: 20000 }],
  billedPhases: [
    { id: "PH1", amount_cents: 100000, requested_at: "2026-09-01T00:00:00Z", due_date: "2026-09-25" },
    { id: "PH2", amount_cents: 50000, requested_at: "2026-08-01T00:00:00Z", due_date: "2026-09-10" },
    { id: "PH3", amount_cents: 40000, requested_at: "2026-07-01T00:00:00Z", due_date: "2026-08-05" },
    { id: "PH4", amount_cents: 30000, requested_at: "2026-04-01T00:00:00Z", due_date: "2026-05-01" },
    { id: "PH5", amount_cents: 60000, requested_at: "2026-08-15T00:00:00Z", due_date: "2026-09-01" },
    { id: "PH6", amount_cents: 25000, requested_at: "2026-08-15T00:00:00Z", due_date: "2026-09-01" },
  ],
  phasePayments: [
    { estimate_payment_id: "PH2", status: "succeeded", amount_cents: 20000 },
    { estimate_payment_id: "PH5", status: "pending", amount_cents: 60000 },
    { estimate_payment_id: "PH6", status: "succeeded", amount_cents: 25000 },
  ],
  eventsInWindow: [
    { date: "2026-09-03", assigned_to: "r1" },
    { date: "2026-09-10", assigned_to: "r1" },
    { date: "2026-09-18", assigned_to: "r2" },
  ],
  prevEventCount: 5,
  apptsToday: 2,
  overdueTasks: 4,
  callsInWindow: [
    { duration_seconds: 0, created_at: "2026-09-08T10:00:00Z" },
    { duration_seconds: 120, created_at: "2026-09-08T11:00:00Z" },
    { duration_seconds: 300, created_at: "2026-09-19T10:00:00Z" },
  ],
  callsRecent: [
    { created_at: "2026-09-08T10:00:00Z" },
    { created_at: "2026-09-08T11:00:00Z" },
    { created_at: "2026-09-19T10:00:00Z" },
  ],
  jobs: [
    { status: "In Progress", end_date: null, updated_at: "2026-09-01T00:00:00Z" },
    { status: "In Progress", end_date: null, updated_at: "2026-09-01T00:00:00Z" },
    { status: "Not Started", end_date: null, updated_at: "2026-09-01T00:00:00Z" },
    { status: "On Hold", end_date: null, updated_at: "2026-09-01T00:00:00Z" },
    { status: "Complete", end_date: "2026-09-05", updated_at: "2026-09-05T00:00:00Z" },
    { status: "Complete", end_date: "2026-01-01", updated_at: "2026-01-01T00:00:00Z" },
  ],
};

const R = buildDashboardRollup(inputs);

test("KPI totals: current window and the period before it", () => {
  assert.deepEqual(R.window, {
    leads: 4,
    appts: 3,
    signedCount: 2,
    signedCents: 500000,
    collectedCents: 100000,
  });
  assert.deepEqual(R.prev, {
    leads: 7,
    appts: 5,
    signedCount: 1,
    signedCents: 150000,
    collectedCents: 50000,
  });
});

test("months: twelve buckets oldest first, signed by signed_at, collected by paid date", () => {
  assert.equal(R.months.length, 12);
  assert.equal(R.months[0].month, "2025-10");
  assert.equal(R.months[11].month, "2026-09");
  const by = new Map(R.months.map((m) => [m.month, m]));
  assert.deepEqual(by.get("2025-11"), { month: "2025-11", signedCents: 50000, collectedCents: 0 });
  assert.deepEqual(by.get("2026-08"), { month: "2026-08", signedCents: 261100, collectedCents: 50000 });
  assert.deepEqual(by.get("2026-09"), { month: "2026-09", signedCents: 500000, collectedCents: 100000 });
  assert.deepEqual(by.get("2026-01"), { month: "2026-01", signedCents: 0, collectedCents: 0 });
});

test("funnel: the window's cohort, and a signed lead always counts as estimated", () => {
  // estimated = the customer saw a contract (any non-Draft status);
  // signed = a signed true contract, the same signed-equals-sale rule as
  // Marketing Analytics. Drafts count nothing.
  assert.deepEqual(R.funnel, { leads: 4, withAppt: 2, estimated: 2, signed: 1 });
});

test("sources: count and signed-contract credit, busiest first", () => {
  assert.deepEqual(R.sources, [
    { source: "Meta", count: 2, signedCount: 0, signedCents: 0 },
    { source: "Referral", count: 1, signedCount: 0, signedCents: 0 },
    { source: "Unknown", count: 1, signedCount: 1, signedCents: 500000 },
  ]);
});

test("stages: open stages only, bucketed by how recently the lead was touched", () => {
  assert.deepEqual(R.stages, [
    {
      stage: "Estimate Sent",
      buckets: {
        d30: { count: 0, value: 0 },
        d60: { count: 0, value: 0 },
        d90: { count: 0, value: 0 },
        all: { count: 1, value: 300 },
      },
    },
    {
      stage: "New Leads",
      buckets: {
        d30: { count: 1, value: 100 },
        d60: { count: 2, value: 300 },
        d90: { count: 2, value: 300 },
        all: { count: 2, value: 300 },
      },
    },
  ]);
});

test("aging: same phase math as Payments -- paid drops out, clearing is never overdue", () => {
  // PH1 not yet due (100000) + PH5 clearing (60000) wait in notYetDue;
  // PH2 owes its remainder 10 days late; PH6 is fully paid and gone.
  assert.deepEqual(R.aging, {
    notYetDueCents: 160000,
    late1_30Cents: 30000,
    late31_60Cents: 40000,
    late61PlusCents: 30000,
    overdueCount: 3,
  });
  assert.equal(R.attention.overdueOwedCents, 100000);
  assert.equal(R.attention.overdueOwedCount, 3);
});

test("attention: live counts ride through, awaiting signature sums Sent and Viewed contracts", () => {
  assert.equal(R.attention.overdueTasks, 4);
  assert.equal(R.attention.apptsToday, 2);
  assert.equal(R.attention.awaitingCount, 2);
  assert.equal(R.attention.awaitingCents, 100000);
});

test("team: signed dollars per rep with their window appointments, biggest seller first", () => {
  assert.deepEqual(R.team, [
    { rep: "r2", signedCount: 1, signedCents: 300000, appts: 1 },
    { rep: "r1", signedCount: 1, signedCents: 200000, appts: 2 },
  ]);
});

test("calls: window totals plus a filled day-by-day dial strip", () => {
  assert.equal(R.calls.dials, 3);
  assert.equal(R.calls.connected, 2);
  assert.equal(R.calls.talkSeconds, 420);
  assert.equal(R.calls.perDay.length, 14);
  assert.deepEqual(R.calls.perDay[0], { day: "2026-09-07", dials: 0 });
  const by = new Map(R.calls.perDay.map((d) => [d.day, d.dials]));
  assert.equal(by.get("2026-09-08"), 2);
  assert.equal(by.get("2026-09-19"), 1);
  assert.equal(by.get("2026-09-20"), 0);
});

test("production: live status counts, finished scoped to the window", () => {
  assert.deepEqual(R.production, {
    notStarted: 1,
    inProgress: 2,
    onHold: 1,
    completedInWindow: 1,
  });
});

test("coerce: the RPC's JSON round-trips to exactly the builder's shape", () => {
  assert.deepEqual(coerceDashboardRollup(JSON.parse(JSON.stringify(R))), R);
});

test("coerce: junk comes back as a zeroed rollup, never a crash", () => {
  const z = coerceDashboardRollup({});
  assert.equal(z.window.leads, 0);
  assert.equal(z.attention.overdueTasks, 0);
  assert.deepEqual(z.months, []);
  assert.deepEqual(z.stages, []);
  assert.equal(z.aging.notYetDueCents, 0);
  assert.deepEqual(coerceDashboardRollup(null).sources, []);
});

test("team: a sale is credited to the contract's Sales team seats, not the rep stamped on it", () => {
  const r = buildDashboardRollup({
    ...inputs,
    signedSinceMonths: [
      // Stamped on r2 (held the lead when the draft was raised); the panel
      // says r1 100%, r2 in the zero-share second seat.
      { assigned_to: "r2", signed_at: "2026-09-03T10:00:00Z", total_cents: 800000, kind: "contract", status: "Signed", sales_rep_1: "r1", sales_rep_1_bp: 10000, sales_rep_2: "r2", sales_rep_2_bp: 0 },
      // A partnership: both get the sale, the dollars split by share.
      { assigned_to: "r1", signed_at: "2026-09-05T10:00:00Z", total_cents: 100000, kind: "contract", status: "Signed", sales_rep_1: "r1", sales_rep_1_bp: 5000, sales_rep_2: "r3", sales_rep_2_bp: 5000 },
      // No seats (signed before the panel existed): the stamped rep, whole.
      { assigned_to: "r3", signed_at: "2026-09-06T10:00:00Z", total_cents: 1000, kind: "contract", status: "Signed" },
    ],
  });
  const by = Object.fromEntries(r.team.map((t) => [t.rep, t]));
  assert.deepEqual([by.r1.signedCount, by.r1.signedCents], [2, 850000]);
  assert.deepEqual([by.r2.signedCount, by.r2.signedCents], [0, 0]);
  assert.deepEqual([by.r3.signedCount, by.r3.signedCents], [2, 51000]);
});

test("win rates: signed out of the cohort's leads, and out of the ones that got an appointment", () => {
  const R = buildDashboardRollup(inputs);
  // Same period's leads, same signed count, two denominators: every lead
  // created in the window, and the ones that were booked (has_appt).
  assert.deepEqual(winRates(R), {
    fromLeads: { rate: 25, signed: 1, of: 4 },
    fromAppts: { rate: 50, signed: 1, of: 2 },
  });
  // Nothing booked yet: no rate to show, never a divide-by-zero.
  const quiet = buildDashboardRollup({
    ...inputs,
    leadsInWindow: inputs.leadsInWindow.map((l) => ({ ...l, has_appt: false })),
  });
  assert.deepEqual(winRates(quiet).fromAppts, { rate: null, signed: 1, of: 0 });
  assert.deepEqual(winRates(buildDashboardRollup({ ...inputs, leadsInWindow: [] })), {
    fromLeads: { rate: null, signed: 0, of: 0 },
    fromAppts: { rate: null, signed: 0, of: 0 },
  });
});

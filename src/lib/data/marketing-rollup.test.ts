import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMarketingRollup,
  coerceMarketingRollup,
  marketingBoundaries,
  type MarketingRollupInputs,
} from "./marketing-rollup.ts";

/**
 * Marketing Analytics is served by marketing_analytics_rollup (0164)
 * with this pure builder as its tested mirror and the fallback until the
 * migration runs. These tests pin the page's definitions:
 *
 *   * money is signed true contracts -- never the pipeline stage;
 *   * the tiles, sources and stages read the window's cohort (leads
 *     created in it); the team's appointments, estimates and contracts
 *     are dated in the window, as on the rep report;
 *   * the weekly strip is by date, twelve Monday-start weeks;
 *   * a bought-list source can be excluded everywhere at once.
 */

const B = {
  today: "2026-09-20",
  from: "2026-08-21",
  to: null,
  prevFrom: "2026-07-21",
  prevTo: "2026-08-20",
  weeksFrom: "2026-06-29",
  fetchFrom: "2026-06-29",
};

const lead = (over: Record<string, unknown>) => ({
  id: "x",
  contact_type: "Individual",
  company_name: null,
  first_name: "A",
  last_name: null,
  phone: null,
  source: null,
  stage: "New",
  value: 0,
  has_appt: false,
  assigned_to: null,
  lead_cost: null,
  created_at: "2026-09-01T10:00:00Z",
  won_at: null,
  ...over,
});
const est = (over: Record<string, unknown>) => ({
  id: "e",
  lead_id: "x",
  status: "Draft",
  kind: null,
  assigned_to: null,
  total_cents: 0,
  sent_at: null,
  issued_at: null,
  created_at: "2026-09-01T10:00:00Z",
  signed_at: null,
  ...over,
});

const LEADS = [
  // Cohort, CA Pro: won by stage, backed by a signed contract.
  lead({ id: "l1", source: "CA Pro", stage: "Won", value: 1000, has_appt: true, assigned_to: "asher", lead_cost: 375, won_at: "2026-09-10T00:00:00Z" }),
  // Cohort, CA Pro: won by stage, NO contract -- the discrepancy the page flags.
  lead({ id: "l2", source: "CA Pro", stage: "Won", value: 600000, assigned_to: "james", lead_cost: 375, won_at: "2026-09-12T00:00:00Z" }),
  // Cohort, Cold List: nothing happened, default-priced.
  lead({ id: "l3", source: "Cold List", stage: "New", value: 0, assigned_to: "asher", lead_cost: 375 }),
  // Cohort, Roy: appointment, hand-priced, estimate sent, not signed.
  lead({ id: "l4", source: "Roy", stage: "Contacted", value: 40, has_appt: true, assigned_to: "brendan", lead_cost: 197 }),
  // Cohort, blank source folds to Unknown, no cost at all.
  lead({ id: "l5", source: "", stage: "Lost", value: 5, created_at: "2026-09-19T23:30:00Z" }),
  // Previous window: one lead with a contract.
  lead({ id: "p1", source: "CA Pro", stage: "Won", value: 100, has_appt: true, created_at: "2026-08-01T00:00:00Z" }),
  // Older still: in the weekly strip, outside both windows.
  lead({ id: "w1", source: "Roy", stage: "New", value: 0, created_at: "2026-07-01T00:00:00Z" }),
  // Before the strip entirely -- counted nowhere.
  lead({ id: "old", source: "Roy", stage: "New", value: 0, created_at: "2026-01-01T00:00:00Z" }),
];

const ESTIMATES = [
  // l1's sale: signed by asher in the window. A change order on the
  // same lead is excluded by kind everywhere.
  est({ id: "c1", lead_id: "l1", status: "Signed", kind: null, assigned_to: "asher", total_cents: 50_000_00, sent_at: "2026-09-05T00:00:00Z", signed_at: "2026-09-10T15:00:00Z" }),
  est({ id: "c1b", lead_id: "l1", status: "Signed", kind: "change_order", assigned_to: "asher", total_cents: 99_999, signed_at: "2026-09-11T00:00:00Z" }),
  // l4: sent by the document's stamp (brendan) while the lead is held by
  // brendan too; not signed.
  est({ id: "c2", lead_id: "l4", status: "Sent", kind: "contract", assigned_to: "brendan", total_cents: 4_000_00, sent_at: "2026-09-08T00:00:00Z" }),
  // A draft is never "an estimate sent".
  est({ id: "c3", lead_id: "l3", status: "Draft", assigned_to: "asher", total_cents: 1 }),
  // The previous window's lead, signed back then.
  est({ id: "c4", lead_id: "p1", status: "Signed", kind: null, assigned_to: "asher", total_cents: 10_000_00, sent_at: "2026-08-02T00:00:00Z", signed_at: "2026-08-05T00:00:00Z" }),
  // An old lead signed in the window: counts for the team and the
  // weekly strip (dated), not for the cohort tiles.
  est({ id: "c5", lead_id: "old", status: "Signed", kind: null, assigned_to: "brendan", total_cents: 7_000_00, sent_at: "2026-08-30T00:00:00Z", signed_at: "2026-09-02T00:00:00Z" }),
];

const EVENTS = [
  { assigned_to: "asher", status: "Won", date: "2026-09-10", lead_id: "l1" },
  { assigned_to: "asher", status: "No-show", date: "2026-09-11", lead_id: "l3" },
  // Past its date, still unresolved: counted as "no result", never as a failure.
  { assigned_to: "asher", status: "Confirmed", date: "2026-09-15", lead_id: null },
  // Tomorrow's appointment is booked, not unresolved.
  { assigned_to: "asher", status: "New", date: "2026-09-21", lead_id: null },
  { assigned_to: "brendan", status: "Showed", date: "2026-09-08", lead_id: "l4" },
  // Outside the window: dropped.
  { assigned_to: "brendan", status: "Showed", date: "2026-08-01", lead_id: "p1" },
];

const INPUTS: MarketingRollupInputs = {
  boundaries: B,
  defaultCost: 375,
  excludeSources: [],
  leads: LEADS,
  estimates: ESTIMATES,
  events: EVENTS,
};

test("boundaries: previous period and a Monday-start 12-week strip", () => {
  // Sep 20 2026 is a Sunday; its ISO week starts Mon Sep 14, and eleven
  // weeks before that is Mon Jun 29.
  const b = marketingBoundaries({ from: "2026-08-21", to: null }, new Date(2026, 8, 20, 12));
  assert.equal(b.today, "2026-09-20");
  assert.deepEqual([b.prevFrom, b.prevTo], ["2026-07-21", "2026-08-20"]);
  assert.equal(b.weeksFrom, "2026-06-29");
  // The fallback fetches from whichever edge is oldest.
  assert.equal(b.fetchFrom, "2026-06-29");
  const all = marketingBoundaries({ from: null, to: null }, new Date(2026, 8, 20, 12));
  assert.equal(all.prevFrom, null);
  assert.equal(all.fetchFrom, null);
});

test("totals: one revenue definition, and the Won-without-contract gap is counted", () => {
  const r = buildMarketingRollup(INPUTS);
  assert.deepEqual(r.totals, {
    leads: 5,
    leadValue: 601045,
    withAppt: 2,
    estimated: 2,
    signed: 1,
    signedCents: 50_000_00,
    wonStage: 2,
    wonStageValue: 601000,
    wonNoContract: 1,
    spend: 375 + 375 + 375 + 197,
    costKnown: 4,
    atDefault: 3,
  });
  assert.deepEqual(r.prev, { leads: 1, withAppt: 1, signed: 1, signedCents: 10_000_00 });
});

test("sources rank by money, then appointments, then volume; blank folds to Unknown", () => {
  const r = buildMarketingRollup(INPUTS);
  assert.deepEqual(
    r.bySource.map((s) => s.source),
    ["CA Pro", "Roy", "Cold List", "Unknown"]
  );
  const ca = r.bySource[0];
  assert.deepEqual(ca, {
    source: "CA Pro",
    count: 2,
    withAppt: 1,
    estimated: 1,
    signed: 1,
    signedCents: 50_000_00,
    spend: 750,
    costKnown: 2,
    atDefault: 2,
  });
  const roy = r.bySource[1];
  assert.equal(roy.estimated, 1);
  assert.equal(roy.atDefault, 0);
  assert.equal(roy.costKnown, 1);
});

test("team: the rep report's definitions, dated in the window", () => {
  const r = buildMarketingRollup(INPUTS);
  const asher = r.byRep.find((x) => x.rep === "asher")!;
  // Won counts as attended; the unresolved past appointment is a
  // "no result", tomorrow's is nothing yet.
  assert.deepEqual(asher, {
    rep: "asher",
    leads: 2,
    appts: 4,
    attended: 1,
    noShow: 1,
    noOutcome: 1,
    estimates: 1,
    signed: 1,
    signedCents: 50_000_00,
  });
  const brendan = r.byRep.find((x) => x.rep === "brendan")!;
  // c5 is an old lead's contract signed this month: the rep report
  // credits it, the cohort tiles do not.
  assert.deepEqual(brendan, {
    rep: "brendan",
    leads: 1,
    appts: 1,
    attended: 1,
    noShow: 0,
    noOutcome: 0,
    estimates: 2,
    signed: 1,
    signedCents: 7_000_00,
  });
  // james holds a cohort lead and nothing else -- still a row, so the
  // Won-without-contract lead has somewhere to be seen.
  assert.equal(r.byRep.find((x) => x.rep === "james")?.leads, 1);
  // Ranked by signed dollars first.
  assert.deepEqual(r.byRep.map((x) => x.rep), ["asher", "brendan", "james"]);
});

test("an estimate is credited to whoever holds the lead until it is frozen", () => {
  const leads = [
    lead({ id: "h1", source: "Roy", assigned_to: "nina" }),
  ];
  const estimates = [
    // Stamped on carl at creation; the lead moved to nina; still open ->
    // nina's estimate.
    est({ id: "o1", lead_id: "h1", status: "Viewed", assigned_to: "carl", sent_at: "2026-09-03T00:00:00Z" }),
    // Signed by carl: frozen on carl regardless of who holds the lead now.
    est({ id: "o2", lead_id: "h1", status: "Signed", assigned_to: "carl", total_cents: 100, sent_at: "2026-09-04T00:00:00Z", signed_at: "2026-09-05T00:00:00Z" }),
  ];
  const r = buildMarketingRollup({ ...INPUTS, leads, estimates, events: [] });
  assert.equal(r.byRep.find((x) => x.rep === "nina")?.estimates, 1);
  assert.equal(r.byRep.find((x) => x.rep === "carl")?.estimates, 1);
  assert.equal(r.byRep.find((x) => x.rep === "carl")?.signed, 1);
});

test("weeks: twelve Monday buckets, leads by created day, contracts by signed day", () => {
  const r = buildMarketingRollup(INPUTS);
  assert.equal(r.weeks.length, 12);
  assert.equal(r.weeks[0].week, "2026-06-29");
  assert.equal(r.weeks[11].week, "2026-09-14");
  const wk = (day: string) => r.weeks.find((w) => w.week === day)!;
  // w1 was created Wed Jul 1 -> the Jun 29 week.
  assert.equal(wk("2026-06-29").leads, 1);
  // Sep 1 (Tue) is the Aug 31 week: l1..l4; l5 lands on Sep 19 (Sat) in
  // the Sep 14 week.
  assert.equal(wk("2026-08-31").leads, 4);
  assert.equal(wk("2026-09-14").leads, 1);
  // Signed: c5 on Sep 2 (Aug 31 week), c1 on Sep 10 (Sep 7 week), c4 on
  // Aug 5 (Aug 3 week). The change order never counts.
  assert.deepEqual([wk("2026-08-31").signed, wk("2026-09-07").signed, wk("2026-08-03").signed], [1, 1, 1]);
  assert.equal(wk("2026-09-07").signedCents, 50_000_00);
  assert.equal(r.weeks.reduce((s, w) => s + w.signed, 0), 3);
});

test("stages: the cohort's rows, all stages, ready for the page to order", () => {
  const r = buildMarketingRollup(INPUTS);
  const m = new Map(r.byStage.map((s) => [s.stage, s]));
  assert.deepEqual(m.get("Won"), { stage: "Won", count: 2, value: 601000 });
  assert.deepEqual(m.get("New"), { stage: "New", count: 1, value: 0 });
  assert.equal(m.get("Lost")?.count, 1);
});

test("recent signed: the cohort's contracts, newest first, with what the row prints", () => {
  const r = buildMarketingRollup(INPUTS);
  assert.equal(r.recentSigned.length, 1);
  assert.deepEqual(r.recentSigned[0], {
    estimateId: "c1",
    leadId: "l1",
    contact_type: "Individual",
    company_name: null,
    first_name: "A",
    last_name: null,
    source: "CA Pro",
    rep: "asher",
    signedAt: "2026-09-10T15:00:00Z",
    totalCents: 50_000_00,
    createdAt: "2026-09-01T10:00:00Z",
  });
});

test("excluding a bought list removes its leads from every bucket at once", () => {
  const r = buildMarketingRollup({ ...INPUTS, excludeSources: ["Cold List"] });
  assert.equal(r.totals.leads, 4);
  assert.equal(r.bySource.some((s) => s.source === "Cold List"), false);
  // The no-show on the cold-list lead goes with it; asher keeps the rest.
  const asher = r.byRep.find((x) => x.rep === "asher")!;
  assert.equal(asher.appts, 3);
  assert.equal(asher.noShow, 0);
  assert.equal(asher.leads, 1);
});

test("all time: no previous period, every lead is the cohort", () => {
  const r = buildMarketingRollup({
    ...INPUTS,
    boundaries: { ...B, from: null, to: null, prevFrom: null, prevTo: null, fetchFrom: null },
  });
  assert.equal(r.prev, null);
  assert.equal(r.totals.leads, 8);
  assert.equal(r.totals.signed, 3);
  assert.equal(r.recentSigned.map((s) => s.estimateId).join(","), "c1,c5,c4");
});

test("coerce: stringly aggregates become numbers and missing pieces become empty", () => {
  const r = coerceMarketingRollup({
    totals: { leads: "5", signedCents: "12" },
    prev: { leads: "2" },
    bySource: [{ source: "X", count: "3" }],
    weeks: [{ week: "2026-06-29", leads: "1" }],
  });
  assert.equal(r.totals.leads, 5);
  assert.equal(r.totals.signedCents, 12);
  assert.equal(r.totals.wonNoContract, 0);
  assert.deepEqual(r.prev, { leads: 2, withAppt: 0, signed: 0, signedCents: 0 });
  assert.equal(r.bySource[0].count, 3);
  assert.equal(r.bySource[0].atDefault, 0);
  assert.deepEqual(r.byRep, []);
  assert.deepEqual(r.recentSigned, []);
  assert.equal(r.weeks[0].signed, 0);
  assert.equal(coerceMarketingRollup(null).prev, null);
});

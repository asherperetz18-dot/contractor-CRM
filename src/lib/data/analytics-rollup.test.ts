import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAnalyticsRollup, coerceRollup } from "./analytics-rollup.ts";

/**
 * The All Time funnel is reduced in the database (marketing_funnel_rollup,
 * 0157) with this pure builder as the tested mirror and the fallback
 * until that migration runs. These tests pin the buckets the SQL must
 * agree with -- they are the same judgments the browser used to make
 * from the full 79k-lead array.
 */

const lead = (over: Record<string, unknown>) => ({
  id: "x",
  contact_type: "Individual",
  company_name: null,
  first_name: "A",
  last_name: null,
  source: null,
  stage: "New",
  value: 0,
  created_at: "2026-01-01T00:00:00Z",
  won_at: null,
  has_appt: false,
  assigned_to: null,
  lead_cost: null,
  phone: null,
  ...over,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

const LEADS = [
  lead({ id: "l1", source: "Meta", stage: "Won", value: 100, won_at: "2026-02-01T00:00:00Z", has_appt: true, assigned_to: "r1", lead_cost: 50 }),
  lead({ id: "l2", source: "Meta", stage: "New", value: 40, assigned_to: "r1" }),
  lead({ id: "l3", source: "", stage: "Won", value: 60, won_at: "2026-03-01T00:00:00Z", assigned_to: "r2" }),
  // Won by stage but no won_at: counted per rep, absent from the Won
  // stat cards and Recent Won -- same asymmetry the view always had.
  lead({ id: "l4", source: "Referral", stage: "Won", value: 9, assigned_to: "r1" }),
];
const CONTRACTS = [
  { lead_id: "l1", status: "Signed", kind: null, total_cents: 500000 },
  { lead_id: "l1", status: "Signed", kind: "change_order", total_cents: 99999 },
  { lead_id: "l9", status: "Signed", kind: null, total_cents: 1 },
];

test("totals mirror the stat cards: created counts all, won needs a won_at", () => {
  const r = buildAnalyticsRollup(LEADS, CONTRACTS);
  assert.deepEqual(r.totals, { created: 4, createdValue: 209, won: 2, wonValue: 160 });
});

test("sources: blank folds to Unknown, cost averages only over priced leads, sold needs a signed contract", () => {
  const r = buildAnalyticsRollup(LEADS, CONTRACTS);
  const meta = r.bySource.find((s) => s.source === "Meta")!;
  // Only the true contract counts toward revenue -- change orders are
  // excluded by kind, exactly as the view's signedByLead map did.
  assert.deepEqual(meta, {
    source: "Meta",
    count: 2,
    withAppt: 1,
    spend: 50,
    costKnown: 1,
    sold: 1,
    revenue: 500000,
  });
  assert.ok(r.bySource.find((s) => s.source === "Unknown"));
  // Busiest source first, same as the table's sort.
  assert.equal(r.bySource[0].source, "Meta");
});

test("per-rep rows count by stage (no won_at needed) and skip the unassigned", () => {
  const r = buildAnalyticsRollup(LEADS, CONTRACTS);
  assert.deepEqual(r.byRep.find((x) => x.assigned_to === "r1"), {
    assigned_to: "r1",
    count: 3,
    wonCount: 2,
    wonValue: 109,
  });
  assert.equal(r.byRep.length, 2);
});

test("stages and recent won: raw groups, and the 8 newest wins by won_at", () => {
  const r = buildAnalyticsRollup(LEADS, CONTRACTS);
  assert.deepEqual(r.byStage.find((s) => s.stage === "New"), { stage: "New", count: 1, value: 40 });
  assert.deepEqual(r.recentWon.map((l) => l.id), ["l3", "l1"]);
});

test("coerceRollup turns JSON's stringly numerics back into numbers", () => {
  const r = coerceRollup({
    totals: { created: "4", createdValue: "209", won: 2, wonValue: "160" },
    bySource: [{ source: "Meta", count: "2", withAppt: 1, spend: "50", costKnown: "1", sold: 1, revenue: "500000" }],
    byRep: [{ assigned_to: "r1", count: "3", wonCount: "2", wonValue: "109" }],
    byStage: [{ stage: "New", count: "1", value: "40" }],
    recentWon: [lead({ id: "l3" })],
  });
  assert.equal(r.totals.created, 4);
  assert.equal(r.bySource[0].revenue, 500000);
  assert.equal(r.byRep[0].wonValue, 109);
  assert.equal(r.byStage[0].value, 40);
  assert.equal(r.recentWon[0].id, "l3");
});

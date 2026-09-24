import { test } from "node:test";
import assert from "node:assert/strict";
import { contractFilingOptions, costsForContract, unassignedJobCosts } from "./types.ts";

// ── Which contract a bill belongs to ─────────────────────────────────

const docs = [
  { id: "c1", doc_number: "EST-1106", title: "Gutters", kind: "contract", parent_estimate_id: null },
  { id: "c2", doc_number: "EST-1117", title: "Exterior Paint", kind: "contract", parent_estimate_id: null },
  { id: "co", doc_number: "EST-1117-CO1", title: "Trim", kind: "change_order", parent_estimate_id: "c2" },
  { id: "cert", doc_number: "EST-1117-C", title: "", kind: "completion", parent_estimate_id: "c2" },
];
const phases = [
  { id: "p2b", estimate_id: "c2", name: "Final", sort_order: 2, cancelled_at: null },
  { id: "p2a", estimate_id: "c2", name: "Deposit", sort_order: 1, cancelled_at: null },
  { id: "p1a", estimate_id: "c1", name: "Deposit", sort_order: 1, cancelled_at: null },
  { id: "p1x", estimate_id: "c1", name: "Old", sort_order: 2, cancelled_at: "2026-08-01" },
  { id: "pco", estimate_id: "co", name: "Trim", sort_order: 1, cancelled_at: null },
];

test("one entry per contract, its phases in schedule order, change orders under their contract", () => {
  const opts = contractFilingOptions(docs, phases);
  assert.deepEqual(opts, [
    { estimateId: "c1", label: "EST-1106 · Gutters", phases: [{ id: "p1a", name: "Deposit" }] },
    {
      estimateId: "c2",
      label: "EST-1117 · Exterior Paint",
      phases: [
        { id: "p2a", name: "Deposit" },
        { id: "p2b", name: "Final" },
        { id: "pco", name: "EST-1117-CO1 · Trim" },
      ],
    },
  ]);
});

test("a contract with no live phase can't take a bill, so it isn't offered", () => {
  const opts = contractFilingOptions(docs, phases.filter((p) => p.estimate_id !== "c1" || p.cancelled_at));
  assert.deepEqual(opts.map((o) => o.estimateId), ["c2"]);
});

// ── Bills no contract can claim ──────────────────────────────────────

test("with two contracts, an unfiled bill belongs to neither -- counted as unassigned", () => {
  const expenses = [
    { amount_cents: 2750000, estimate_payment_id: null },
    { amount_cents: 22448, estimate_payment_id: "gone" },
    { amount_cents: 500, estimate_payment_id: "p2a" },
  ];
  const all = new Set(["p1a", "p2a", "p2b"]);
  assert.deepEqual(unassignedJobCosts({ leadExpenses: expenses, allPhaseIds: all, contractsOnLead: 2 }), {
    count: 2,
    cents: 2772448,
  });
  // The same bills are exactly the ones no contract counted.
  for (const ids of [["p1a"], ["p2a", "p2b"]]) {
    const r = costsForContract({
      leadExpenses: expenses,
      contractPhaseIds: new Set(ids),
      allPhaseIds: all,
      leadHasOneContract: false,
    });
    assert.ok(r.cents <= 500);
  }
});

test("with one contract, an unfiled bill is that contract's -- nothing unassigned", () => {
  assert.deepEqual(
    unassignedJobCosts({
      leadExpenses: [{ amount_cents: 100, estimate_payment_id: null }],
      allPhaseIds: new Set(),
      contractsOnLead: 1,
    }),
    { count: 0, cents: 0 }
  );
});

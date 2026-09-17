import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeProjectRollup,
  phaseReceivableCents,
  netAccrualCents,
  projectTriageOrder,
  type ProjectRollup,
} from "./types.ts";

/**
 * Owed-to-you is per phase, matching the Money to Collect page. The bug
 * these tests pin down: a $1,000 deposit (no phase id, by design) used
 * to pay down a $4,500 billed phase, so Projects said $3,500 owed while
 * Collect said $4,500.
 */

const billed = (id: string, amount: number) => ({
  id,
  amount_cents: amount,
  requested_at: "2026-09-02T10:00:00Z",
});
const unbilled = (id: string, amount: number) => ({
  id,
  amount_cents: amount,
  requested_at: null,
});
const payment = (
  phaseId: string | null,
  amount: number,
  status: "succeeded" | "pending" = "succeeded"
) => ({ estimate_payment_id: phaseId, amount_cents: amount, status });

test("a deposit never pays down a billed phase", () => {
  // EST-1068's exact shape: $4,500 billed, $1,000 deposit collected.
  const owed = phaseReceivableCents(
    [billed("rough-in", 450000), unbilled("finishes", 450000)],
    [payment(null, 100000)]
  );
  assert.equal(owed, 450000);
});

test("a payment filed to the phase settles it", () => {
  const owed = phaseReceivableCents([billed("rough-in", 450000)], [payment("rough-in", 450000)]);
  assert.equal(owed, 0);
});

test("a partial payment on the phase leaves the rest owed", () => {
  const owed = phaseReceivableCents([billed("rough-in", 450000)], [payment("rough-in", 200000)]);
  assert.equal(owed, 250000);
});

test("an overpaid phase does not lend its surplus to another", () => {
  const owed = phaseReceivableCents(
    [billed("a", 100000), billed("b", 100000)],
    [payment("a", 150000)]
  );
  assert.equal(owed, 100000);
});

test("pending payments have not arrived and settle nothing", () => {
  const owed = phaseReceivableCents(
    [billed("rough-in", 450000)],
    [payment("rough-in", 450000, "pending")]
  );
  assert.equal(owed, 450000);
});

test("unbilled phases are not owed yet", () => {
  assert.equal(phaseReceivableCents([unbilled("finishes", 450000)], []), 0);
});

test("a payment filed to another contract's phase is ignored", () => {
  const owed = phaseReceivableCents([billed("mine", 450000)], [payment("theirs", 450000)]);
  assert.equal(owed, 450000);
});

test("the rollup carries the phase-computed figure through unchanged", () => {
  // The deposit still counts as Collected -- it is real money in -- it
  // just no longer shrinks Owed.
  const rollup = computeProjectRollup({
    contractTotalCents: 2000000,
    signedChangeOrderCents: 0,
    payments: [{ status: "succeeded", amount_cents: 100000 }],
    receivableCents: 450000,
    filedCostCents: 22097,
    unfiledCostCents: 0,
    ownsUnfiledCosts: true,
  });
  assert.equal(rollup.receivableCents, 450000);
  assert.equal(rollup.collectedCents, 100000);
  assert.equal(rollup.netCashCents, 100000 - 22097);
});

// ── Rep commission in the rollup ─────────────────────────────────────
//
// Cash basis, by the owner's call: the figure is commission actually
// PAID or advanced against the job (the payout ledger), never the
// projected share -- which on a barely-costed job reads enormous and
// sank net cash on jobs that were fine. Passed in rather than computed
// here, because only the caller reads the ledger.

test("commission paid comes out of net cash", () => {
  const rollup = computeProjectRollup({
    contractTotalCents: 1300000,
    signedChangeOrderCents: 0,
    payments: [{ status: "succeeded", amount_cents: 1300000 }],
    receivableCents: 0,
    filedCostCents: 388600,
    unfiledCostCents: 0,
    ownsUnfiledCosts: true,
    commissionCents: 358200,
  });
  assert.equal(rollup.commissionCents, 358200);
  assert.equal(rollup.netCashCents, 1300000 - 388600 - 358200);
});

test("a caller that does not track commission changes nothing", () => {
  // The single-project report can be shown to the customer, and pay
  // never prints there -- so the input is optional and its absence
  // leaves every figure exactly as it always was.
  const rollup = computeProjectRollup({
    contractTotalCents: 1300000,
    signedChangeOrderCents: 0,
    payments: [{ status: "succeeded", amount_cents: 1300000 }],
    receivableCents: 0,
    filedCostCents: 388600,
    unfiledCostCents: 0,
    ownsUnfiledCosts: true,
  });
  assert.equal(rollup.commissionCents, null);
  assert.equal(rollup.netCashCents, 1300000 - 388600);
});

test("an explicit null -- ledger not readable -- subtracts nothing", () => {
  const rollup = computeProjectRollup({
    contractTotalCents: 1300000,
    signedChangeOrderCents: 0,
    payments: [],
    receivableCents: 0,
    filedCostCents: 0,
    unfiledCostCents: 0,
    ownsUnfiledCosts: true,
    commissionCents: null,
  });
  assert.equal(rollup.commissionCents, null);
  assert.equal(rollup.netCashCents, 0);
});

// ── Net accrual: the position once committed money comes out ─────────
//
// The owner's rule, stated on the live book: a job must "still get the
// red warning even if bills are not paid yet", and unpaid rep
// commission stays OUT of it -- a projection is just an estimate until
// every expense is on the project. So accrual = net cash less the
// bills filed but not yet paid, and nothing else.

test("net accrual is net cash less the bills not yet paid", () => {
  assert.equal(
    netAccrualCents({ netCashCents: 100_000, unpaidBillsCents: 60_000 }),
    40_000
  );
  // No unpaid bills: the two bases agree.
  assert.equal(netAccrualCents({ netCashCents: 77_903, unpaidBillsCents: 0 }), 77_903);
});

test("unpaid bills can turn a cash-positive job red", () => {
  assert.ok(netAccrualCents({ netCashCents: 100_000, unpaidBillsCents: 600_000 }) < 0);
});

test("triage puts a job drowning in unpaid bills first, even with cash in hand", () => {
  const healthy = {
    rollup: {
      netCashCents: 50_000,
      receivableCents: 900_000,
      soldCents: 1_000_000,
    } as ProjectRollup,
    unpaidBillsCents: 0,
  };
  const drowning = {
    rollup: {
      netCashCents: 100_000,
      receivableCents: 0,
      soldCents: 500_000,
    } as ProjectRollup,
    unpaidBillsCents: 700_000,
  };
  assert.ok(projectTriageOrder(drowning, healthy) < 0);
  // Two underwater jobs: deepest first, on the accrual figure.
  const deeper = { ...drowning, unpaidBillsCents: 900_000 };
  assert.ok(projectTriageOrder(deeper, drowning) < 0);
});

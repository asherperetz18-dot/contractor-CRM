import { test } from "node:test";
import assert from "node:assert/strict";
import { computeProjectRollup, phaseReceivableCents } from "./types.ts";

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

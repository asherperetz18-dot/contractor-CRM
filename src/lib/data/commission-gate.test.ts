import { test } from "node:test";
import assert from "node:assert/strict";
import { commissionHolds, commissionQualifiedAt, computeRepCommission } from "./types.ts";

/**
 * Commission is paid when the job is finished and settled: paid in full,
 * and the completion certificate signed. This is payroll, so the edges
 * are tested rather than assumed -- "nearly paid" releasing money early,
 * or a cleared job never releasing at all, are both somebody's wages.
 */

test("releases only when every condition is met", () => {
  assert.deepEqual(
    commissionHolds({
      hasCosts: true,
      collectedCents: 1000,
      contractCents: 1000,
      certificateSigned: true,
    }),
    []
  );
});

test("a cent short of the contract is not paid in full", () => {
  assert.deepEqual(
    commissionHolds({
      hasCosts: true,
      collectedCents: 999,
      contractCents: 1000,
      certificateSigned: true,
    }),
    ["payment"]
  );
});

test("money without a signed certificate is still held", () => {
  assert.deepEqual(
    commissionHolds({
      hasCosts: true,
      collectedCents: 1000,
      contractCents: 1000,
      certificateSigned: false,
    }),
    ["certificate"]
  );
});

test("a signed certificate without the money is still held", () => {
  assert.deepEqual(
    commissionHolds({
      hasCosts: true,
      collectedCents: 0,
      contractCents: 1000,
      certificateSigned: true,
    }),
    ["payment"]
  );
});

test("overpayment counts as paid in full", () => {
  assert.deepEqual(
    commissionHolds({
      hasCosts: true,
      collectedCents: 1200,
      contractCents: 1000,
      certificateSigned: true,
    }),
    []
  );
});

test("reports every outstanding condition, not just the first", () => {
  assert.deepEqual(
    commissionHolds({
      hasCosts: false,
      collectedCents: 0,
      contractCents: 1000,
      certificateSigned: false,
    }),
    ["costs", "payment", "certificate"]
  );
});

test("the qualifying date is whichever condition cleared last", () => {
  // Paid in June, signed off in July: this is July's payroll, not June's.
  assert.equal(
    commissionQualifiedAt({
      holds: [],
      lastPaymentAt: "2026-06-01T10:00:00Z",
      certificateSignedAt: "2026-07-09T10:00:00Z",
    }),
    "2026-07-09T10:00:00Z"
  );
  // And the other way round -- signed off long before the last payment.
  assert.equal(
    commissionQualifiedAt({
      holds: [],
      lastPaymentAt: "2026-08-04T10:00:00Z",
      certificateSignedAt: "2026-03-02T10:00:00Z",
    }),
    "2026-08-04T10:00:00Z"
  );
});

test("a held commission has no qualifying date at all", () => {
  assert.equal(
    commissionQualifiedAt({
      holds: ["payment"],
      lastPaymentAt: "2026-08-04T10:00:00Z",
      certificateSignedAt: null,
    }),
    null
  );
});

test("the rep's share comes out of net profit, after lead cost and costs", () => {
  // $80,000 job, 15% lead cost, 50% of net, one rep.
  const c = computeRepCommission({
    contractCents: 8_000_000,
    leadCostBp: 1500,
    commissionRateBp: 5000,
    expensesCents: 4_000_000,
    hasCosts: true,
    rep1Bp: 10000,
    rep2Bp: 0,
  });
  assert.equal(c.leadCostCents, 1_200_000);
  assert.equal(c.netProfitCents, 2_800_000);
  assert.equal(c.rep1Cents, 1_400_000);
  assert.equal(c.rep2Cents, 0);
});

test("a job that lost money pays no commission and claws nothing back", () => {
  const c = computeRepCommission({
    contractCents: 1_000_000,
    leadCostBp: 1500,
    commissionRateBp: 5000,
    expensesCents: 2_000_000,
    hasCosts: true,
    rep1Bp: 10000,
    rep2Bp: 0,
  });
  assert.ok(c.netProfitCents < 0);
  assert.equal(c.poolCents, 0);
  assert.equal(c.rep1Cents, 0);
});

test("two reps always split the pot exactly, with no cent lost to rounding", () => {
  const c = computeRepCommission({
    contractCents: 1_000_001,
    leadCostBp: 1500,
    commissionRateBp: 5000,
    expensesCents: 333_333,
    hasCosts: true,
    rep1Bp: 3333,
    rep2Bp: 6667,
  });
  assert.equal(c.rep1Cents + c.rep2Cents, c.poolCents);
});

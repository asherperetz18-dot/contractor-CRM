import { test } from "node:test";
import assert from "node:assert/strict";
import {
  closerPoolShareBp,
  commissionHolds,
  commissionQualifiedAt,
  computeRepCommission,
} from "./types.ts";

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

// ── The closer's seat ────────────────────────────────────────────────
//
// The closer holds their own seat on the contract (closer_pool_bp, a
// share of the pool -- migration 0153), and the reps split what is
// left. Their cut comes off the top so a second rep can join the split
// without touching what the closer was promised.

test("the closer's cut comes off the pool first, and the rep keeps the rest", () => {
  // Same $80,000 job as above: pool $14,000. A 10%-of-pool closer
  // (the default 5%-of-net against a 50% rate) takes $1,400.
  const c = computeRepCommission({
    contractCents: 8_000_000,
    leadCostBp: 1500,
    commissionRateBp: 5000,
    expensesCents: 4_000_000,
    hasCosts: true,
    rep1Bp: 10000,
    rep2Bp: 0,
    closerPoolBp: 1000,
  });
  assert.equal(c.poolCents, 1_400_000);
  assert.equal(c.closerCents, 140_000);
  assert.equal(c.rep1Cents, 1_260_000);
});

test("two reps and a closer account for the whole pot, to the cent", () => {
  const c = computeRepCommission({
    contractCents: 1_000_001,
    leadCostBp: 1500,
    commissionRateBp: 5000,
    expensesCents: 333_333,
    hasCosts: true,
    rep1Bp: 3333,
    rep2Bp: 6667,
    closerPoolBp: 1000,
  });
  assert.equal(c.closerCents + c.rep1Cents + c.rep2Cents, c.poolCents);
});

// The conversion 0135 documented: closer_bp is promised as a share of
// NET PROFIT, the pool split is stored as a share of THE POOL. Getting
// the bases mixed up pays the closer ten times too much, so the same
// arithmetic the seeding trigger runs lives here for the panel's
// pre-signature preview -- and is pinned to the trigger's worked
// example (5% of net against a 50% pool = 10% of the pool).
test("a 5%-of-net closer against a 50% pool takes 10% of the pool", () => {
  assert.equal(closerPoolShareBp(500, 5000), 1000);
});

test("no commission rate means no pool, so the closer's converted share is nil", () => {
  assert.equal(closerPoolShareBp(500, 0), 0);
});

test("a closer share at or beyond the whole pool is clamped, not negative maths", () => {
  assert.equal(closerPoolShareBp(6000, 5000), 10000);
});

test("no closer means the maths of every older contract is untouched", () => {
  const withField = computeRepCommission({
    contractCents: 8_000_000,
    leadCostBp: 1500,
    commissionRateBp: 5000,
    expensesCents: 4_000_000,
    hasCosts: true,
    rep1Bp: 10000,
    rep2Bp: 0,
  });
  assert.equal(withField.closerCents, 0);
  assert.equal(withField.rep1Cents, 1_400_000);
});

// ── What a job actually owes its sales team ──────────────────────────
//
// The pool is split by basis points whether or not a seat has a person
// in it. An empty seat's share is not a debt -- the Projects page cost
// figure must count only the shares somebody is actually owed.

import { commissionOwedCents } from "./types.ts";

test("only seated shares are owed", () => {
  // A 60/40 split configured, but no second rep ever seated: the job
  // owes the first rep's 60% and keeps the rest.
  const detail = computeRepCommission({
    contractCents: 8_000_000,
    leadCostBp: 1500,
    commissionRateBp: 5000,
    expensesCents: 4_000_000,
    hasCosts: true,
    rep1Bp: 6000,
    rep2Bp: 4000,
  });
  assert.equal(
    commissionOwedCents(detail, { rep1: true, rep2: false, closer: false }),
    detail.rep1Cents
  );
});

test("a full bench is owed the whole pool", () => {
  const detail = computeRepCommission({
    contractCents: 8_000_000,
    leadCostBp: 1500,
    commissionRateBp: 5000,
    expensesCents: 4_000_000,
    hasCosts: true,
    rep1Bp: 6000,
    rep2Bp: 4000,
    closerPoolBp: 1000,
  });
  assert.equal(
    commissionOwedCents(detail, { rep1: true, rep2: true, closer: true }),
    detail.poolCents
  );
});

test("no salesperson at all means the job owes nothing", () => {
  const detail = computeRepCommission({
    contractCents: 8_000_000,
    leadCostBp: 1500,
    commissionRateBp: 5000,
    expensesCents: 4_000_000,
    hasCosts: true,
    rep1Bp: 10000,
    rep2Bp: 0,
  });
  assert.equal(commissionOwedCents(detail, { rep1: false, rep2: false, closer: false }), 0);
});

// ── Appointment delete permission ────────────────────────────────────
//
// Office and Admin only. An appointment is the evidence a trip was made
// -- the show rate, the follow-up cron and a rep's commission all read
// it -- so removing one is an office decision. Cancelled is the tool for
// "it isn't happening", and it keeps the history.
//
// The UI gate has to agree with the database policy, or it offers a
// button the database will refuse -- which is how a dispatcher came to
// press Delete and be told an appointment was gone while it was still
// there.

import { canDeleteAppointments, canEditSchedule } from "./types.ts";

const who = (roles: string[]) => ({ roles: roles as never });

test("dispatch may work the calendar but not delete from it", () => {
  assert.equal(canEditSchedule(who(["Dispatch"])), true);
  assert.equal(canDeleteAppointments(who(["Dispatch"])), false);
});

test("office and admin may delete an appointment", () => {
  assert.equal(canDeleteAppointments(who(["Office"])), true);
  assert.equal(canDeleteAppointments(who(["Admin"])), true);
});

test("field works the calendar but does not delete from it", () => {
  assert.equal(canEditSchedule(who(["Field"])), true);
  assert.equal(canDeleteAppointments(who(["Field"])), false);
});

test("sales may not delete an appointment", () => {
  assert.equal(canDeleteAppointments(who(["Sales"])), false);
});

test("a second role still grants it", () => {
  assert.equal(canDeleteAppointments(who(["Dispatch", "Office"])), true);
});

test("nobody signed in deletes nothing", () => {
  assert.equal(canDeleteAppointments(null), false);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { phaseOwedCents, phaseReceivableCents, phaseState } from "./types.ts";

/**
 * phaseState used to call a phase "paid" the moment ANY settled payment
 * was filed to it, whatever the amount. A $16,100 phase with $11,500
 * recorded read as fully paid on the Payments page, dropped off
 * "Billed, Unpaid", and the remaining $4,600 was visible on Projects
 * ("Owed to you" counts per-phase remainders, DECISIONS #001) but
 * nowhere on Payments. These tests pin the amount-aware states and the
 * per-phase remainder that keep the two pages saying the same number.
 */

const phase = (over: Partial<{ amount_cents: number; requested_at: string | null; due_date: string | null }> = {}) => ({
  amount_cents: 1_000_000,
  requested_at: "2026-09-01T10:00:00Z",
  due_date: "2026-09-10",
  ...over,
});
const pay = (amount: number, status: "succeeded" | "pending" | "failed" = "succeeded") => ({
  amount_cents: amount,
  status,
});

const beforeDue = new Date("2026-09-05T12:00:00");
const afterDue = new Date("2026-09-20T12:00:00");

test("settled money covering the amount is paid, whatever the date", () => {
  assert.equal(phaseState(phase(), [pay(1_000_000)], afterDue), "paid");
  assert.equal(phaseState(phase(), [pay(600_000), pay(400_000)], afterDue), "paid");
  assert.equal(phaseState(phase(), [pay(1_200_000)], beforeDue), "paid");
});

test("a partial payment is partially paid, not paid", () => {
  assert.equal(phaseState(phase(), [pay(400_000)], beforeDue), "partial");
});

test("the remainder of a partially paid phase still goes overdue", () => {
  assert.equal(phaseState(phase(), [pay(400_000)], afterDue), "overdue");
});

test("a phase whose remainder is covered by money in flight is clearing", () => {
  // The customer has done their part -- even past the due date.
  assert.equal(phaseState(phase(), [pay(400_000), pay(600_000, "pending")], afterDue), "clearing");
  assert.equal(phaseState(phase(), [pay(1_000_000, "pending")], beforeDue), "clearing");
});

test("a token pending payment does not hide the unpaid remainder", () => {
  // $100 in flight against a $10,000 bill: still billed, still able to
  // turn overdue. Before amounts were checked, ANY pending payment read
  // as clearing.
  assert.equal(phaseState(phase(), [pay(10_000, "pending")], beforeDue), "billed");
  assert.equal(phaseState(phase(), [pay(10_000, "pending")], afterDue), "overdue");
});

test("failed payments count for nothing", () => {
  assert.equal(phaseState(phase(), [pay(1_000_000, "failed")], beforeDue), "billed");
});

test("unbilled, billed and overdue by date are unchanged", () => {
  assert.equal(phaseState(phase({ requested_at: null }), [], afterDue), "unbilled");
  assert.equal(phaseState(phase(), [], beforeDue), "billed");
  assert.equal(phaseState(phase(), [], afterDue), "overdue");
  // Date-only comparison: due today is not late today.
  assert.equal(phaseState(phase(), [], new Date("2026-09-10T18:00:00")), "billed");
});

test("a zero-amount phase keeps its old behavior", () => {
  // No payments: it sits billed, it does not read as instantly paid.
  assert.equal(phaseState(phase({ amount_cents: 0 }), [], beforeDue), "billed");
  // Any settled payment covers zero.
  assert.equal(phaseState(phase({ amount_cents: 0 }), [pay(0)], beforeDue), "paid");
});

// ── phaseOwedCents: the remainder the cards sum ──────────────────────

test("an unbilled phase owes nothing yet", () => {
  assert.equal(phaseOwedCents(phase({ requested_at: null }), [pay(400_000)]), 0);
});

test("a billed phase with no payments owes its full amount", () => {
  assert.equal(phaseOwedCents(phase(), []), 1_000_000);
});

test("a partial payment leaves the remainder owed", () => {
  assert.equal(phaseOwedCents(phase(), [pay(400_000)]), 600_000);
});

test("a covered or overpaid phase owes nothing", () => {
  assert.equal(phaseOwedCents(phase(), [pay(1_000_000)]), 0);
  assert.equal(phaseOwedCents(phase(), [pay(1_500_000)]), 0);
});

test("pending money has not arrived and reduces nothing", () => {
  assert.equal(phaseOwedCents(phase(), [pay(1_000_000, "pending")]), 1_000_000);
});

test("the Payments cards and Projects' Owed to you add up from the same arithmetic", () => {
  // EST-1098's real shape: two untouched billed phases, one partially
  // paid, plus unbilled and settled ones. Summing phaseOwedCents row by
  // row (what the Payments page shows) must equal phaseReceivableCents
  // (what Projects' "Owed to you" and Money to Collect count) -- this
  // is the test that keeps the two pages agreeing.
  const phases = [
    { id: "deck", amount_cents: 650_000, requested_at: "2026-09-01T10:00:00Z" },
    { id: "final", amount_cents: 500_000, requested_at: "2026-09-01T10:00:00Z" },
    { id: "tile", amount_cents: 1_610_000, requested_at: "2026-09-01T10:00:00Z" },
    { id: "later", amount_cents: 500_000, requested_at: null },
    { id: "demo", amount_cents: 450_000, requested_at: "2026-08-01T10:00:00Z" },
  ];
  const payments = [
    { estimate_payment_id: "tile", status: "succeeded" as const, amount_cents: 1_150_000 },
    { estimate_payment_id: "demo", status: "succeeded" as const, amount_cents: 450_000 },
    { estimate_payment_id: null, status: "succeeded" as const, amount_cents: 100_000 },
  ];
  const rowByRow = phases.reduce(
    (sum, ph) =>
      sum + phaseOwedCents(ph, payments.filter((p) => p.estimate_payment_id === ph.id)),
    0
  );
  assert.equal(rowByRow, phaseReceivableCents(phases, payments));
  assert.equal(rowByRow, 650_000 + 500_000 + 460_000);
});

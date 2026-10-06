import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MIN_ONLINE_CHARGE_CENTS,
  isUnfinishedCheckout,
  phaseCheckoutCents,
  phaseOwedCents,
  phaseReceivableCents,
  phaseState,
  portalPayCents,
} from "./types.ts";

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

test("a checkout opened but never finished is not money on its way", () => {
  assert.equal(
    isUnfinishedCheckout({ status: "pending", stripe_session_id: "cs_1", stripe_payment_intent_id: null }),
    true
  );
});

test("an ACH checkout that completed is clearing money, not an abandoned checkout", () => {
  assert.equal(
    isUnfinishedCheckout({ status: "pending", stripe_session_id: "cs_1", stripe_payment_intent_id: "pi_1" }),
    false
  );
});

test("a hand-recorded pending payment (a cheque) is not a checkout at all", () => {
  assert.equal(isUnfinishedCheckout({ status: "pending", stripe_session_id: null }), false);
});

test("settled or cancelled rows are never unfinished checkouts", () => {
  assert.equal(isUnfinishedCheckout({ status: "succeeded", stripe_session_id: "cs_1" }), false);
  assert.equal(isUnfinishedCheckout({ status: "cancelled", stripe_session_id: "cs_1" }), false);
});

// ---- paying the rest online ----------------------------------------------
//
// The portal's Pay button used to charge a phase's full amount, so once
// any money was filed to it (a cheque for part, say) the button was
// hidden and the rest was chased by hand. It now charges what is left.

const row = (
  amount: number,
  status: "succeeded" | "pending" | "failed" | "cancelled",
  over: { stripe_session_id?: string | null; stripe_payment_intent_id?: string | null } = {}
) => ({ amount_cents: amount, status, stripe_session_id: null, stripe_payment_intent_id: null, ...over });

test("a billed phase with nothing paid is charged in full", () => {
  assert.equal(phaseCheckoutCents(phase(), []), 1_000_000);
});

test("a partly paid phase is charged only the rest", () => {
  // $4,000 cheque on a $10,000 phase: the button charges $6,000.
  assert.equal(phaseCheckoutCents(phase(), [row(400_000, "succeeded")]), 600_000);
});

test("money already on its way is not charged again", () => {
  // An ACH checkout that completed and a cheque recorded as pending are
  // both real money in flight: charging the full rest would collect twice.
  const ach = row(300_000, "pending", { stripe_session_id: "cs_1", stripe_payment_intent_id: "pi_1" });
  const cheque = row(200_000, "pending");
  assert.equal(phaseCheckoutCents(phase(), [row(100_000, "succeeded"), ach, cheque]), 400_000);
});

test("a checkout opened and abandoned is not money and reduces nothing", () => {
  const abandoned = row(1_000_000, "pending", { stripe_session_id: "cs_1" });
  assert.equal(phaseCheckoutCents(phase(), [abandoned]), 1_000_000);
});

test("failed and cancelled payments reduce nothing", () => {
  assert.equal(phaseCheckoutCents(phase(), [row(400_000, "failed"), row(400_000, "cancelled")]), 1_000_000);
});

test("nothing is charged on an unbilled or a covered phase", () => {
  assert.equal(phaseCheckoutCents(phase({ requested_at: null }), []), 0);
  assert.equal(phaseCheckoutCents(phase(), [row(1_000_000, "succeeded")]), 0);
  assert.equal(phaseCheckoutCents(phase(), [row(1_200_000, "succeeded")]), 0);
});

test("the customer's Pay button: the rest, or none", () => {
  assert.equal(portalPayCents("partial", 225_000, false), 225_000);
  assert.equal(portalPayCents("overdue", 225_000, false), 225_000);
  assert.equal(portalPayCents("billed", 1_000_000, false), 1_000_000);
  // Settled, clearing, or billed outside the CRM: no button.
  assert.equal(portalPayCents("paid", 0, false), null);
  assert.equal(portalPayCents("clearing", 0, false), null);
  assert.equal(portalPayCents("partial", 225_000, true), null);
  // Stripe won't take a charge under 50 cents; the contractor settles it.
  assert.equal(MIN_ONLINE_CHARGE_CENTS, 50);
  assert.equal(portalPayCents("partial", 49, false), null);
  assert.equal(portalPayCents("partial", 50, false), 50);
});

test("the checkout charges, records and reuses the same remaining amount", () => {
  // Stripe's session amount and the pending row the webhook settles must
  // agree, or a part-paid phase is overcharged or recorded short.
  const source = readFileSync(new URL("../actions/portal-payments.ts", import.meta.url), "utf8");
  const checkout = source.slice(source.indexOf("export async function startPhaseCheckout"), source.indexOf("export async function startDepositCheckout"));
  assert.match(checkout, /phaseCheckoutCents\(/);
  assert.doesNotMatch(checkout, /unit_amount: phase\.amount_cents/);
  assert.doesNotMatch(checkout, /amount_cents: phase\.amount_cents/);
  assert.doesNotMatch(checkout, /leftoverCheckoutAction\(prior, phase\.amount_cents\)/);
});

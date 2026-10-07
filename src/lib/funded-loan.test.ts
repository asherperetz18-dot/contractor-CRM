import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { splitFundedLoan } from "./financing.ts";
import { MANUAL_PAYMENT_METHODS, paymentMethodLabel } from "./data/types.ts";
import { receiptMethodLabel } from "./receipt-email.ts";

/**
 * A funded loan, recorded as the money it is (DECISIONS #163): when the
 * lender pays out, the office marks Funded and the payout is filed as
 * Financing payments on the contract -- the deposit first, then each
 * stage in schedule order, each up to what's still to pay on it.
 */

const stage = (id: string, sort: number, cents: number, over: Record<string, unknown> = {}) => ({
  id,
  name: `Stage ${id}`,
  sort_order: sort,
  amount_cents: cents,
  credit_cents: 0,
  cancelled_at: null as string | null,
  ...over,
});
const paid = (cents: number, stageId: string | null, status = "succeeded") => ({
  estimate_payment_id: stageId,
  kind: stageId ? "progress" : "deposit",
  status,
  amount_cents: cents,
  stripe_session_id: null,
  stripe_payment_intent_id: null,
});

test("the payout pays the deposit first, then each stage in order, billed yet or not", () => {
  const split = splitFundedLoan({
    amountCents: 2_400_000,
    depositDueCents: 100_000,
    stages: [stage("b", 1, 1_000_000), stage("a", 0, 1_400_000)],
    payments: [],
  });
  assert.deepEqual(
    split.parts.map((p) => [p.phaseId, p.cents]),
    [
      [null, 100_000],
      ["a", 1_400_000],
      ["b", 900_000],
    ]
  );
  assert.equal(split.openCents, 2_500_000);
  assert.equal(split.leftCents, 100_000);
  assert.equal(split.overCents, 0);
});

test("what's paid, credited, on its way or cancelled isn't paid again", () => {
  const split = splitFundedLoan({
    amountCents: 1_000_000,
    depositDueCents: 100_000,
    stages: [
      stage("a", 0, 1_000_000, { credit_cents: 50_000 }),
      stage("b", 1, 800_000),
      stage("x", 2, 500_000, { cancelled_at: "2026-09-01T00:00:00Z" }),
    ],
    payments: [
      paid(100_000, null),
      paid(400_000, "a"),
      // A bank transfer on its way counts as paid here.
      paid(300_000, "b", "pending"),
      // A checkout opened and left is nothing.
      { ...paid(800_000, "b", "pending"), stripe_session_id: "cs_1" },
    ],
  });
  assert.deepEqual(
    split.parts.map((p) => [p.phaseId, p.cents]),
    [
      ["a", 550_000],
      ["b", 450_000],
    ]
  );
  assert.equal(split.openCents, 1_050_000);
  assert.equal(split.leftCents, 50_000);
});

test("more than is still owed on the contract is refused, with how much is owed", () => {
  const split = splitFundedLoan({ amountCents: 600_000, depositDueCents: 0, stages: [stage("a", 0, 500_000)], payments: [] });
  assert.equal(split.overCents, 100_000);
  assert.equal(split.openCents, 500_000);
  const none = splitFundedLoan({ amountCents: 1, depositDueCents: 0, stages: [], payments: [] });
  assert.equal(none.openCents, 0);
  assert.equal(none.overCents, 1);
});

test("Financing is a way to record a payment by hand, and reads as one everywhere", () => {
  assert.ok((MANUAL_PAYMENT_METHODS as readonly string[]).includes("financing"));
  assert.equal(paymentMethodLabel("financing"), "financing");
  assert.equal(receiptMethodLabel("financing"), "Financing");
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("recording the payout: the people who record payments, on a signed contract, as Financing payments", () => {
  const actions = source("./actions/financing.ts");
  const fn = actions.slice(actions.indexOf("export async function recordFinancingStatus("));
  assert.match(fn, /if \(input\.payment\)/);
  assert.match(fn, /canManageBills\(profile\)/);
  assert.match(fn, /status !== "Signed"/);
  assert.match(fn, /splitFundedLoan\(/);
  assert.match(fn, /method: "financing"/);
  assert.match(fn, /source: "manual"/);
  assert.match(fn, /recorded_by: profile\.id/);
  // The payments go in before the step: a failed payout records no Funded.
  assert.ok(fn.indexOf('.from("portal_payments")') < fn.indexOf("await saveStep("));
  const panel = source("../app/(app)/estimates/[id]/financing-panel.tsx");
  assert.match(panel, /Also record it as a payment/);
  // The page's preview counts payments the way the server does: it has
  // the Stripe ids, so an abandoned checkout isn't taken as paid.
  const page = source("../app/(app)/estimates/[id]/page.tsx");
  assert.match(page, /stripe_session_id: p\.stripe_session_id \?\? null,\s*stripe_payment_intent_id: p\.stripe_payment_intent_id \?\? null,/);
  assert.match(page, /\.from\("portal_payments"\)\s*\.select\("[^"]*stripe_session_id, stripe_payment_intent_id"\)/);
});

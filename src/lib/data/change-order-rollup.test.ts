import { test } from "node:test";
import assert from "node:assert/strict";
import { changeOrderRollupForPhase } from "./change-order-rollup.ts";

/**
 * A signed change order appears twice: as its own document with its own
 * payment schedule, and as one mirror phase on the parent contract's
 * schedule. Money recorded on the change order's phases lands against the
 * change order's rows, so the parent's mirror phase used to say "Not
 * billed" while thousands had already been collected. The rollup reads
 * the change order's own billing back onto the mirror phase.
 */

const phase = (over: Partial<{ id: string; name: string; amount_cents: number }> = {}) => ({
  id: "phase-1",
  name: "EST-1097-CO1",
  amount_cents: 3000000,
  ...over,
});

const co = (over: Partial<{ doc_number: string; paid_cents: number; pending_cents: number }> = {}) => ({
  doc_number: "EST-1097-CO1",
  paid_cents: 0,
  pending_cents: 0,
  ...over,
});

test("money collected on the change order shows as partial on the mirror phase", () => {
  // The reported bug: $15,000 of a $30,000 change order paid on the change
  // order's own schedule, and the parent row still said "Not billed".
  const rollup = changeOrderRollupForPhase(phase(), [], [co({ paid_cents: 1500000 })]);
  assert.deepEqual(rollup, {
    docNumber: "EST-1097-CO1",
    paidCents: 1500000,
    pendingCents: 0,
    amountCents: 3000000,
    state: "partial",
  });
});

test("a change order paid in full marks the mirror phase paid", () => {
  const rollup = changeOrderRollupForPhase(phase(), [], [co({ paid_cents: 3000000 })]);
  assert.equal(rollup?.state, "paid");
  // Paid stays paid even while extra money is still clearing.
  const over = changeOrderRollupForPhase(
    phase(),
    [],
    [co({ paid_cents: 3200000, pending_cents: 100 })]
  );
  assert.equal(over?.state, "paid");
});

test("only clearing money reads as clearing, not paid and not partial", () => {
  const rollup = changeOrderRollupForPhase(phase(), [], [co({ pending_cents: 1500000 })]);
  assert.equal(rollup?.state, "clearing");
});

test("nothing collected on the change order leaves the phase alone", () => {
  // The mirror row must stay billable from the parent when the change
  // order's own schedule was never used -- that is how single-payment
  // change orders get collected today.
  assert.equal(changeOrderRollupForPhase(phase(), [], [co()]), null);
});

test("a payment recorded directly on the mirror phase wins over the rollup", () => {
  // Both flows exist. When someone billed and settled the row on the
  // parent, that record is the truth and the badge already says so.
  const direct = [{ estimate_payment_id: "phase-1", status: "succeeded" as const }];
  assert.equal(
    changeOrderRollupForPhase(phase(), direct, [co({ paid_cents: 1500000 })]),
    null
  );
  const clearing = [{ estimate_payment_id: "phase-1", status: "pending" as const }];
  assert.equal(
    changeOrderRollupForPhase(phase(), clearing, [co({ paid_cents: 1500000 })]),
    null
  );
});

test("direct payments on other phases do not block the rollup", () => {
  const otherPhase = [{ estimate_payment_id: "phase-9", status: "succeeded" as const }];
  const rollup = changeOrderRollupForPhase(phase(), otherPhase, [co({ paid_cents: 1500000 })]);
  assert.equal(rollup?.state, "partial");
});

test("a phase that matches no change order is a plain phase", () => {
  assert.equal(
    changeOrderRollupForPhase(phase({ name: "Upon Demolition" }), [], [co({ paid_cents: 1 })]),
    null
  );
});

test("the match survives stray whitespace but is otherwise exact", () => {
  const rollup = changeOrderRollupForPhase(
    phase({ name: " EST-1097-CO1 " }),
    [],
    [co({ paid_cents: 1500000 })]
  );
  assert.equal(rollup?.state, "partial");
  // CO1 must not swallow CO11's money.
  assert.equal(
    changeOrderRollupForPhase(phase({ name: "EST-1097-CO11" }), [], [co({ paid_cents: 1 })]),
    null
  );
});

test("a credit change order never rolls up -- there is nothing to collect", () => {
  assert.equal(
    changeOrderRollupForPhase(phase({ amount_cents: -500000 }), [], [co({ paid_cents: 1 })]),
    null
  );
  assert.equal(
    changeOrderRollupForPhase(phase({ amount_cents: 0 }), [], [co({ paid_cents: 1 })]),
    null
  );
});

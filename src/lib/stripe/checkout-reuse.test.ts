import { test } from "node:test";
import assert from "node:assert/strict";
import { leftoverCheckoutAction } from "./checkout-reuse.ts";

/**
 * A customer who opened Stripe's page and backed out clicks Pay again.
 * Whatever is done with the checkout they left behind must never let the
 * same phase be charged twice.
 */

test("a still-open checkout for the same amount is reused, not duplicated", () => {
  assert.equal(leftoverCheckoutAction({ status: "open", amount_total: 657_000 }, 657_000), "reuse");
});

test("an open checkout for an old amount is closed and replaced", () => {
  assert.equal(leftoverCheckoutAction({ status: "open", amount_total: 600_000 }, 657_000), "expire");
});

test("a checkout that completed is money on its way -- no second Pay", () => {
  assert.equal(leftoverCheckoutAction({ status: "complete", amount_total: 657_000 }, 657_000), "in-flight");
});

test("an expired checkout is just cleared away", () => {
  assert.equal(leftoverCheckoutAction({ status: "expired", amount_total: 657_000 }, 657_000), "cancel");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPlanPrice } from "./plan-price.ts";

/**
 * The front page's pricing card reads the plan straight off the Stripe
 * price checkout charges, so the number on the page can never drift from
 * the number on the card statement.
 */

test("a monthly plan in whole dollars", () => {
  assert.deepEqual(
    formatPlanPrice({ unit_amount: 14900, currency: "usd", recurring: { interval: "month", interval_count: 1 } }),
    { amount: "$149", per: "per month" }
  );
});

test("cents are kept when the plan has them", () => {
  assert.deepEqual(
    formatPlanPrice({ unit_amount: 9950, currency: "usd", recurring: { interval: "month", interval_count: 1 } }),
    { amount: "$99.50", per: "per month" }
  );
});

test("a yearly plan and a multi-month plan say so", () => {
  assert.equal(
    formatPlanPrice({ unit_amount: 150000, currency: "usd", recurring: { interval: "year", interval_count: 1 } })?.per,
    "per year"
  );
  assert.equal(
    formatPlanPrice({ unit_amount: 40000, currency: "usd", recurring: { interval: "month", interval_count: 3 } })?.per,
    "every 3 months"
  );
});

test("a one-time price reads as one payment", () => {
  assert.deepEqual(formatPlanPrice({ unit_amount: 50000, currency: "usd", recurring: null }), {
    amount: "$500",
    per: "one-time",
  });
});

test("a price with no fixed amount shows nothing rather than $0", () => {
  assert.equal(formatPlanPrice({ unit_amount: null, currency: "usd", recurring: null }), null);
});

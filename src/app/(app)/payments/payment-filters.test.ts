import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesPaymentSearch } from "./payment-filters.ts";

/**
 * One box searches the whole Payments page, and the same rules apply to
 * every table on it: contract number, customer name, phase and amount.
 * Amounts are the tricky part -- the user types "$4,500.00" or "4500"
 * while the row stores 450000 cents -- so the edges tested here are the
 * ways a human actually writes money.
 */

const row = {
  texts: ["EST-1097-CO3", "Patty Postil"],
  amountsCents: [1920000],
};

test("empty or blank search matches every row", () => {
  assert.equal(matchesPaymentSearch("", row), true);
  assert.equal(matchesPaymentSearch("   ", row), true);
});

test("contract number matches whole, partial and case-insensitive", () => {
  assert.equal(matchesPaymentSearch("EST-1097-CO3", row), true);
  assert.equal(matchesPaymentSearch("est-1097", row), true);
  assert.equal(matchesPaymentSearch("1097", row), true);
  assert.equal(matchesPaymentSearch("EST-1068", row), false);
});

test("customer name matches case-insensitive, on any word", () => {
  assert.equal(matchesPaymentSearch("patty", row), true);
  assert.equal(matchesPaymentSearch("POSTIL", row), true);
  assert.equal(matchesPaymentSearch("george", row), false);
});

test("amounts match however the user writes money", () => {
  // The row holds $19,200.00 as 1920000 cents.
  assert.equal(matchesPaymentSearch("19200", row), true);
  assert.equal(matchesPaymentSearch("19,200", row), true);
  assert.equal(matchesPaymentSearch("$19,200.00", row), true);
  assert.equal(matchesPaymentSearch("19201", row), false);
});

test("null text fields are skipped, not crashed on", () => {
  const sparse = { texts: [null, "Sue Song", undefined], amountsCents: [1200000] };
  assert.equal(matchesPaymentSearch("sue", sparse), true);
  assert.equal(matchesPaymentSearch("12,000", sparse), true);
});

test("a single digit never amount-matches — almost every amount has a 1 somewhere", () => {
  assert.equal(matchesPaymentSearch("1", { texts: ["Nuha Ibrahim"], amountsCents: [120000] }), false);
  // ...but one letter can still text-match; short isn't banned, only short digit runs.
  assert.equal(matchesPaymentSearch("n", { texts: ["Nuha Ibrahim"], amountsCents: [120000] }), true);
});

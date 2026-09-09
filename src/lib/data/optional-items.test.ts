import { test } from "node:test";
import assert from "node:assert/strict";
import { computeEstimateTotals, itemInTotals } from "./types.ts";

/**
 * Optional lines are money the customer decides on, so the rule is
 * tested at the one place every total comes from: an optional line is
 * out of the subtotal, the tax and the deposit-bearing total until the
 * customer ticks it, and in the moment they do. Lines that never heard
 * of the columns (rows from before migration 0142) must read as
 * ordinary lines.
 */

type Line = {
  quantity: number;
  unit_price_cents: number;
  taxable: boolean;
  is_optional?: boolean;
  optional_selected?: boolean;
};

const line = (unit_price_cents: number, taxable: boolean, extra?: Partial<Line>): Line => ({
  quantity: 1,
  unit_price_cents,
  taxable,
  ...extra,
});

test("rows without the optional columns are ordinary lines", () => {
  assert.equal(itemInTotals({}), true);
  const t = computeEstimateTotals([line(100000, true), line(50000, false)], 725);
  assert.equal(t.subtotalCents, 150000);
  assert.equal(t.taxCents, Math.round(100000 * 0.0725));
});

test("an optional line the customer has not ticked is not in the money", () => {
  const t = computeEstimateTotals(
    [line(100000, false), line(37500, true, { is_optional: true })],
    725
  );
  assert.equal(t.subtotalCents, 100000);
  // Its tax stays out too -- taxing an offer nobody accepted.
  assert.equal(t.taxCents, 0);
  assert.equal(t.totalCents, 100000);
});

test("ticking the option brings the whole line in, tax included", () => {
  const t = computeEstimateTotals(
    [line(100000, false), line(37500, true, { is_optional: true, optional_selected: true })],
    725
  );
  assert.equal(t.subtotalCents, 137500);
  assert.equal(t.taxCents, Math.round(37500 * 0.0725));
  assert.equal(t.totalCents, 137500 + t.taxCents);
});

test("a selected flag on an ordinary line changes nothing", () => {
  // optional_selected without is_optional is a leftover, not a state.
  const plain = computeEstimateTotals([line(80000, true)], 950);
  const leftover = computeEstimateTotals(
    [line(80000, true, { optional_selected: true })],
    950
  );
  assert.deepEqual(leftover, plain);
});

test("a discount is taken on what the customer is actually buying", () => {
  // 10% off $1,000 of chosen work; the unticked $500 option earns no
  // discount and suffers none.
  const t = computeEstimateTotals(
    [line(100000, false), line(50000, false, { is_optional: true })],
    0,
    { type: "percent", value: 1000 }
  );
  assert.equal(t.discountCents, 10000);
  assert.equal(t.totalCents, 90000);
});

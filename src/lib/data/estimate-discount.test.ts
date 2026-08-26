import { test } from "node:test";
import assert from "node:assert/strict";
import { computeEstimateTotals, discountPercentLabel } from "./types.ts";

/**
 * The discount is money on a document a customer signs, so the edges are
 * tested rather than assumed: the proportional tax reduction (California
 * taxes materials, not labor), the clamps, and the no-discount path
 * staying byte-for-byte what it always was.
 */

const items = (
  ...rows: [priceCents: number, taxable: boolean][]
): { quantity: number; unit_price_cents: number; taxable: boolean }[] =>
  rows.map(([unit_price_cents, taxable]) => ({ quantity: 1, unit_price_cents, taxable }));

test("no discount leaves the classic math untouched", () => {
  const t = computeEstimateTotals(items([100000, true], [50000, false]), 725);
  assert.equal(t.subtotalCents, 150000);
  assert.equal(t.discountCents, 0);
  assert.equal(t.taxCents, Math.round(100000 * 0.0725));
  assert.equal(t.totalCents, 150000 + 7250);
});

test("percent discount shaves the taxable base proportionally", () => {
  // $1,000 materials (taxable) + $1,000 labor, 10% off, 7.25% tax.
  const t = computeEstimateTotals(items([100000, true], [100000, false]), 725, {
    type: "percent",
    value: 1000,
  });
  assert.equal(t.discountCents, 20000);
  // Taxable base drops 10% too: tax on $900, not $1,000.
  assert.equal(t.taxCents, Math.round(90000 * 0.0725));
  assert.equal(t.totalCents, 200000 - 20000 + t.taxCents);
});

test("amount discount cannot exceed the subtotal", () => {
  const t = computeEstimateTotals(items([50000, true]), 725, {
    type: "amount",
    value: 999999,
  });
  assert.equal(t.discountCents, 50000);
  assert.equal(t.taxCents, 0);
  assert.equal(t.totalCents, 0);
});

test("negative and zero discounts are inert", () => {
  const base = computeEstimateTotals(items([80000, true]), 950);
  const neg = computeEstimateTotals(items([80000, true]), 950, { type: "amount", value: -500 });
  const zero = computeEstimateTotals(items([80000, true]), 950, { type: "percent", value: 0 });
  assert.deepEqual(neg, { ...base, discountCents: 0 });
  assert.deepEqual(zero, { ...base, discountCents: 0 });
});

test("all-labor job discounts without inventing tax", () => {
  const t = computeEstimateTotals(items([120000, false]), 725, {
    type: "amount",
    value: 20000,
  });
  assert.equal(t.taxCents, 0);
  assert.equal(t.totalCents, 100000);
});

test("percent label drops noise but keeps precision", () => {
  assert.equal(discountPercentLabel(500), "5%");
  assert.equal(discountPercentLabel(725), "7.25%");
  assert.equal(discountPercentLabel(1050), "10.5%");
});

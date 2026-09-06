import { test } from "node:test";
import assert from "node:assert/strict";
import { taxRateBpToInput, taxRateInputToBp, taxRateLabel } from "./tax-rate.ts";

/**
 * The Company Profile page types a percent; the database stores basis
 * points. A mistake here is a wrong tax line on every estimate from then
 * on, so the conversion is pinned down both ways.
 */

test("percent typed on the form becomes basis points", () => {
  assert.equal(taxRateInputToBp("9.5"), 950);
  assert.equal(taxRateInputToBp("9.50"), 950);
  assert.equal(taxRateInputToBp("7.25"), 725);
  assert.equal(taxRateInputToBp("10"), 1000);
  assert.equal(taxRateInputToBp("0"), 0);
  // Friendly to what people actually type.
  assert.equal(taxRateInputToBp(" 9.5 % "), 950);
  assert.equal(taxRateInputToBp("9.5%"), 950);
});

test("blank means no sales tax", () => {
  assert.equal(taxRateInputToBp(""), 0);
  assert.equal(taxRateInputToBp("   "), 0);
});

test("anything that is not a rate between 0 and 100 is rejected", () => {
  assert.equal(taxRateInputToBp("abc"), null);
  assert.equal(taxRateInputToBp("-5"), null);
  assert.equal(taxRateInputToBp("150"), null);
  assert.equal(taxRateInputToBp("9,5"), null);
  assert.equal(taxRateInputToBp("100.01"), null);
  // The ceiling itself is allowed.
  assert.equal(taxRateInputToBp("100"), 10000);
});

test("stored basis points show as a tidy percent", () => {
  assert.equal(taxRateBpToInput(950), "9.5");
  assert.equal(taxRateBpToInput(725), "7.25");
  assert.equal(taxRateBpToInput(1000), "10");
  assert.equal(taxRateBpToInput(0), "");
  assert.equal(taxRateBpToInput(null), "");
  assert.equal(taxRateBpToInput(undefined), "");
});

test("the conversion round-trips", () => {
  for (const typed of ["9.5", "7.25", "8", "10.25", "0.5"]) {
    const bp = taxRateInputToBp(typed);
    assert.notEqual(bp, null);
    assert.equal(taxRateBpToInput(bp as number), typed);
  }
});

test("label always shows two decimals", () => {
  assert.equal(taxRateLabel(950), "9.50%");
  assert.equal(taxRateLabel(1000), "10.00%");
  assert.equal(taxRateLabel(0), "0.00%");
});

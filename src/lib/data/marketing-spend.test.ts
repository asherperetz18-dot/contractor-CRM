import { test } from "node:test";
import assert from "node:assert/strict";
import { spendInWindow, sourceCost, monthKey } from "./marketing-spend.ts";

/**
 * Marketing spend is entered per source per month (marketing_spend,
 * 0165). A report window rarely lines up with calendar months, so the
 * window claims each month's amount in proportion to the days it
 * covers -- and never a day that hasn't happened yet.
 */

const ROWS = [
  { source: "Google Ads", month: "2026-08-01", amount_cents: 310_000 }, // $100/day
  { source: "Google Ads", month: "2026-09-01", amount_cents: 300_000 }, // $100/day
  { source: "Roy", month: "2026-09-01", amount_cents: 60_000 },
  { source: "Roy", month: "2026-12-01", amount_cents: 999_999 }, // future
];

test("a window claims each month by the days it covers, up to today", () => {
  // Aug 21 – Sep 20: 11 days of August + 20 days of September.
  const s = spendInWindow(ROWS, { from: "2026-08-21", to: null }, "2026-09-20");
  assert.equal(s["Google Ads"], 11 * 10_000 + 20 * 10_000);
  // September only so far: 20 of 30 days of $600.
  assert.equal(s["Roy"], Math.round((60_000 * 20) / 30));
});

test("a custom range with both edges is exact, and can end before today", () => {
  const s = spendInWindow(ROWS, { from: "2026-08-01", to: "2026-08-31" }, "2026-09-20");
  assert.equal(s["Google Ads"], 310_000);
  assert.equal(s["Roy"], undefined);
});

test("all time claims every entry, future months included", () => {
  const s = spendInWindow(ROWS, { from: null, to: null }, "2026-09-20");
  assert.equal(s["Google Ads"], 610_000);
  assert.equal(s["Roy"], 60_000 + 999_999);
});

test("monthKey: the first of a day's month", () => {
  assert.equal(monthKey("2026-09-20"), "2026-09-01");
  assert.equal(monthKey("2026-09-20T15:00:00Z"), "2026-09-01");
});

test("cost basis: real spend first, then hand-priced leads, then the default, then nothing", () => {
  // Spend wins and divides over every lead in the source, priced or not.
  assert.deepEqual(
    sourceCost({ spendCents: 100_000, leads: 50, signed: 2, leadCostDollars: 0, costKnown: 0, atDefault: 0 }),
    { costPerLeadCents: 2_000, costPerSaleCents: 50_000, basis: "spend" }
  );
  // No spend: lead_cost averaged over the priced leads only, in cents.
  assert.deepEqual(
    sourceCost({ spendCents: 0, leads: 10, signed: 0, leadCostDollars: 394, costKnown: 2, atDefault: 1 }),
    { costPerLeadCents: 19_700, costPerSaleCents: null, basis: "lead_cost" }
  );
  // Every priced lead carries the company default: a placeholder, said so.
  assert.deepEqual(
    sourceCost({ spendCents: 0, leads: 10, signed: 1, leadCostDollars: 3750, costKnown: 10, atDefault: 10 }),
    { costPerLeadCents: 37_500, costPerSaleCents: 375_000, basis: "default" }
  );
  assert.deepEqual(
    sourceCost({ spendCents: 0, leads: 3, signed: 0, leadCostDollars: 0, costKnown: 0, atDefault: 0 }),
    { costPerLeadCents: null, costPerSaleCents: null, basis: "none" }
  );
});

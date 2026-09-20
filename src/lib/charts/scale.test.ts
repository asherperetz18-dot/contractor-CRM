import { test } from "node:test";
import assert from "node:assert/strict";
import { moneyTickLabel, niceTicks } from "./scale.ts";

/**
 * Axis math for the dashboard's charts. Ticks land on clean numbers
 * (0 / 100K / 200K ...) because the axis carries every value that is
 * not directly labeled -- a scale to 338,000 with ticks at thirds is
 * unreadable.
 */

test("ticks round the axis up to a clean step", () => {
  assert.deepEqual(niceTicks(33800000), {
    max: 40000000,
    ticks: [0, 10000000, 20000000, 30000000, 40000000],
  });
  assert.deepEqual(niceTicks(180), { max: 200, ticks: [0, 50, 100, 150, 200] });
});

test("an empty series still draws a scale", () => {
  assert.deepEqual(niceTicks(0), { max: 1, ticks: [0, 1] });
  assert.deepEqual(niceTicks(-5), { max: 1, ticks: [0, 1] });
});

test("money tick labels compact to K and M", () => {
  assert.equal(moneyTickLabel(0), "$0");
  assert.equal(moneyTickLabel(50000), "$500");
  assert.equal(moneyTickLabel(150000), "$1.5K");
  assert.equal(moneyTickLabel(40000000), "$400K");
  assert.equal(moneyTickLabel(125000000), "$1.25M");
});

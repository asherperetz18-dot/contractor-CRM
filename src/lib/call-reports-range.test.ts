import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { callReportDays } from "./call-reports-range.ts";

/**
 * Call Reports' period rides in the address as instants (`fromTs`, and
 * `toTs` for an end, exclusive). Its custom From / To boxes started
 * blank on every load, so a reload -- or the Daily Brief's "this week"
 * link, which lands on a custom range -- showed a period's calls under
 * two empty date boxes, and picking Custom started from nothing rather
 * than from the period on screen. The boxes now read the days the page
 * loaded, on the company's calendar.
 */

const LA = "America/Los_Angeles";
const TODAY = "2026-10-11";

test("a custom range reads back as its own first and last day", () => {
  // Oct 1 through Oct 8 inclusive: the end is Oct 9's midnight, exclusive.
  assert.deepEqual(
    callReportDays("2026-10-01T07:00:00.000Z", "2026-10-09T07:00:00.000Z", LA, TODAY),
    { from: "2026-10-01", to: "2026-10-08" }
  );
});

test("an open end runs to today", () => {
  // The Daily Brief's week tile: range=custom with only a start.
  assert.deepEqual(callReportDays("2026-10-05T07:00:00.000Z", null, LA, TODAY), {
    from: "2026-10-05",
    to: TODAY,
  });
});

test("the days are the company's, not UTC's", () => {
  // 8pm Pacific on Oct 1 is already Oct 2 in UTC.
  assert.deepEqual(
    callReportDays("2026-10-02T03:00:00.000Z", "2026-10-03T03:00:00.000Z", LA, TODAY),
    { from: "2026-10-01", to: "2026-10-02" }
  );
});

test("yesterday and last month read back as whole days", () => {
  assert.deepEqual(
    callReportDays("2026-10-10T07:00:00.000Z", "2026-10-11T07:00:00.000Z", LA, TODAY),
    { from: "2026-10-10", to: "2026-10-10" }
  );
  assert.deepEqual(
    callReportDays("2026-09-01T07:00:00.000Z", "2026-10-01T07:00:00.000Z", LA, TODAY),
    { from: "2026-09-01", to: "2026-09-30" }
  );
});

test("all time has no first day", () => {
  assert.deepEqual(callReportDays(null, null, LA, TODAY), { from: "", to: TODAY });
});

const view = readFileSync(
  new URL("../app/(app)/call-reports/call-reports-view.tsx", import.meta.url),
  "utf8"
);

test("the period picker sits in the filter row, beside search, rep and disposition", () => {
  // It sat alone in the page's top-right corner, across the screen from
  // the filters it works with, and was missed there.
  const bar = view.slice(view.indexOf('<div className="filter-bar">'));
  const search = bar.indexOf('placeholder="Search name or phone…"');
  const range = bar.indexOf('aria-label="Date range"');
  const reps = bar.indexOf('<option value="All">All Reps</option>');
  assert.ok(search > 0 && range > search && reps > range, "search, then the period, then the reps");
  assert.equal(view.split('aria-label="Date range"').length, 2, "one period picker on the page");
});

test("the custom boxes start on the days the page loaded", () => {
  assert.match(view, /useState\(initialFrom\)/);
  assert.match(view, /useState\(initialTo\)/);
});

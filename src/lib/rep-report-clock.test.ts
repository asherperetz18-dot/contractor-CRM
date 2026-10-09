import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The rep report's Custom chip and date boxes start from the company's
 * today, the one the page already reads its period and "no outcome
 * recorded" against. They used to read the browser's UTC date, which
 * runs a day ahead from 5pm Pacific: pressing Custom on the evening of
 * the 31st showed next month's 1st.
 */

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const page = source("../app/(app)/marketing-analytics/rep-report/page.tsx");
const filters = source("../app/(app)/marketing-analytics/rep-report/report-filters.tsx");

test("the rep report hands its filters the company's today", () => {
  assert.match(page, /const todayISO = isoDay\(now\);/);
  assert.match(page, /<RepReportFilters[\s\S]*?today=\{todayISO\}[\s\S]*?\/>/);
});

test("the Custom chip and a half-typed range start from that today, never a clock of their own", () => {
  assert.match(filters, /today: string;/);
  // Month to date: the 1st of the company's month through its today.
  assert.match(filters, /next\.set\("from", today\.slice\(0, 8\) \+ "01"\);/);
  assert.match(filters, /next\.set\("to", today\);/);
  // Typing one edge fills the other with the same today.
  assert.match(filters, /next\.set\(key === "from" \? "to" : "from", today\);/);
  assert.doesNotMatch(filters, /new Date\(/);
  assert.doesNotMatch(filters, /toISOString/);
});

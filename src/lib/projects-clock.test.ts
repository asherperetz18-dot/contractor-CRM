import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The Projects page, its crew view and its printed report read one
 * calendar, the company's: the server hands down today and the zone, the
 * Signed range and "New this month" are cut at the company's midnights,
 * and a checklist step is overdue from the company's day after its due
 * date. The page used the UTC date (a day ahead from 5pm Pacific) while
 * its printout used the company's, so the two disagreed every evening.
 */

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const page = source("../app/(app)/projects/page.tsx");
const view = source("../app/(app)/projects/projects-view.tsx");
const checklist = source("../app/(app)/projects/project-checklist.tsx");
const crew = source("../app/(app)/projects/crew-view.tsx");
const report = source("../app/(app)/projects/report/page.tsx");

test("the page hands both views the company's today, and the office view its zone", () => {
  assert.match(page, /const today = isoDateInZone\(new Date\(\), zone\);/);
  assert.match(page, /<ProjectsView[\s\S]*?today=\{today\}[\s\S]*?zone=\{zone\}[\s\S]*?\/>/);
  assert.match(page, /<CrewProjectsView[\s\S]*?today=\{today\}[\s\S]*?\/>/);
});

test("the office view filters on one company clock and reads no clock of its own", () => {
  assert.match(view, /const clock = useMemo\(\(\) => projectClock\(today, zone\), \[today, zone\]\);/);
  assert.match(view, /chipMatches\(p, "NewMonth", clock\)/);
  assert.match(view, /dateRangeBounds\(dateRange, customFrom, customTo, zone\)/);
  assert.match(view, /item\.due_date < today/);
  assert.doesNotMatch(view, /toISOString\(\)\.slice\(0, 10\)/);
  assert.doesNotMatch(view, /const now = new Date\(\)/);
});

test("a checklist step is overdue by the company's today, on every view that shows it", () => {
  assert.match(checklist, /today: string;/);
  assert.match(checklist, /item\.due_date < today/);
  assert.doesNotMatch(checklist, /toISOString/);
  for (const v of [view, crew]) assert.match(v, /<ProjectChecklist[\s\S]*?today=\{today\}[\s\S]*?\/>/);
});

test("the printed report filters on the same company clock as the page", () => {
  assert.match(report, /const clock = projectClock\(todayISO, zone\);/);
  assert.match(report, /dateRangeBounds\(range, sp\.from \?\? "", sp\.to \?\? "", zone\)/);
  assert.match(report, /chipMatches\(p, chip, clock\)/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { doneAtLabel, parseDonePeriod } from "./tasks-done.ts";

/**
 * The Tasks page's Done view: follow-ups marked done today, this week or
 * this month -- the list behind the Daily Brief's Tasks Completed tile,
 * on the same periods (briefPeriodStart), so the number tapped is the
 * number that opens.
 */

test("only today, week or month opens the Done view", () => {
  assert.equal(parseDonePeriod("today"), "today");
  assert.equal(parseDonePeriod("week"), "week");
  assert.equal(parseDonePeriod("month"), "month");
  for (const other of [undefined, null, "", "Today", "year", "7d", ["today"], 1]) {
    assert.equal(parseDonePeriod(other), null, String(other));
  }
});

test("a task's done time reads on the company's clock", () => {
  // 4:41am UTC on Oct 8 is still the evening of Oct 7 in Los Angeles.
  assert.equal(doneAtLabel("2026-10-08T04:41:00.000Z", "America/Los_Angeles"), "Oct 7, 9:41 PM");
  assert.equal(doneAtLabel("2026-10-08T04:41:00+00:00", "America/New_York"), "Oct 8, 12:41 AM");
});

const page = readFileSync(new URL("../app/(app)/tasks/page.tsx", import.meta.url), "utf8");

test("the Done view reads only the period's finished tasks, newest first", () => {
  assert.match(page, /parseDonePeriod\(/);
  assert.match(page, /briefPeriodStart\(done, now, zone\)/);
  const done = page.slice(page.indexOf('.from("lead_tasks")', page.indexOf("if (done)")));
  assert.match(done, /\.gte\("completed_at", since\)/);
  assert.match(done, /\.order\("completed_at", \{ ascending: false \}\)/);
});

test("the Tasks page's today is the dashboard's, so Overdue matches the card that opens it", () => {
  // Both read the server's day for now (from 5pm Pacific, a day ahead).
  // Moving them to the company's clock has to happen together, with the
  // dashboard rollup filing calls and money by the company's day as well
  // (TECH_DEBT): moved alone, the card and this section disagreed every
  // evening, and the rollup's 14-day calls strip and 12-month chart lost
  // the evening's calls and money.
  assert.match(page, /const today = isoDay\(now\);/);
  const dashboard = readFileSync(new URL("./actions/dashboard.ts", import.meta.url), "utf8");
  assert.match(dashboard, /const B = rollupBoundaries\(win\);/);
});

test("switching between Open and Done shows the new view's tasks", () => {
  // The view keeps its rows in state (so a task marked Done leaves the
  // list at once); without a key per view, the switch -- a link to this
  // same page -- would keep showing the old view's rows.
  assert.match(page, /key=\{done \?\? "open"\}/);
});

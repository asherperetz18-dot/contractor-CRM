import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { monthOf, monthRange, parseMonthParam, rangeCovers, weekRangeLabel } from "./calendar-range.ts";

/**
 * The Calendar used to load every appointment the company ever booked,
 * with every contact, task and note behind them, on every visit
 * (DECISIONS #142). It now loads one month -- the one in the address --
 * plus a week either side, so whatever the month, week or day view
 * shows is covered. These pin the range and the rules that moved.
 */

test("a month is read from the address only when it looks like one", () => {
  assert.equal(parseMonthParam("2026-10"), "2026-10");
  assert.equal(parseMonthParam("2026-01"), "2026-01");
  for (const bad of [undefined, null, "", "2026-13", "2026-00", "2026-1", "26-10", "2026-10-01", "2026-10;drop", 202610]) {
    assert.equal(parseMonthParam(bad), null, String(bad));
  }
  assert.equal(monthOf("2026-10-06"), "2026-10");
});

test("the range is the month and a week either side, across year ends and leap days", () => {
  assert.deepEqual(monthRange("2026-10"), { from: "2026-09-24", to: "2026-11-07" });
  assert.deepEqual(monthRange("2026-12"), { from: "2026-11-24", to: "2027-01-07" });
  assert.deepEqual(monthRange("2027-01"), { from: "2026-12-25", to: "2027-02-07" });
  assert.deepEqual(monthRange("2028-02"), { from: "2028-01-25", to: "2028-03-07" });
});

const iso = (d: Date) => d.toISOString().slice(0, 10);
function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

test("whatever the view shows for a day in the month, the range already has it", () => {
  for (const month of ["2026-02", "2026-05", "2026-08", "2026-11", "2027-01", "2028-02"]) {
    const range = monthRange(month);
    const [y, m] = month.split("-").map(Number);
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    // The month grid: the last days of the month before, the month, and
    // enough of the next to fill the last row -- as the board draws it.
    const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const gridStart = addDays(`${month}-01`, -firstDow);
    const cells = Math.ceil((firstDow + days) / 7) * 7;
    for (let i = 0; i < cells; i++) assert.ok(rangeCovers(range, addDays(gridStart, i)), `${month} grid cell ${i}`);
    // The week (Sunday first) around every day of the month.
    for (let d = 1; d <= days; d++) {
      const day = `${month}-${String(d).padStart(2, "0")}`;
      const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
      for (let i = 0; i < 7; i++) assert.ok(rangeCovers(range, addDays(day, i - dow)), `${day} week`);
    }
  }
  assert.equal(rangeCovers(monthRange("2026-10"), "2026-09-23"), false);
  assert.equal(rangeCovers(monthRange("2026-10"), "2026-11-08"), false);
});

test("the week heading names both ends, written out rather than left to the browser", () => {
  // Asked for only a day and a year, browsers print "2026 (day: 10)":
  // the heading read "Oct 4 – 2026 (day: 10)".
  assert.equal(weekRangeLabel("2026-10-04", "2026-10-10"), "Oct 4 – 10, 2026");
  assert.equal(weekRangeLabel("2026-09-27", "2026-10-03"), "Sep 27 – Oct 3, 2026");
  assert.equal(weekRangeLabel("2026-12-27", "2027-01-02"), "Dec 27, 2026 – Jan 2, 2027");
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the page reads one month of appointments, and only what stands behind them", () => {
  const page = source("../app/(app)/calendar/page.tsx");
  assert.match(page, /\.from\("events"\)\.select\("\*"\)\.eq\("company_id", companyId\)\.gte\("date", range\.from\)\.lte\("date", range\.to\)/);
  // No more "every contact that ever had an appointment".
  assert.doesNotMatch(page, /events!inner/);
  assert.match(page, /loadAppointmentContext\(supabase, companyId, events\)/);
  const context = source("./data/appointment-context.ts");
  for (const table of ["leads", "lead_tasks", "lead_notes", "estimates"]) {
    assert.match(context, new RegExp(`from\\("${table}"\\)[\\s\\S]{0,200}\\.in\\("${table === "leads" ? "id" : "lead_id"}", chunk\\)`), table);
  }
  // The two lookups that run with the service role are held to the same month.
  assert.match(page, /getAppointmentHolders\(range\)/);
  assert.match(page, /getLeadsBehindAppointments\(range\)/);
  const dispatcher = source("./actions/dispatcher.ts");
  for (const fn of ["getAppointmentHolders", "getLeadsBehindAppointments"]) {
    const body = dispatcher.slice(dispatcher.indexOf(`export async function ${fn}`)).split("\n}\n")[0];
    assert.match(body, /range\?: CalendarRange/, fn);
    assert.match(body, /withinRange\(/, fn);
  }
});

test("a link to one appointment opens on that appointment's month", () => {
  const page = source("../app/(app)/calendar/page.tsx");
  assert.match(page, /if \(eventDate\) month = monthOf\(eventDate\)/);
  const board = source("../app/(app)/calendar/calendar-board.tsx");
  assert.match(board, /setEditing\(found\);\s*setCursorDate\(found\.date\);/);
});

test("moving to another month loads it in place, and keeps the view, filters and open window", () => {
  const board = source("../app/(app)/calendar/calendar-board.tsx");
  // In a transition: the page on screen stays while the month loads (no
  // loading skeleton, nothing reset), and the toolbar says it's loading.
  assert.match(board, /startMonth\(\(\) =>\s*router\.replace\(`\/calendar\?month=\$\{neededMonth\}`, \{ scroll: false \}\)\s*\)/);
  assert.match(board, /const monthLoading = monthPending \|\| neededMonth !== loadedMonth;/);
  // A rep or dispatcher still ticked stays in its list after a move to a
  // month they have nothing in, so the tick can be undone.
  assert.match(board, /repDropdownOptions\(reps, \[\.\.\.onCalendar, \.\.\.repFilter\]\)/);
  assert.match(board, /new Set\(\[\.\.\.dispatcherByLead\.values\(\), \.\.\.dispatcherFilter\]\)/);
});

test("the board's week heading comes from weekRangeLabel", () => {
  const board = source("../app/(app)/calendar/calendar-board.tsx");
  assert.match(board, /weekRangeLabel\(ymdFromDate\(weekStart\), ymdFromDate\(end\)\)/);
  assert.doesNotMatch(board, /month: sameMonth \? undefined/);
});

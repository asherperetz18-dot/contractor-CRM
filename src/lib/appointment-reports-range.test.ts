import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  APPOINTMENT_REPORT_PRESETS,
  appointmentReportQuery,
  appointmentReportRange,
  appointmentReportWindow,
} from "./appointment-reports-range.ts";

/**
 * Appointment Reports' period rides in the address (`?range=7|90|all`, or
 * `?from=…&to=…` for a custom range) and the server loads only that
 * window. The page used to load every appointment the company ever had
 * and filter in the browser, and always opened on the last 30 days --
 * whatever link was followed. Now the Daily Brief's Showed / No-show
 * tile opens it on the days it counted, loading just those.
 */

const DEFAULT = { preset: "30", from: "", to: "" };

test("the address is read strictly: anything unexpected is the last 30 days", () => {
  assert.deepEqual(appointmentReportRange({}), DEFAULT);
  assert.deepEqual(appointmentReportRange({ range: "90" }), { preset: "90", from: "", to: "" });
  assert.deepEqual(appointmentReportRange({ range: "all" }), { preset: "all", from: "", to: "" });
  for (const bad of ["", "14", "today", "ALL", ["7"], 7]) {
    assert.deepEqual(appointmentReportRange({ range: bad }), DEFAULT, String(bad));
  }
  for (const bad of ["2026-02-31", "2026-13-01", "26-10-01", "0002-01-15", "2026-10-01T00:00", "", ["2026-10-01"], 20261001]) {
    assert.deepEqual(appointmentReportRange({ from: bad, to: bad }), DEFAULT, String(bad));
  }
});

test("a link's dates open the report on that custom range", () => {
  assert.deepEqual(appointmentReportRange({ from: "2026-10-05", to: "2026-10-08" }), {
    preset: "30",
    from: "2026-10-05",
    to: "2026-10-08",
  });
  // Either end alone is a range open on the other side, as the filter treats it.
  assert.deepEqual(appointmentReportRange({ from: "2026-10-01" }), { preset: "30", from: "2026-10-01", to: "" });
});

test("the address carries only what differs from the default, and reads back the same", () => {
  assert.equal(appointmentReportQuery(DEFAULT), "");
  assert.equal(appointmentReportQuery({ preset: "7", from: "", to: "" }), "?range=7");
  // Custom dates win over the preset (the filter keeps the old preset
  // under them), so the preset isn't in the address.
  assert.equal(
    appointmentReportQuery({ preset: "7", from: "2026-10-01", to: "2026-10-08" }),
    "?from=2026-10-01&to=2026-10-08"
  );
  for (const r of [DEFAULT, { preset: "90", from: "", to: "" }, { preset: "30", from: "2026-10-01", to: "" }]) {
    const qs = appointmentReportQuery(r);
    const back = appointmentReportRange(Object.fromEntries(new URLSearchParams(qs)));
    assert.equal(appointmentReportQuery(back), qs);
  }
});

/**
 * One window, from the company's today the server hands down: the server
 * loads exactly it and the report counts exactly it, so the two can't
 * drift -- and nothing reads a clock while the page renders, where the
 * server's (UTC) and the browser's disagree every US evening.
 */
test("a period's days run up to today, never past it -- only what has happened is reported", () => {
  const today = "2026-10-08";
  assert.deepEqual(appointmentReportWindow({ preset: "7", from: "", to: "" }, today), { from: "2026-10-01", to: today });
  assert.deepEqual(appointmentReportWindow({ preset: "30", from: "", to: "" }, today), { from: "2026-09-08", to: today });
  assert.deepEqual(appointmentReportWindow({ preset: "90", from: "", to: "" }, today), { from: "2026-07-10", to: today });
  assert.deepEqual(appointmentReportWindow({ preset: "all", from: "", to: "" }, today), { from: null, to: today });
  // Every preset the filter offers reads back from the address and ends today.
  for (const p of APPOINTMENT_REPORT_PRESETS) {
    assert.equal(appointmentReportWindow(appointmentReportRange({ range: p.key }), today).to, today, p.key);
  }
  // Custom dates are absolute, but a range running into next month
  // reports on the part of it that has been and gone.
  assert.deepEqual(appointmentReportWindow({ preset: "30", from: "2026-10-01", to: "2026-10-05" }, today), {
    from: "2026-10-01",
    to: "2026-10-05",
  });
  assert.deepEqual(appointmentReportWindow({ preset: "7", from: "2026-10-01", to: "2026-11-30" }, today), {
    from: "2026-10-01",
    to: today,
  });
  assert.deepEqual(appointmentReportWindow({ preset: "30", from: "", to: "2026-10-03" }, today), {
    from: null,
    to: "2026-10-03",
  });
});

test("the Daily Brief's Showed / No-show days open as exactly those days", () => {
  // briefTileLinks sends the period's first day to the company's today.
  const r = appointmentReportRange({ from: "2026-10-05", to: "2026-10-08" });
  assert.deepEqual(appointmentReportWindow(r, "2026-10-08"), { from: "2026-10-05", to: "2026-10-08" });
});

const page = readFileSync(new URL("../app/(app)/appointment-reports/page.tsx", import.meta.url), "utf8");
const view = readFileSync(
  new URL("../app/(app)/appointment-reports/appointment-reports-view.tsx", import.meta.url),
  "utf8"
);

test("the page loads one window of appointments, not every one the company ever had", () => {
  assert.match(page, /const range = appointmentReportRange\(await searchParams\);/);
  assert.match(page, /const today = await companyToday\(\);/);
  assert.match(page, /const win = appointmentReportWindow\(range, today\);/);
  assert.match(page, /\.lte\("date", win\.to\)/);
  assert.match(page, /if \(win\.from\) q = q\.gte\("date", win\.from\);/);
  // A tie-breaker, so paging a window past 1,000 appointments neither repeats nor skips one.
  assert.match(page, /\.order\("date", \{ ascending: false \}\)\s*\.order\("id"\)/);
  assert.match(page, /query=\{range\}/);
  assert.match(page, /today=\{today\}/);
});

test("changing the period loads it in place, and a link arriving on the open report is followed", () => {
  assert.match(view, /startWindow\(\(\) => router\.replace\(`\/appointment-reports\$\{wantedQs\}`, \{ scroll: false \}\)\)/);
  // Until the new period arrives, the numbers stay on the one that's loaded.
  assert.match(view, /const shownRange = loading \? query : range;/);
  // The brief opens from the top bar on this very page: when the address
  // moves somewhere this view didn't ask to go, it follows rather than
  // sending it back to the old period.
  assert.match(view, /if \(seenQs !== loadedQs\) \{\s*setSeenQs\(loadedQs\);\s*if \(loadedQs !== wantedQs\) setRange\(query\);/);
  assert.doesNotMatch(page, /key=/);
});

test("the report counts the server's window and reads no clock while it renders", () => {
  // It read the clock during render: on the server (UTC) and again in
  // the browser (local), which disagree from 5pm Pacific, so the first
  // load's counts didn't match and React re-drew the page -- and the UTC
  // "today" put tomorrow's appointments under No Result Yet.
  assert.match(view, /const win = appointmentReportWindow\(shownRange, today\);/);
  assert.doesNotMatch(view, /resolveWindow|isoDay\(|toISOString\(\)\.slice/);
  // The one clock left marks a result overdue by the hour, and is drawn
  // only once a rep's row is opened -- never in the first render.
  assert.match(view, /const \[expandedRep, setExpandedRep\] = useState<string \| null>\(null\);/);
});

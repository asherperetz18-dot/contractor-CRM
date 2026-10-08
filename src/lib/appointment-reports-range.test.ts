import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  APPOINTMENT_REPORT_PRESETS,
  appointmentReportQuery,
  appointmentReportRange,
  appointmentReportServerWindow,
} from "./appointment-reports-range.ts";
import { isoDay, resolveWindow } from "./data/date-range.ts";

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

test("custom dates load exactly, never past tomorrow; all time has no start", () => {
  assert.deepEqual(
    appointmentReportServerWindow({ preset: "30", from: "2026-10-01", to: "2026-10-05" }, "2026-10-08"),
    { lo: "2026-10-01", hi: "2026-10-05" }
  );
  // Only appointments that have happened are reported: a range running
  // into next month loads no further than tomorrow.
  assert.deepEqual(
    appointmentReportServerWindow({ preset: "30", from: "2026-10-01", to: "2026-11-30" }, "2026-10-08"),
    { lo: "2026-10-01", hi: "2026-10-09" }
  );
  assert.deepEqual(appointmentReportServerWindow({ preset: "all", from: "", to: "" }, "2026-10-08"), {
    lo: null,
    hi: "2026-10-09",
  });
});

// The browser decides "today" (the presets and the has-it-happened cap
// are its local day); the server knows only the UTC date, a day either
// side of it. Its window must hold every appointment the report shows.
const ZONES = ["America/Los_Angeles", "America/New_York", "Europe/London", "Asia/Kolkata", "Australia/Sydney", "Pacific/Kiritimati", "Pacific/Pago_Pago"];
const INSTANTS = [
  "2026-10-08T01:00:00Z", // 6pm Pacific, already tomorrow in UTC
  "2026-10-08T16:00:00Z",
  "2026-03-08T10:30:00Z", // US clocks go forward
  "2026-11-01T08:30:00Z", // US clocks go back
  "2026-03-29T00:30:00Z", // London clocks go forward
  "2026-10-04T15:30:00Z", // Sydney clocks go forward
  "2027-01-01T00:30:00Z",
  "2028-02-29T23:30:00Z",
];

test("whatever 'today' is where the person is, the server's window holds every appointment the report shows", () => {
  const original = process.env.TZ;
  try {
    for (const zone of ZONES) {
      process.env.TZ = zone;
      for (const at of INSTANTS) {
        const now = new Date(at);
        const localToday = isoDay(now);
        for (const p of APPOINTMENT_REPORT_PRESETS) {
          const range = appointmentReportRange({ range: p.key });
          const client = resolveWindow(range, now);
          const server = appointmentReportServerWindow(range, at.slice(0, 10));
          const label = `${p.key} in ${zone} at ${at}`;
          assert.ok(server.hi >= localToday, `${label}: hi ${server.hi} < today ${localToday}`);
          if (client.from === null) assert.equal(server.lo, null, label);
          else assert.ok(server.lo !== null && server.lo <= client.from, `${label}: ${server.lo} > ${client.from}`);
        }
      }
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

const page = readFileSync(new URL("../app/(app)/appointment-reports/page.tsx", import.meta.url), "utf8");
const view = readFileSync(
  new URL("../app/(app)/appointment-reports/appointment-reports-view.tsx", import.meta.url),
  "utf8"
);

test("the page loads one window of appointments, not every one the company ever had", () => {
  assert.match(page, /const range = appointmentReportRange\(await searchParams\);/);
  assert.match(page, /appointmentReportServerWindow\(range, new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\)/);
  assert.match(page, /\.lte\("date", bounds\.hi\)/);
  assert.match(page, /if \(bounds\.lo\) q = q\.gte\("date", bounds\.lo\);/);
  // A tie-breaker, so paging a window past 1,000 appointments neither repeats nor skips one.
  assert.match(page, /\.order\("date", \{ ascending: false \}\)\s*\.order\("id"\)/);
  assert.match(page, /query=\{range\}/);
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

test("the report's today is the local day, not the UTC one", () => {
  // From 5pm Pacific the UTC date is tomorrow: tomorrow's appointments
  // counted as already happened (Pending), dragging a preset's numbers
  // away from the brief's. The presets themselves were already local.
  assert.doesNotMatch(view, /toISOString\(\)\.slice\(0, 10\)/);
  assert.match(view, /const todayISO = isoDay\(new Date\(nowMs\)\);/);
});

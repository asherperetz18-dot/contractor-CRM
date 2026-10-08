import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appointmentReportRange } from "./appointment-reports-range.ts";

/**
 * Appointment Reports opens on a range a link carries
 * (`?from=YYYY-MM-DD&to=YYYY-MM-DD`), so the Daily Brief's Showed /
 * No-show tile opens on the days it counted. It used to always open on
 * the last 30 days, whatever was clicked.
 */

const DEFAULT = { preset: "30", from: "", to: "" };

test("a link's dates open the report on that custom range", () => {
  assert.deepEqual(appointmentReportRange({ from: "2026-10-05", to: "2026-10-08" }), {
    preset: "30",
    from: "2026-10-05",
    to: "2026-10-08",
  });
  // Either end alone is a range open on the other side, as the filter treats it.
  assert.deepEqual(appointmentReportRange({ from: "2026-10-01" }), { preset: "30", from: "2026-10-01", to: "" });
});

test("anything that isn't a real day is ignored, and the report opens as before", () => {
  assert.deepEqual(appointmentReportRange({}), DEFAULT);
  for (const bad of ["2026-02-31", "2026-13-01", "26-10-01", "0002-01-15", "2026-10-01T00:00", "", ["2026-10-01"], 20261001]) {
    assert.deepEqual(appointmentReportRange({ from: bad, to: bad }), DEFAULT, String(bad));
  }
});

const page = readFileSync(new URL("../app/(app)/appointment-reports/page.tsx", import.meta.url), "utf8");
const view = readFileSync(
  new URL("../app/(app)/appointment-reports/appointment-reports-view.tsx", import.meta.url),
  "utf8"
);

test("the page hands the link's range to the report", () => {
  assert.match(page, /const range = appointmentReportRange\(await searchParams\);/);
  assert.match(page, /initialRange=\{range\}/);
  assert.match(view, /useState<RangeState>\(initialRange\)/);
  // Keyed by range: the brief opens from the top bar on this very page,
  // and a new link must not be swallowed by the range already in state.
  assert.match(page, /key=\{`\$\{range\.from\}\|\$\{range\.to\}`\}/);
});

test("the report's today is the local day, not the UTC one", () => {
  // From 5pm Pacific the UTC date is tomorrow: tomorrow's appointments
  // counted as already happened (Pending), dragging a preset's numbers
  // away from the brief's. The presets themselves were already local.
  assert.doesNotMatch(view, /toISOString\(\)\.slice\(0, 10\)/);
  assert.match(view, /const todayISO = isoDay\(new Date\(nowMs\)\);/);
});

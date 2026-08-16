import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeWindow,
  isoDay,
  monthToDate,
  presetWindow,
  resolveWindow,
  withinWindow,
} from "./date-range.ts";

/**
 * Every report filter in the app runs through these. A window that is
 * wrong by one day at either edge does not fail loudly -- the report just
 * comes back a little short, and nobody can tell by looking. So the edges
 * are tested rather than assumed.
 */

const MARCH = { from: "2026-03-01", to: "2026-03-31" };

test("both edges are inclusive", () => {
  assert.equal(withinWindow("2026-03-01", MARCH), true);
  assert.equal(withinWindow("2026-03-31", MARCH), true);
  assert.equal(withinWindow("2026-02-28", MARCH), false);
  assert.equal(withinWindow("2026-04-01", MARCH), false);
});

test("a timestamp on the last day is still inside the window", () => {
  // The bug this guards: "2026-03-31T22:13:43Z" > "2026-03-31" as a
  // string, so comparing whole values drops everything signed on the
  // closing day of every range.
  assert.equal(withinWindow("2026-03-31T22:13:43Z", MARCH), true);
  assert.equal(withinWindow("2026-03-01T00:00:00Z", MARCH), true);
  assert.equal(withinWindow("2026-04-01T00:00:01Z", MARCH), false);
});

test("a missing date is never in a window", () => {
  assert.equal(withinWindow(null, MARCH), false);
  assert.equal(withinWindow(undefined, MARCH), false);
  assert.equal(withinWindow("", MARCH), false);
  // Including all time -- a row with no date cannot be placed in a
  // period, and counting it everywhere would inflate every report.
  assert.equal(withinWindow(null, { from: null, to: null }), false);
});

test("one open edge means everything on that side", () => {
  assert.equal(withinWindow("2020-01-01", { from: null, to: "2026-03-31" }), true);
  assert.equal(withinWindow("2099-01-01", { from: "2026-03-01", to: null }), true);
  assert.equal(withinWindow("2099-01-01", { from: null, to: null }), true);
});

test("presets run from their start to today", () => {
  const now = new Date("2026-08-15T12:00:00");
  assert.deepEqual(presetWindow("7", now), { from: "2026-08-08", to: null });
  assert.deepEqual(presetWindow("30", now), { from: "2026-07-16", to: null });
  assert.deepEqual(presetWindow("today", now), { from: "2026-08-15", to: null });
  assert.deepEqual(presetWindow("all", now), { from: null, to: null });
});

test("an unrecognised preset shows everything rather than throwing", () => {
  const now = new Date("2026-08-15T12:00:00");
  assert.deepEqual(presetWindow("", now), { from: null, to: null });
  assert.deepEqual(presetWindow("nonsense", now), { from: null, to: null });
  assert.deepEqual(presetWindow("-5", now), { from: null, to: null });
});

test("isoDay uses the local calendar date, not UTC", () => {
  // Late evening in a negative-offset zone is already tomorrow in UTC.
  // Using the UTC date would file the evening's work under the wrong day.
  const d = new Date(2026, 7, 15, 23, 30);
  assert.equal(isoDay(d), "2026-08-15");
});

test("custom dates win over the preset", () => {
  const now = new Date("2026-08-15T12:00:00");
  assert.deepEqual(resolveWindow({ preset: "30", from: "2026-03-01", to: "2026-03-31" }, now), {
    from: "2026-03-01",
    to: "2026-03-31",
  });
  // A single edge is a real question: "everything since March".
  assert.deepEqual(resolveWindow({ preset: "30", from: "2026-03-01", to: "" }, now), {
    from: "2026-03-01",
    to: null,
  });
  assert.deepEqual(resolveWindow({ preset: "7", from: "", to: "" }, now), {
    from: "2026-08-08",
    to: null,
  });
});

test("month to date starts on the first", () => {
  assert.deepEqual(monthToDate(new Date(2026, 7, 15)), {
    from: "2026-08-01",
    to: "2026-08-15",
  });
});

const LABELS = { "7": "Last 7 days", "30": "Last 30 days", all: "All time" };

test("a custom range is described by its dates, never as 'Custom'", () => {
  assert.equal(
    describeWindow({ preset: "30", from: "2026-03-01", to: "2026-03-31" }, LABELS),
    "March 1, 2026 – March 31, 2026"
  );
  assert.equal(describeWindow({ preset: "30", from: "2026-03-01", to: "" }, LABELS), "From March 1, 2026");
  assert.equal(describeWindow({ preset: "30", from: "", to: "2026-03-31" }, LABELS), "Up to March 31, 2026");
});

test("a preset is described by its label", () => {
  assert.equal(describeWindow({ preset: "7", from: "", to: "" }, LABELS), "Last 7 days");
  assert.equal(describeWindow({ preset: "all", from: "", to: "" }, LABELS), "All time");
  assert.equal(describeWindow({ preset: "unknown", from: "", to: "" }, LABELS), "All time");
});

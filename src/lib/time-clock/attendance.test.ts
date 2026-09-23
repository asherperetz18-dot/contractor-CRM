import { test } from "node:test";
import assert from "node:assert/strict";
import { appointmentAttendance, liveStatus } from "./attendance.ts";

/**
 * Attendance is judged from automatic arrivals, so the edges: early is
 * on time, the grace window is inclusive, an appointment still inside
 * its grace window isn't "missed" yet, and only the FIRST arrival
 * counts (stepping out and back in doesn't make you late).
 */

const START = new Date("2026-09-23T21:00:00Z");

test("arriving before start, or within the grace window, is on time", () => {
  const early = appointmentAttendance(START, ["2026-09-23T20:54:00Z"], 10, new Date("2026-09-23T22:00:00Z"));
  assert.deepEqual(early, { status: "on-time", minutesLate: 0 });
  const edge = appointmentAttendance(START, ["2026-09-23T21:10:00Z"], 10, new Date("2026-09-23T22:00:00Z"));
  assert.deepEqual(edge, { status: "on-time", minutesLate: 10 });
});

test("past the grace window is late, by the first arrival", () => {
  const r = appointmentAttendance(
    START,
    ["2026-09-23T21:40:00Z", "2026-09-23T21:22:00Z"],
    10,
    new Date("2026-09-23T22:00:00Z")
  );
  assert.deepEqual(r, { status: "late", minutesLate: 22 });
});

test("no arrival: waiting while inside the window, missed after it", () => {
  assert.deepEqual(
    appointmentAttendance(START, [], 10, new Date("2026-09-23T21:05:00Z")),
    { status: "upcoming", minutesLate: 0 }
  );
  assert.deepEqual(
    appointmentAttendance(START, [], 10, new Date("2026-09-23T21:30:00Z")),
    { status: "missed", minutesLate: 30 }
  );
});

const NOW = new Date("2026-09-23T21:00:00Z");

test("live status: off the clock and on break say so, whatever the pings", () => {
  assert.equal(liveStatus({ shift: "off", pings: [], visitLabel: null }, NOW), "off");
  assert.equal(liveStatus({ shift: "break", pings: [], visitLabel: null }, NOW), "break");
});

test("live status: no ping for 15 minutes is no signal", () => {
  const pings = [{ recorded_at: "2026-09-23T20:40:00Z", lat: 34, lng: -118 }];
  assert.equal(liveStatus({ shift: "on", pings, visitLabel: "Roof" }, NOW), "no-signal");
  assert.equal(liveStatus({ shift: "on", pings: [], visitLabel: null }, NOW), "no-signal");
});

test("live status: inside a zone is at a job (or the office)", () => {
  const pings = [{ recorded_at: "2026-09-23T20:58:00Z", lat: 34, lng: -118 }];
  assert.equal(liveStatus({ shift: "on", pings, visitLabel: "Roof" }, NOW), "at-job");
  assert.equal(liveStatus({ shift: "on", pings, visitLabel: "Office" }, NOW), "office");
});

test("live status: moving faster than a walk between the last two pings is driving", () => {
  const driving = [
    { recorded_at: "2026-09-23T20:58:00Z", lat: 34.01, lng: -118 },
    { recorded_at: "2026-09-23T20:56:00Z", lat: 34.0, lng: -118 },
  ];
  assert.equal(liveStatus({ shift: "on", pings: driving, visitLabel: null }, NOW), "driving");
  const still = [
    { recorded_at: "2026-09-23T20:58:00Z", lat: 34.0001, lng: -118 },
    { recorded_at: "2026-09-23T20:48:00Z", lat: 34.0, lng: -118 },
  ];
  assert.equal(liveStatus({ shift: "on", pings: still, visitLabel: null }, NOW), "stopped");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { describePunchChange, punchChanged, type PunchSnapshot } from "./punch-changes.ts";

/**
 * The trail stores raw snapshots and describes them at read time, so
 * these lines ARE the history payroll reads. Nothing changed must read
 * as nothing (that decides whether a row is written at all), times read
 * in the company's zone, and an open punch reads as "still open".
 */

const ZONE = "America/Los_Angeles";
const base: PunchSnapshot = {
  clock_in: "2026-09-22T14:30:00Z",
  clock_out: "2026-09-23T02:55:00Z",
  end_reason: "clock_out",
};

test("no change describes as nothing", () => {
  assert.deepEqual(describePunchChange(base, { ...base }, ZONE), []);
  assert.equal(punchChanged(base, { ...base }), false);
});

test("the same instant written differently is not a change", () => {
  assert.equal(punchChanged(base, { ...base, clock_in: "2026-09-22T14:30:00.000+00:00" }), false);
});

test("a corrected clock-out reads in local time, before → after", () => {
  const after = { ...base, clock_out: "2026-09-22T23:30:00Z" };
  assert.deepEqual(describePunchChange(base, after, ZONE), ["Clock-out: Sep 22, 7:55 PM → Sep 22, 4:30 PM"]);
});

test("closing a forgotten punch reads from 'still open'", () => {
  const before = { ...base, clock_out: null, end_reason: null };
  const lines = describePunchChange(before, base, ZONE);
  assert.deepEqual(lines, ["Clock-out: still open → Sep 22, 7:55 PM"]);
});

test("both ends moved gives two lines, clock-in first", () => {
  const after = { ...base, clock_in: "2026-09-22T15:00:00Z", clock_out: "2026-09-23T01:00:00Z" };
  assert.deepEqual(describePunchChange(base, after, ZONE), [
    "Clock-in: Sep 22, 7:30 AM → Sep 22, 8:00 AM",
    "Clock-out: Sep 22, 7:55 PM → Sep 22, 6:00 PM",
  ]);
});

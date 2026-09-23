import { test } from "node:test";
import assert from "node:assert/strict";
import {
  punchMinutes,
  shiftState,
  weekSummary,
  timesheetCsv,
  wallInputValue,
  weekDays,
  type PunchRow,
} from "./hours.ts";

/**
 * These numbers go to payroll. The edges: a break is unpaid, an open
 * punch counts up to now, a shift is filed on the day it started in the
 * COMPANY's zone (a 5 PM Pacific clock-in is the next day in UTC), and
 * overtime is weekly hours past the company's line.
 */

const ZONE = "America/Los_Angeles";
const P = "11111111-1111-1111-1111-111111111111";

function punch(clockIn: string, clockOut: string | null, endReason: PunchRow["end_reason"] = "clock_out"): PunchRow {
  return {
    id: clockIn,
    profile_id: P,
    clock_in: clockIn,
    clock_out: clockOut,
    end_reason: clockOut ? endReason : null,
  };
}

test("a closed punch is its length; an open one counts to now", () => {
  const now = new Date("2026-09-23T20:00:00Z");
  assert.equal(punchMinutes(punch("2026-09-23T15:00:00Z", "2026-09-23T16:30:00Z"), now), 90);
  assert.equal(punchMinutes(punch("2026-09-23T19:15:00Z", null), now), 45);
});

test("state: off, on, on break", () => {
  const now = new Date("2026-09-23T20:00:00Z");
  assert.equal(shiftState([], now), "off");
  assert.equal(shiftState([punch("2026-09-23T15:00:00Z", null)], now), "on");
  assert.equal(
    shiftState([punch("2026-09-23T15:00:00Z", "2026-09-23T19:30:00Z", "break")], now),
    "break"
  );
  assert.equal(
    shiftState([punch("2026-09-23T15:00:00Z", "2026-09-23T19:30:00Z", "clock_out")], now),
    "off"
  );
});

test("a break yesterday doesn't leave you on break today", () => {
  const now = new Date("2026-09-24T16:00:00Z");
  assert.equal(
    shiftState([punch("2026-09-23T15:00:00Z", "2026-09-23T19:30:00Z", "break")], now),
    "off"
  );
});

test("hours land on the company-local day the shift started", () => {
  const days = ["2026-09-21", "2026-09-22", "2026-09-23"];
  // 5 PM–7 PM Pacific on the 22nd is 00:00–02:00 UTC on the 23rd.
  const s = weekSummary(
    [punch("2026-09-23T00:00:00Z", "2026-09-23T02:00:00Z")],
    days,
    ZONE,
    new Date("2026-09-25T00:00:00Z"),
    40
  );
  assert.deepEqual(s.get(P)?.minutesByDay, { "2026-09-21": 0, "2026-09-22": 120, "2026-09-23": 0 });
});

test("a break splits a shift and isn't paid", () => {
  const days = ["2026-09-23"];
  const s = weekSummary(
    [
      punch("2026-09-23T15:00:00Z", "2026-09-23T19:00:00Z", "break"),
      punch("2026-09-23T19:30:00Z", "2026-09-23T23:30:00Z"),
    ],
    days,
    ZONE,
    new Date("2026-09-24T00:00:00Z"),
    40
  );
  assert.equal(s.get(P)?.totalMinutes, 8 * 60);
});

test("overtime is the weekly minutes past the line; missing clock-outs are flagged", () => {
  const days = ["2026-09-21", "2026-09-22"];
  const s = weekSummary(
    [
      punch("2026-09-21T14:00:00Z", "2026-09-22T00:00:00Z"),
      punch("2026-09-22T14:00:00Z", "2026-09-22T20:00:00Z", "auto"),
    ],
    days,
    ZONE,
    new Date("2026-09-24T00:00:00Z"),
    15
  );
  const row = s.get(P)!;
  assert.equal(row.totalMinutes, 16 * 60);
  assert.equal(row.overtimeMinutes, 60);
  assert.equal(row.autoClosed, 1);
});

test("CSV has one row per person, hours to two decimals, and quotes names", () => {
  const days = ["2026-09-21"];
  const s = weekSummary(
    [punch("2026-09-21T15:00:00Z", "2026-09-21T23:20:00Z")],
    days,
    ZONE,
    new Date("2026-09-24T00:00:00Z"),
    40
  );
  const csv = timesheetCsv(s, days, (id) => (id === P ? 'Dana "DJ" Levi' : "Unnamed"));
  assert.equal(
    csv,
    'Person,2026-09-21,Total hours,Overtime hours,Auto clock-outs\n"Dana ""DJ"" Levi",8.33,8.33,0.00,0\n'
  );
});

test("a week runs Monday to Sunday around any day in it", () => {
  const monday = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"];
  assert.deepEqual(weekDays("2026-09-23"), monday);
  assert.deepEqual(weekDays("2026-09-21"), monday);
  assert.deepEqual(weekDays("2026-09-27"), monday);
});

test("an instant reads as a datetime-local value on the company's clock", () => {
  assert.equal(wallInputValue("2026-09-23T02:55:00Z", ZONE), "2026-09-22T19:55");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  calendarDay,
  dayEndInZone,
  dayLabel,
  dayStartInZone,
  instantOfWallClock,
  isoDateInZone,
  isoDateReader,
  stampedWithin,
  windowInstants,
  localClockIn,
  utcClockIn,
  wallClockIn,
} from "./company-clock.ts";
import { isoDay } from "./data/date-range.ts";
import {
  TIMEZONE_IANA,
  TIMEZONE_OPTIONS,
  companyIanaZone,
  defaultDueDate,
  hasFollowUpDue,
  type LeadTask,
} from "./data/types.ts";

/**
 * Vercel's clock is UTC. At 5pm in Los Angeles a bare
 * `new Date().toISOString().slice(0, 10)` on the server already says
 * tomorrow, and every page that asked the machine what day it was drifted
 * a day after dinner. These pin the company's calendar to the company's
 * own zone, whatever the machine's clock says.
 */

const LA = "America/Los_Angeles";
const NY = "America/New_York";

// 7:30 PM on Sep 20 in Los Angeles; already Sep 21 in UTC.
const EVENING_LA = new Date("2026-09-21T02:30:00Z");

test("the calendar day is the zone's, not UTC's", () => {
  assert.equal(isoDateInZone(EVENING_LA, LA), "2026-09-20");
  assert.equal(isoDateInZone(EVENING_LA, NY), "2026-09-20");
  assert.equal(isoDateInZone(EVENING_LA, "UTC"), "2026-09-21");
  // 11:30 PM in Los Angeles is 2:30 AM in New York -- zones disagree
  // with each other, not only with the server.
  const lateLA = new Date("2026-09-21T06:30:00Z");
  assert.equal(isoDateInZone(lateLA, LA), "2026-09-20");
  assert.equal(isoDateInZone(lateLA, NY), "2026-09-21");
});

test("isoDateReader reads many instants on one zone's calendar, as isoDateInZone does", () => {
  // One formatter for a whole batch: building one per row cost seconds
  // across a contact book.
  const inLA = isoDateReader(LA);
  assert.equal(inLA(EVENING_LA), "2026-09-20");
  assert.equal(inLA(new Date("2026-09-21T06:30:00Z")), "2026-09-20");
  assert.equal(inLA(new Date("2026-09-21T07:00:00Z")), "2026-09-21");
  assert.equal(isoDateReader("UTC")(EVENING_LA), "2026-09-21");
  // Across the November change, every hour of a day agrees with the slow path.
  for (let h = 0; h < 48; h++) {
    const at = new Date(Date.UTC(2026, 10, 1, h, 30));
    assert.equal(inLA(at), isoDateInZone(at, LA), at.toISOString());
  }
});

test("a window of days becomes the instants a timestamp column is cut at, on the zone's midnights", () => {
  // "Oct 1 to Oct 10" in Los Angeles: from its midnight on the 1st up to
  // the midnight after the 10th, so the 10th's evening stays in.
  assert.deepEqual(windowInstants({ from: "2026-10-01", to: "2026-10-10" }, LA), {
    from: "2026-10-01T07:00:00.000Z",
    before: "2026-10-11T07:00:00.000Z",
  });
  // An open edge stays open.
  assert.deepEqual(windowInstants({ from: "2026-10-01", to: null }, LA), {
    from: "2026-10-01T07:00:00.000Z",
    before: null,
  });
  assert.deepEqual(windowInstants({ from: null, to: null }, LA), { from: null, before: null });
  // Across the November change the day after starts on standard time.
  assert.equal(windowInstants({ from: null, to: "2026-11-01" }, LA).before, "2026-11-02T08:00:00.000Z");
});

test("a timestamp is in a window of days when it falls between the zone's midnights", () => {
  const inOct1to10 = stampedWithin({ from: "2026-10-01", to: "2026-10-10" }, LA);
  // Oct 10, 7pm in Los Angeles: UTC already calls it the 11th.
  assert.equal(inOct1to10("2026-10-11T02:00:00Z"), true);
  // Sep 30, 8pm: UTC calls it Oct 1, but it's the evening before.
  assert.equal(inOct1to10("2026-10-01T03:00:00Z"), false);
  // Midnight on the 1st is in; midnight after the 10th is out.
  assert.equal(inOct1to10("2026-10-01T07:00:00+00:00"), true);
  assert.equal(inOct1to10("2026-10-11T07:00:00.000Z"), false);
  // Supabase's microseconds read the same.
  assert.equal(inOct1to10("2026-10-05T12:00:00.123456+00:00"), true);
  assert.equal(inOct1to10(null), false);
  // An open edge lets everything through on that side.
  assert.equal(stampedWithin({ from: null, to: null }, LA)("1999-01-01T00:00:00Z"), true);
});

test("a calendar day from an address is kept only when it is a real day", () => {
  assert.equal(calendarDay("2026-09-30"), "2026-09-30");
  assert.equal(calendarDay("2028-02-29"), "2028-02-29");
  for (const bad of ["2026-02-31", "2026-13-01", "abc", "", "0002-01-15", "2026-9-30", undefined, null, 20260930]) {
    assert.equal(calendarDay(bad), null, String(bad));
  }
});

test("Arizona keeps standard time all summer, so it is not Mountain Time", () => {
  // 00:30 MDT on Jul 15 in Denver is still 23:30 MST on Jul 14 in Phoenix.
  const july = new Date("2026-07-15T06:30:00Z");
  assert.equal(isoDateInZone(july, "America/Denver"), "2026-07-15");
  assert.equal(isoDateInZone(july, "America/Phoenix"), "2026-07-14");
  assert.equal(companyIanaZone("Arizona"), "America/Phoenix");
});

test("every timezone the profile offers resolves to a real zone", () => {
  assert.ok(TIMEZONE_OPTIONS.some((o) => o.value === "Arizona"));
  for (const option of TIMEZONE_OPTIONS) {
    assert.ok(TIMEZONE_IANA[option.value], `${option.value} has no IANA zone`);
    // A zone Intl does not know throws a RangeError here.
    assert.doesNotThrow(() => isoDateInZone(EVENING_LA, TIMEZONE_IANA[option.value]));
  }
  // Unknown or missing labels fall back to the column's own default.
  assert.equal(companyIanaZone(null), "America/Los_Angeles");
  assert.equal(companyIanaZone("Mars"), "America/Los_Angeles");
});

test("wall clock reads the zone's hour across a DST change", () => {
  // DST began Mar 8, 2026 at 2:00 AM Pacific.
  assert.equal(wallClockIn(new Date("2026-03-08T09:30:00Z"), LA).hour, 1); // PST
  assert.equal(wallClockIn(new Date("2026-03-08T10:30:00Z"), LA).hour, 3); // PDT
  const w = wallClockIn(EVENING_LA, LA);
  assert.deepEqual(w, { year: 2026, month: 9, day: 20, hour: 19, minute: 30, second: 0 });
});

test("addDays is plain calendar arithmetic", () => {
  assert.equal(addDays("2026-09-30", 2), "2026-10-02");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(addDays("2026-09-20", 0), "2026-09-20");
});

test("localClockIn hands the date-range helpers the company's calendar", () => {
  // The date-range helpers read local getters; this Date's local
  // getters are the zone's wall clock, whatever the machine's zone is.
  const local = localClockIn(EVENING_LA, LA);
  assert.equal(local.getFullYear(), 2026);
  assert.equal(local.getMonth(), 8);
  assert.equal(local.getDate(), 20);
  assert.equal(local.getHours(), 19);
  assert.equal(local.getMinutes(), 30);
  assert.equal(isoDay(local), "2026-09-20");
});

test("utcClockIn is the naive-as-UTC encoding the crons compare against", () => {
  const naive = utcClockIn(EVENING_LA, LA);
  assert.equal(naive.toISOString().slice(0, 10), "2026-09-20");
  assert.equal(naive.getUTCHours(), 19);
  assert.equal(naive.getUTCMinutes(), 30);
});

test("dayLabel prints a plain date as itself and a timestamp on the zone's calendar", () => {
  assert.equal(dayLabel("2026-09-20", LA, "short"), "Sep 20, 2026");
  assert.equal(dayLabel("2026-09-20", LA, "long"), "September 20, 2026");
  // A plain date is a date, not midnight somewhere: it never shifts.
  assert.equal(dayLabel("2026-09-20", "Pacific/Auckland", "short"), "Sep 20, 2026");
  // A timestamp lands on the day it was in the company's zone.
  assert.equal(dayLabel("2026-09-21T02:30:00Z", LA, "short"), "Sep 20, 2026");
  assert.equal(dayLabel("2026-09-21T02:30:00Z", "UTC", "short"), "Sep 21, 2026");
  assert.equal(dayLabel("2026-09-21T02:30:00+00:00", LA, "long"), "September 20, 2026");
  assert.equal(dayLabel(null, LA, "short"), "—");
  assert.equal(dayLabel("", LA, "short"), "—");
  assert.equal(dayLabel("not a date", LA, "short"), "—");
});

test("a follow-up is due on the company's today, not the server's", () => {
  const due = { due_date: "2026-09-20", completed_at: null } as LeadTask;
  const done = { due_date: "2026-09-20", completed_at: "2026-09-20T18:00:00Z" } as LeadTask;
  assert.equal(hasFollowUpDue([due], "2026-09-20"), true);
  assert.equal(hasFollowUpDue([due], "2026-09-21"), true);
  assert.equal(hasFollowUpDue([due], "2026-09-19"), false);
  assert.equal(hasFollowUpDue([done], "2026-09-20"), false);
  assert.equal(hasFollowUpDue([], "2026-09-20"), false);
});

test("instantOfWallClock is the real moment the zone's clock read that time", () => {
  // 7:30 PM on Sep 20 in Los Angeles (naive, encoded as UTC) really
  // happened at 02:30 UTC on Sep 21.
  const naive = new Date("2026-09-20T19:30:00Z");
  assert.equal(instantOfWallClock(naive, LA).toISOString(), "2026-09-21T02:30:00.000Z");
  assert.equal(instantOfWallClock(naive, "UTC").toISOString(), "2026-09-20T19:30:00.000Z");
  // Round trip: the wall clock at that instant reads the naive time again.
  assert.equal(isoDateInZone(instantOfWallClock(naive, LA), LA), "2026-09-20");
});

test("a company's day starts and ends on its own midnight, DST included", () => {
  assert.equal(dayStartInZone("2026-09-20", LA).toISOString(), "2026-09-20T07:00:00.000Z");
  assert.equal(dayEndInZone("2026-09-20", LA).toISOString(), "2026-09-21T06:59:59.999Z");
  assert.equal(dayStartInZone("2026-09-20", NY).toISOString(), "2026-09-20T04:00:00.000Z");
  // Mar 8, 2026: midnight is still PST (-8), by 11:59 PM it is PDT (-7),
  // so the day is 23 hours long and both edges are on the right offset.
  assert.equal(dayStartInZone("2026-03-08", LA).toISOString(), "2026-03-08T08:00:00.000Z");
  assert.equal(dayEndInZone("2026-03-08", LA).toISOString(), "2026-03-09T06:59:59.999Z");
  // An event at 7:30 PM Pacific falls inside Sep 20's window, not Sep 21's.
  const evening = new Date("2026-09-21T02:30:00Z").getTime();
  assert.ok(evening >= dayStartInZone("2026-09-20", LA).getTime());
  assert.ok(evening <= dayEndInZone("2026-09-20", LA).getTime());
  assert.ok(evening < dayStartInZone("2026-09-21", LA).getTime());
});

test("a progress payment's default due date counts from the company's today", () => {
  assert.equal(defaultDueDate("2026-09-20"), "2026-09-27");
  assert.equal(defaultDueDate("2026-09-28"), "2026-10-05");
  assert.equal(defaultDueDate("2026-09-20", 30), "2026-10-20");
  assert.equal(defaultDueDate("2026-12-31", 1), "2027-01-01");
});

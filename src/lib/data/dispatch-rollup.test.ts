import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDispatchRollup,
  coerceDispatchRollup,
  dispatchBoundaries,
  emptyDispatchRollup,
  type DispatchInputs,
} from "./dispatch-rollup.ts";

// Monday, Sep 21 2026, 10:00 company time. Timestamps are UTC ISO.
const NOW = new Date("2026-09-21T10:00:00Z");
const B = dispatchBoundaries({ from: "2026-09-15", to: null }, NOW, NOW.getTime());

function inputs(over: Partial<DispatchInputs> = {}): DispatchInputs {
  return {
    boundaries: B,
    cohort: [],
    prevCohort: [],
    untouched: [],
    waiting: [],
    todayEvents: [],
    weekEvents: [],
    resultsMissing: 0,
    overdueTasks: 0,
    bookedInWindow: [],
    prevBookedCount: 0,
    datedInWindow: [],
    prevDated: [],
    callsInWindow: [],
    prevCalls: { dials: 0, connected: 0 },
    textsInWindow: 0,
    prevTexts: 0,
    ...over,
  };
}

test("boundaries: the week strip, the untouched/waiting/results floors and the previous window", () => {
  assert.equal(B.today, "2026-09-21");
  assert.equal(B.weekEnd, "2026-09-27");
  assert.equal(B.untouchedFrom, "2026-09-14");
  assert.equal(B.resultsFrom, "2026-09-07");
  assert.equal(B.waitingFrom, "2026-06-23");
  assert.equal(B.from, "2026-09-15");
  assert.equal(B.prevFrom, "2026-09-08");
  assert.equal(B.prevTo, "2026-09-14");
  // A window with no start is capped so the cohort never spans the book.
  const open = dispatchBoundaries({ from: null, to: "2026-09-21" }, NOW, NOW.getTime());
  assert.equal(open.from, "2026-06-23");
});

test("speed to lead: reached within the hour, and the median minutes to first touch", () => {
  const R = buildDispatchRollup(
    inputs({
      cohort: [
        { id: "a", created_at: "2026-09-16T09:00:00Z", dispatcher_id: "d1", first_touch_at: "2026-09-16T09:20:00Z" },
        { id: "b", created_at: "2026-09-16T09:00:00Z", dispatcher_id: "d1", first_touch_at: "2026-09-16T10:30:00Z" },
        { id: "c", created_at: "2026-09-17T09:00:00Z", dispatcher_id: null, first_touch_at: "2026-09-17T09:59:00Z" },
        { id: "d", created_at: "2026-09-18T09:00:00Z", dispatcher_id: "d2", first_touch_at: null },
      ],
    })
  );
  assert.equal(R.window.leads, 4);
  assert.equal(R.window.reached, 3);
  assert.equal(R.window.reachedWithinHour, 2);
  // Touched leads took 20, 90 and 59 minutes: the median is 59.
  assert.equal(R.window.medianMinutes, 59);
});

test("an untouched cohort has no median rather than a zero", () => {
  const R = buildDispatchRollup(
    inputs({ cohort: [{ id: "a", created_at: "2026-09-16T09:00:00Z", dispatcher_id: null, first_touch_at: null }] })
  );
  assert.equal(R.window.medianMinutes, null);
  assert.equal(R.window.reachedWithinHour, 0);
});

test("attention: untouched new leads carry the age of the oldest, in minutes from now", () => {
  const R = buildDispatchRollup(
    inputs({
      untouched: [
        { created_at: "2026-09-21T08:48:00Z" },
        { created_at: "2026-09-21T09:40:00Z" },
      ],
      overdueTasks: 9,
      resultsMissing: 3,
    })
  );
  assert.equal(R.attention.untouchedNew, 2);
  assert.equal(R.attention.untouchedOldestMinutes, 72);
  assert.equal(R.attention.overdueTasks, 9);
  assert.equal(R.attention.resultsMissing, 3);
});

test("attention: nothing untouched means no age at all", () => {
  const R = buildDispatchRollup(inputs());
  assert.equal(R.attention.untouchedNew, 0);
  assert.equal(R.attention.untouchedOldestMinutes, null);
});

test("today's board: cancelled visits are left out, the rest sorted by time, unconfirmed counted", () => {
  const R = buildDispatchRollup(
    inputs({
      todayEvents: [
        { id: "e2", time: "13:00", end_time: null, title: null, lead_id: "l2", lead_name: "Priya N.", assigned_to: null, status: "New", customer_confirmed: false, rep_confirmed: false },
        { id: "e1", time: "09:00", end_time: "10:00", title: "Kitchen", lead_id: "l1", lead_name: "Maria L.", assigned_to: "r1", status: "Confirmed", customer_confirmed: true, rep_confirmed: true },
        { id: "e3", time: "11:00", end_time: null, title: null, lead_id: null, lead_name: null, assigned_to: "r1", status: "Cancelled", customer_confirmed: false, rep_confirmed: false },
        { id: "e4", time: null, end_time: null, title: null, lead_id: "l4", lead_name: "Chen W.", assigned_to: "r2", status: "Showed", customer_confirmed: false, rep_confirmed: true },
      ],
    })
  );
  assert.deepEqual(R.today.map((e) => e.id), ["e1", "e2", "e4"]);
  assert.equal(R.attention.todayTotal, 3);
  // e2 is New and unconfirmed; e4 already happened (Showed) so it no
  // longer needs confirming.
  assert.equal(R.attention.todayUnconfirmed, 1);
});

test("the week strip is seven filled days from today, cancelled visits excluded", () => {
  const R = buildDispatchRollup(
    inputs({
      weekEvents: [
        { date: "2026-09-21", status: "New" },
        { date: "2026-09-22", status: "Confirmed" },
        { date: "2026-09-22", status: "Cancelled" },
        { date: "2026-09-22", status: "New" },
        { date: "2026-09-27", status: "New" },
        { date: "2026-09-28", status: "New" },
      ],
    })
  );
  assert.deepEqual(R.week, [
    { day: "2026-09-21", count: 1 },
    { day: "2026-09-22", count: 2 },
    { day: "2026-09-23", count: 0 },
    { day: "2026-09-24", count: 0 },
    { day: "2026-09-25", count: 0 },
    { day: "2026-09-26", count: 0 },
    { day: "2026-09-27", count: 1 },
  ]);
});

test("leads waiting for a first appointment bucket by days since received, and the unclaimed pool is counted", () => {
  const R = buildDispatchRollup(
    inputs({
      waiting: [
        { created_at: "2026-09-21T01:00:00Z", dispatcher_id: null },
        { created_at: "2026-09-20T23:00:00Z", dispatcher_id: "d1" },
        { created_at: "2026-09-18T12:00:00Z", dispatcher_id: "d1" },
        { created_at: "2026-09-17T12:00:00Z", dispatcher_id: null },
        { created_at: "2026-09-13T12:00:00Z", dispatcher_id: "d2" },
        { created_at: "2026-09-05T12:00:00Z", dispatcher_id: "d2" },
        { created_at: "2026-09-06T12:00:00Z", dispatcher_id: null },
      ],
    })
  );
  assert.deepEqual(R.waiting, { under1: 1, d1_3: 2, d4_7: 1, d8_14: 1, d15plus: 2 });
  assert.equal(R.attention.unclaimedPool, 3);
});

test("call outcomes: counted by disposition, the empty disposition left out, largest first", () => {
  const R = buildDispatchRollup(
    inputs({
      callsInWindow: [
        { rep_id: "d1", duration_seconds: 0, disposition: "No Answer" },
        { rep_id: "d1", duration_seconds: 0, disposition: "No Answer" },
        { rep_id: "d1", duration_seconds: 40, disposition: "Callback" },
        { rep_id: "d2", duration_seconds: 120, disposition: "Appointment Set" },
        { rep_id: "d2", duration_seconds: 5, disposition: "No Disposition" },
        { rep_id: null, duration_seconds: 0, disposition: null },
      ],
    })
  );
  assert.deepEqual(R.outcomes, [
    { disposition: "No Answer", count: 2 },
    { disposition: "Appointment Set", count: 1 },
    { disposition: "Callback", count: 1 },
  ]);
  assert.equal(R.window.dials, 6);
  assert.equal(R.window.connected, 3);
});

test("the desk: one row per dispatcher with leads, dials, bookings and shows, sorted by bookings", () => {
  const R = buildDispatchRollup(
    inputs({
      cohort: [
        { id: "a", created_at: "2026-09-16T09:00:00Z", dispatcher_id: "d1", first_touch_at: null },
        { id: "b", created_at: "2026-09-16T09:00:00Z", dispatcher_id: "d1", first_touch_at: null },
        { id: "c", created_at: "2026-09-16T09:00:00Z", dispatcher_id: "d2", first_touch_at: null },
      ],
      waiting: [
        { created_at: "2026-09-18T12:00:00Z", dispatcher_id: "d1" },
        { created_at: "2026-09-18T12:00:00Z", dispatcher_id: "d2" },
        { created_at: "2026-09-18T12:00:00Z", dispatcher_id: "d2" },
      ],
      callsInWindow: [
        { rep_id: "d1", duration_seconds: 30, disposition: "Callback" },
        { rep_id: "d2", duration_seconds: 0, disposition: "No Answer" },
      ],
      bookedInWindow: [
        { created_by: "d2" },
        { created_by: "d2" },
        { created_by: "d1" },
        { created_by: null },
      ],
      datedInWindow: [
        { created_by: "d2", status: "Showed" },
        { created_by: "d2", status: "No-show" },
        { created_by: "d1", status: "Won" },
        { created_by: "r9", status: "Cancelled" },
      ],
    })
  );
  assert.deepEqual(R.desk, [
    { dispatcher: "d2", leadsReceived: 1, leadsHeld: 2, dials: 1, connected: 0, booked: 2, showed: 1 },
    { dispatcher: "d1", leadsReceived: 2, leadsHeld: 1, dials: 1, connected: 1, booked: 1, showed: 1 },
  ]);
  assert.equal(R.window.booked, 4);
  assert.equal(R.window.showed, 2);
  // Resolved = a result was logged: Showed, Won, No-show or Cancelled.
  assert.equal(R.window.resolved, 4);
});

test("the previous period carries the same totals for the deltas", () => {
  const R = buildDispatchRollup(
    inputs({
      prevCohort: [
        { id: "p", created_at: "2026-09-09T09:00:00Z", dispatcher_id: null, first_touch_at: "2026-09-09T09:10:00Z" },
      ],
      prevBookedCount: 5,
      prevDated: [{ created_by: null, status: "Showed" }, { created_by: null, status: "No-show" }],
      prevCalls: { dials: 40, connected: 12 },
      prevTexts: 33,
    })
  );
  assert.equal(R.prev.leads, 1);
  assert.equal(R.prev.reachedWithinHour, 1);
  assert.equal(R.prev.medianMinutes, 10);
  assert.equal(R.prev.booked, 5);
  assert.equal(R.prev.showed, 1);
  assert.equal(R.prev.resolved, 2);
  assert.equal(R.prev.dials, 40);
  assert.equal(R.prev.connected, 12);
  assert.equal(R.prev.texts, 33);
});

test("coerce: stringly numbers off the wire become numbers, and a missing shape is empty", () => {
  const R = coerceDispatchRollup({
    attention: { untouchedNew: "3", untouchedOldestMinutes: "72", unclaimedPool: "1" },
    window: { leads: "10", medianMinutes: null },
    today: [{ id: "e1", time: "09:00", status: "New", customer_confirmed: "true" }],
    week: [{ day: "2026-09-21", count: "2" }],
    waiting: { under1: "4" },
    outcomes: [{ disposition: "No Answer", count: "7" }],
    desk: [{ dispatcher: "d1", booked: "2" }],
  });
  assert.equal(R.attention.untouchedNew, 3);
  assert.equal(R.attention.untouchedOldestMinutes, 72);
  assert.equal(R.attention.unclaimedPool, 1);
  assert.equal(R.window.leads, 10);
  assert.equal(R.window.medianMinutes, null);
  assert.equal(R.today[0].customer_confirmed, true);
  assert.equal(R.week[0].count, 2);
  assert.equal(R.waiting.under1, 4);
  assert.equal(R.outcomes[0].count, 7);
  assert.equal(R.desk[0].booked, 2);
  assert.deepEqual(emptyDispatchRollup().week, []);
  assert.equal(emptyDispatchRollup().attention.untouchedOldestMinutes, null);
});

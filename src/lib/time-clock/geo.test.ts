import { test } from "node:test";
import assert from "node:assert/strict";
import { clockStamp, distanceMeters, jobIsLiveToday, nearestZone, nextVisitStep, visitKey, type Zone } from "./geo.ts";

/**
 * A zone decides attendance, and attendance feeds hours, so the edges
 * are the ones that would mis-pay someone: the radius boundary, the
 * nearer of two overlapping jobs, and never flapping a visit open and
 * shut while someone stands still inside it.
 */

// ~111 m per 0.001 degree of latitude.
const JOB: Zone = { key: "event:1", label: "Roof inspection", eventId: "1", lat: 34.0, lng: -118.0 };
const OTHER: Zone = { key: "event:2", label: "Gutter repair", eventId: "2", lat: 34.0005, lng: -118.0 };

test("distance is in metres and symmetric", () => {
  const d = distanceMeters({ lat: 34.0, lng: -118.0 }, { lat: 34.001, lng: -118.0 });
  assert.ok(d > 105 && d < 117, `got ${d}`);
  assert.equal(
    Math.round(d),
    Math.round(distanceMeters({ lat: 34.001, lng: -118.0 }, { lat: 34.0, lng: -118.0 }))
  );
});

test("inside the radius finds the zone; just outside finds nothing", () => {
  assert.equal(nearestZone({ lat: 34.001, lng: -118.0 }, [JOB], 150)?.zone.key, "event:1");
  assert.equal(nearestZone({ lat: 34.002, lng: -118.0 }, [JOB], 150), null);
});

test("GPS accuracy widens the zone, capped so a wild fix can't claim a job", () => {
  // 222 m away: outside 150 m, inside with 100 m of accuracy slack.
  assert.equal(nearestZone({ lat: 34.002, lng: -118.0, accuracy: 100 }, [JOB], 150)?.zone.key, "event:1");
  // A 5 km "accuracy" is capped at 100 m of slack.
  assert.equal(nearestZone({ lat: 34.004, lng: -118.0, accuracy: 5000 }, [JOB], 150), null);
});

test("of two overlapping zones the nearer wins", () => {
  const hit = nearestZone({ lat: 34.0004, lng: -118.0 }, [JOB, OTHER], 150);
  assert.equal(hit?.zone.key, "event:2");
});

test("no zones, no match", () => {
  assert.equal(nearestZone({ lat: 34, lng: -118 }, [], 150), null);
});

test("arriving opens a visit; standing still keeps it; leaving closes it", () => {
  assert.deepEqual(nextVisitStep(null, JOB), { close: false, open: JOB });
  assert.deepEqual(nextVisitStep("event:1", JOB), { close: false, open: null });
  assert.deepEqual(nextVisitStep("event:1", null), { close: true, open: null });
  assert.deepEqual(nextVisitStep(null, null), { close: false, open: null });
});

test("walking straight from one zone into another closes one and opens the next", () => {
  assert.deepEqual(nextVisitStep("event:1", OTHER), { close: true, open: OTHER });
});

// ── Where a clock-in happened ─────────────────────────────────────────
// The verdict stamped on a punch. "Away" must name the nearest place and
// how far, because that's what the office reads on the timesheet.

test("no fix is 'no location', whatever is scheduled", () => {
  assert.deepEqual(clockStamp(null, [JOB], 150), { check: "no_location", place: null, distanceM: null });
});

test("nothing to check against is 'no places', not 'away'", () => {
  assert.deepEqual(clockStamp({ lat: 34, lng: -118 }, [], 150), { check: "no_places", place: null, distanceM: null });
});

test("inside a zone stamps the place it's in", () => {
  const s = clockStamp({ lat: 34.001, lng: -118.0 }, [JOB], 150);
  assert.equal(s.check, "at_place");
  assert.equal(s.place, "Roof inspection");
  assert.ok(s.distanceM !== null && s.distanceM > 100 && s.distanceM < 120, `got ${s.distanceM}`);
});

test("GPS slack counts toward being at the job, the same as arrivals", () => {
  assert.equal(clockStamp({ lat: 34.002, lng: -118.0, accuracy: 100 }, [JOB], 150).check, "at_place");
});

test("outside every zone names the nearest place and the distance to it", () => {
  // ~3.3 km north of both; OTHER is ~55 m nearer.
  const s = clockStamp({ lat: 34.03, lng: -118.0 }, [JOB, OTHER], 150);
  assert.equal(s.check, "away");
  assert.equal(s.place, "Gutter repair");
  assert.ok(s.distanceM !== null && s.distanceM > 3200 && s.distanceM < 3300, `got ${s.distanceM}`);
});

// ── Which production jobs are a place today ───────────────────────────
// A crew on day 3 of a tear-off has no appointment that day; the job
// itself has to be the zone, or they're flagged "away" on the roof.

const TODAY = "2026-10-01";

test("a job in progress is a place today, whatever its dates say", () => {
  assert.equal(jobIsLiveToday({ status: "In Progress", start_date: null, end_date: null }, TODAY), true);
  // Running past its end date: the crew is still there.
  assert.equal(jobIsLiveToday({ status: "In Progress", start_date: "2026-09-01", end_date: "2026-09-20" }, TODAY), true);
});

test("a job not marked started yet counts once its start date arrives", () => {
  assert.equal(jobIsLiveToday({ status: "Not Started", start_date: "2026-10-01", end_date: "2026-10-03" }, TODAY), true);
  assert.equal(jobIsLiveToday({ status: "Not Started", start_date: "2026-09-29", end_date: null }, TODAY), true);
  assert.equal(jobIsLiveToday({ status: "Not Started", start_date: "2026-10-02", end_date: "2026-10-03" }, TODAY), false);
  assert.equal(jobIsLiveToday({ status: "Not Started", start_date: "2026-09-20", end_date: "2026-09-30" }, TODAY), false);
  assert.equal(jobIsLiveToday({ status: "Not Started", start_date: null, end_date: null }, TODAY), false);
});

test("jobs on hold or complete are not a place", () => {
  assert.equal(jobIsLiveToday({ status: "On Hold", start_date: "2026-09-29", end_date: "2026-10-03" }, TODAY), false);
  assert.equal(jobIsLiveToday({ status: "Complete", start_date: "2026-09-29", end_date: "2026-10-03" }, TODAY), false);
});

test("an open visit's key matches the zone that opened it, job visits included", () => {
  assert.equal(visitKey({ event_id: "1" }), "event:1");
  assert.equal(visitKey({ event_id: null, job_id: "9" }), "job:9");
  // Office visits, and every visit written before 0185 added job_id.
  assert.equal(visitKey({ event_id: null, job_id: null }), "office");
  assert.equal(visitKey({ event_id: null }), "office");
  // Standing still at a job keeps its visit open rather than flapping.
  const job: Zone = { key: "job:9", label: "Smith re-roof", eventId: null, jobId: "9", lat: 34, lng: -118 };
  assert.deepEqual(nextVisitStep(visitKey({ event_id: null, job_id: "9" }), job), { close: false, open: null });
});

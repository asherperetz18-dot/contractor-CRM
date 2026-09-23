import { test } from "node:test";
import assert from "node:assert/strict";
import { distanceMeters, nearestZone, nextVisitStep, type Zone } from "./geo.ts";

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

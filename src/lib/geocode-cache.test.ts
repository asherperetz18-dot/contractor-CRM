import { test } from "node:test";
import assert from "node:assert/strict";
import { MISS_RECHECK_MS, cacheRowFor, fromCache, readCensusAnswer } from "./geocode-cache.ts";

/**
 * The shared address_geocode cache feeds the time clock's job zones. A
 * Census outage used to be stored as "address not found" forever, so a
 * job looked off the map for good and its crew read as off-site. The
 * edges: only what Census actually said is stored, a stored miss is
 * rechecked after a day (which also heals rows a past outage poisoned),
 * and a real hit is used as-is.
 */

const NOW = new Date("2026-10-01T16:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const MATCH = { result: { addressMatches: [{ coordinates: { x: -118.45, y: 34.18 } }] } };
const NO_MATCH = { result: { input: {}, addressMatches: [] } };

test("Census found the address", () => {
  assert.deepEqual(readCensusAnswer(true, MATCH), { status: "found", lat: 34.18, lng: -118.45 });
});

test("Census answered and found nothing: a real miss", () => {
  assert.deepEqual(readCensusAnswer(true, NO_MATCH), { status: "not_found" });
});

test("anything else is an error, never a miss", () => {
  // Down, overloaded, or refused the request.
  assert.deepEqual(readCensusAnswer(false, null), { status: "error" });
  assert.deepEqual(readCensusAnswer(false, NO_MATCH), { status: "error" });
  // Answered, but not with JSON we recognise.
  assert.deepEqual(readCensusAnswer(true, null), { status: "error" });
  assert.deepEqual(readCensusAnswer(true, { errors: ["Internal error"] }), { status: "error" });
  assert.deepEqual(readCensusAnswer(true, { result: { addressMatches: [{ coordinates: { x: "a", y: 1 } }] } }), {
    status: "error",
  });
});

test("an error is never stored; hits and misses are, stamped now", () => {
  assert.equal(cacheRowFor({ status: "error" }, NOW), null);
  assert.deepEqual(cacheRowFor({ status: "found", lat: 34.18, lng: -118.45 }, NOW), {
    lat: 34.18,
    lng: -118.45,
    resolved_at: NOW.toISOString(),
  });
  assert.deepEqual(cacheRowFor({ status: "not_found" }, NOW), {
    lat: null,
    lng: null,
    resolved_at: NOW.toISOString(),
  });
});

test("a stored hit is used as-is, however old (a street address doesn't move)", () => {
  assert.deepEqual(fromCache({ lat: "34.18", lng: "-118.45", resolved_at: ago(400 * 86_400_000) }, NOW), {
    lat: 34.18,
    lng: -118.45,
  });
});

test("nothing stored: ask Census", () => {
  assert.equal(fromCache(null, NOW), "ask");
});

test("a fresh miss is trusted, so a bad address isn't looked up on every location update", () => {
  assert.equal(fromCache({ lat: null, lng: null, resolved_at: ago(MISS_RECHECK_MS - 60_000) }, NOW), null);
});

test("a miss older than a day is asked again, which heals rows a past outage poisoned", () => {
  assert.equal(fromCache({ lat: null, lng: null, resolved_at: ago(MISS_RECHECK_MS + 60_000) }, NOW), "ask");
  assert.equal(fromCache({ lat: null, lng: null, resolved_at: null }, NOW), "ask");
});

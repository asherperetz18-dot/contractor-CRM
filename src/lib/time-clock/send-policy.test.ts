import { test } from "node:test";
import assert from "node:assert/strict";
import { fixDue } from "./send-policy.ts";

/**
 * The phone app hears a fix every second or so; the server wants one
 * every couple of minutes standing still (so "no signal" means no
 * signal) and promptly after a move (so arrivals land on time), never
 * a flood.
 */

const HOME = { lat: 34.0, lng: -118.0 };
const T0 = 1_000_000;

test("the first fix always goes", () => {
  assert.equal(fixDue(null, HOME, T0), true);
});

test("standing still sends every two minutes, not before", () => {
  const prev = { at: T0, ...HOME };
  assert.equal(fixDue(prev, HOME, T0 + 119_000), false);
  assert.equal(fixDue(prev, HOME, T0 + 120_000), true);
});

test("a 150 m move sends early, but not within 20 seconds", () => {
  const prev = { at: T0, ...HOME };
  const moved = { lat: 34.0015, lng: -118.0 };
  assert.equal(fixDue(prev, moved, T0 + 10_000), false);
  assert.equal(fixDue(prev, moved, T0 + 20_000), true);
});

test("a small drift doesn't count as a move", () => {
  const prev = { at: T0, ...HOME };
  assert.equal(fixDue(prev, { lat: 34.0005, lng: -118.0 }, T0 + 60_000), false);
});

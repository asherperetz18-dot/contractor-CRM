import { test } from "node:test";
import assert from "node:assert/strict";
import { SKIP_SECONDS, clampSeek, formatClock, nextSpeed } from "./recording-controls.ts";

/**
 * The arithmetic behind the recording player's buttons: where a skip
 * lands, what the clock reads, which speed comes next.
 */

test("a skip is ten seconds -- long enough to pass a hold, short enough not to lose the thread", () => {
  assert.equal(SKIP_SECONDS, 10);
});

test("a seek never lands before the start or past the end", () => {
  assert.equal(clampSeek(-3, 90), 0);
  assert.equal(clampSeek(95, 90), 90);
  assert.equal(clampSeek(42, 90), 42);
});

test("with the length still unknown, forward is allowed and only the floor is clamped", () => {
  // Before the file's metadata arrives (preload=none) the duration is
  // 0/NaN; ⏩ on an unplayed recording must still land at ten seconds.
  assert.equal(clampSeek(10, 0), 10);
  assert.equal(clampSeek(10, NaN), 10);
  assert.equal(clampSeek(-1, NaN), 0);
  assert.equal(clampSeek(NaN, 90), 0);
});

test("the clock reads m:ss, whole seconds, and never NaN or Infinity", () => {
  assert.equal(formatClock(0), "0:00");
  assert.equal(formatClock(65.7), "1:05");
  assert.equal(formatClock(3599), "59:59");
  assert.equal(formatClock(3600), "60:00");
  assert.equal(formatClock(NaN), "0:00");
  assert.equal(formatClock(Infinity), "0:00");
  assert.equal(formatClock(-4), "0:00");
});

test("speed cycles 1 → 1.25 → 1.5 → 2 → 1, and an unknown value restarts at 1", () => {
  assert.equal(nextSpeed(1), 1.25);
  assert.equal(nextSpeed(1.25), 1.5);
  assert.equal(nextSpeed(1.5), 2);
  assert.equal(nextSpeed(2), 1);
  assert.equal(nextSpeed(0.75), 1);
});

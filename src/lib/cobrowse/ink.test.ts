import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_POINTS,
  MAX_STROKES,
  POINTER_TTL_MS,
  STROKE_FADE_END_MS,
  STROKE_FADE_START_MS,
  emptyInk,
  inkReduce,
  pruneInk,
  strokeAlpha,
  type InkSignal,
} from "./ink.ts";

/**
 * Ink is the viewer writing on the sharer's screen: strokes and a
 * laser pointer, sent as signals over the cobrowse channel and folded
 * into a small state both sides render from. The state is where the
 * rules live -- growth caps, coordinate clamping, fade-out -- so the
 * rules are what's tested. Signals arrive from another client, so
 * anything malformed must be shrugged off, never thrown.
 */

const stroke = (id: string, ...points: [number, number][]): InkSignal => ({
  kind: "stroke",
  id,
  points: points.map(([x, y]) => ({ x, y })),
});

test("a stroke streams in growing updates under one id, and its clock restarts each touch", () => {
  let s = inkReduce(emptyInk(), stroke("a", [0.1, 0.1]), 1000);
  s = inkReduce(s, stroke("a", [0.1, 0.1], [0.2, 0.2], [0.3, 0.3]), 1500);
  assert.equal(s.strokes.length, 1);
  assert.equal(s.strokes[0].points.length, 3);
  // refreshed: a stroke still being drawn shouldn't fade mid-gesture
  assert.equal(s.strokes[0].at, 1500);

  s = inkReduce(s, stroke("b", [0.5, 0.5]), 1600);
  assert.equal(s.strokes.length, 2);
});

test("clear wipes everything at once", () => {
  let s = inkReduce(emptyInk(), stroke("a", [0.1, 0.1]), 1000);
  s = inkReduce(s, { kind: "pointer", x: 0.4, y: 0.4 }, 1000);
  s = inkReduce(s, { kind: "clear" }, 1001);
  assert.deepEqual(s, emptyInk());
});

test("the pointer follows, and hides on request or when stale", () => {
  let s = inkReduce(emptyInk(), { kind: "pointer", x: 0.4, y: 0.6 }, 1000);
  assert.deepEqual(s.pointer, { x: 0.4, y: 0.6, at: 1000 });
  s = inkReduce(s, { kind: "pointer-hide" }, 1001);
  assert.equal(s.pointer, null);

  s = inkReduce(emptyInk(), { kind: "pointer", x: 0.4, y: 0.6 }, 1000);
  assert.equal(pruneInk(s, 1000 + POINTER_TTL_MS - 1).pointer !== null, true);
  assert.equal(pruneInk(s, 1000 + POINTER_TTL_MS).pointer, null);
});

test("garbage from the channel never throws and never lands", () => {
  const s0 = emptyInk();
  const junk = [
    null,
    42,
    "clear",
    { kind: "explode" },
    { kind: "stroke", id: 7, points: [{ x: 0.1, y: 0.1 }] },
    { kind: "stroke", id: "x", points: "not-an-array" },
    { kind: "stroke", id: "x", points: [{ x: NaN, y: 0.1 }] },
    { kind: "pointer", x: Infinity, y: 0.2 },
  ] as unknown as InkSignal[];
  for (const sig of junk) {
    assert.deepEqual(inkReduce(s0, sig, 1000), s0);
  }
});

test("coordinates land clamped to the unit square", () => {
  const s = inkReduce(
    emptyInk(),
    stroke("a", [1.5, -0.2], [0.5, 0.5]),
    1000
  );
  assert.deepEqual(s.strokes[0].points[0], { x: 1, y: 0 });
  const p = inkReduce(emptyInk(), { kind: "pointer", x: -3, y: 2 }, 1000);
  assert.deepEqual(p.pointer, { x: 0, y: 1, at: 1000 });
});

test("growth is capped: points per stroke truncate, oldest strokes evict", () => {
  const many = Array.from({ length: MAX_POINTS + 50 }, (_, i) => ({ x: 0.5, y: 0.5 + i * 1e-6 }));
  const s = inkReduce(emptyInk(), { kind: "stroke", id: "big", points: many }, 1000);
  assert.equal(s.strokes[0].points.length, MAX_POINTS);

  let flood = emptyInk();
  for (let i = 0; i < MAX_STROKES + 20; i++) {
    flood = inkReduce(flood, stroke(`s${i}`, [0.1, 0.1]), 1000 + i);
  }
  assert.equal(flood.strokes.length, MAX_STROKES);
  // the earliest ones are gone; the latest survive
  assert.equal(flood.strokes.some((st) => st.id === "s0"), false);
  assert.equal(flood.strokes.some((st) => st.id === `s${MAX_STROKES + 19}`), true);
});

test("strokes hold, then fade, then are pruned", () => {
  assert.equal(strokeAlpha(0), 1);
  assert.equal(strokeAlpha(STROKE_FADE_START_MS), 1);
  const mid = strokeAlpha((STROKE_FADE_START_MS + STROKE_FADE_END_MS) / 2);
  assert.ok(mid > 0 && mid < 1);
  assert.equal(strokeAlpha(STROKE_FADE_END_MS), 0);

  let s = inkReduce(emptyInk(), stroke("a", [0.1, 0.1]), 1000);
  s = inkReduce(s, stroke("b", [0.2, 0.2]), 5000);
  const pruned = pruneInk(s, 1000 + STROKE_FADE_END_MS);
  assert.deepEqual(pruned.strokes.map((st) => st.id), ["b"]);
});

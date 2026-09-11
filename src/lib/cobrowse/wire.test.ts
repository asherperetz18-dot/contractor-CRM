import { test } from "node:test";
import assert from "node:assert/strict";
import { CHUNK_CHARS, packEvents, Reassembler, type CobrowsePart } from "./wire.ts";

/**
 * The wire is the whole trick of cobrowse: rrweb event batches must
 * cross Supabase Realtime, which caps a broadcast payload, so a batch
 * is JSON-chunked into numbered parts and rebuilt on the far side. A
 * frame that arrives twice, half, or garbled must never crash the
 * viewer -- it just isn't a picture yet.
 */

const batch = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ type: 3, timestamp: 1000 + i, data: { source: 2, x: i } }));

test("a small batch travels as one part and comes back identical", () => {
  const events = batch(3);
  const parts = packEvents(events, 7);
  assert.equal(parts.length, 1);
  assert.deepEqual(parts[0], { seq: 7, part: 0, parts: 1, data: JSON.stringify(events) });

  const rx = new Reassembler();
  assert.deepEqual(rx.push(parts[0]), events);
});

test("a big batch splits at the chunk size and rebuilds only when complete", () => {
  const events = batch(4);
  // A tiny chunk size forces many parts without megabytes of fixture.
  const parts = packEvents(events, 1, 8);
  assert.ok(parts.length > 1);
  for (const p of parts) {
    assert.ok(p.data.length <= 8);
    assert.equal(p.parts, parts.length);
  }
  // Joined back together, the parts are exactly the original JSON.
  assert.equal(parts.map((p) => p.data).join(""), JSON.stringify(events));

  const rx = new Reassembler();
  for (const p of parts.slice(0, -1)) assert.equal(rx.push(p), null);
  assert.deepEqual(rx.push(parts[parts.length - 1]), events);
});

test("parts may arrive out of order and duplicated; the batch still lands once", () => {
  const events = batch(5);
  const parts = packEvents(events, 2, 10);
  assert.ok(parts.length >= 3);
  const shuffled = [parts[1], parts[1], ...parts.slice(2), parts[0]];
  const rx = new Reassembler();
  const results = shuffled.map((p) => rx.push(p)).filter((r) => r !== null);
  assert.equal(results.length, 1);
  assert.deepEqual(results[0], events);
});

test("two interleaved batches complete independently", () => {
  const a = batch(2);
  const b = batch(6);
  const pa = packEvents(a, 1, 12);
  const pb = packEvents(b, 2, 12);
  const rx = new Reassembler();
  const out: unknown[][] = [];
  // strict alternation, a's parts and b's parts woven together
  const weave: CobrowsePart[] = [];
  const max = Math.max(pa.length, pb.length);
  for (let i = 0; i < max; i++) {
    if (pa[i]) weave.push(pa[i]);
    if (pb[i]) weave.push(pb[i]);
  }
  for (const p of weave) {
    const r = rx.push(p);
    if (r) out.push(r);
  }
  assert.deepEqual(out, pa.length <= pb.length ? [a, b] : [b, a]);
});

test("garbage on the channel never throws and never delivers", () => {
  const rx = new Reassembler();
  // valid JSON but not an array of events
  assert.equal(rx.push({ seq: 1, part: 0, parts: 1, data: '"hi"' }), null);
  // not JSON at all
  assert.equal(rx.push({ seq: 2, part: 0, parts: 1, data: "{oops" }), null);
  // nonsense part numbering
  assert.equal(rx.push({ seq: 3, part: 5, parts: 2, data: "[]" }), null);
  assert.equal(rx.push({ seq: 4, part: -1, parts: 1, data: "[]" }), null);
  // a well-formed batch afterwards still works
  const events = batch(2);
  assert.deepEqual(rx.push(packEvents(events, 5)[0]), events);
});

test("abandoned half-batches are evicted, so a hostile or lossy stream can't grow memory", () => {
  const rx = new Reassembler();
  // 100 batches that never finish (only part 0 of 2 arrives)
  for (let seq = 0; seq < 100; seq++) {
    assert.equal(rx.push({ seq, part: 0, parts: 2, data: "[" }), null);
  }
  assert.ok(rx.pendingCount <= 32, `pending grew to ${rx.pendingCount}`);
  // the earliest one was evicted: its late second half no longer completes
  assert.equal(rx.push({ seq: 0, part: 1, parts: 2, data: "]" }), null);
  // but a fresh, complete batch is unaffected
  const events = batch(1);
  assert.deepEqual(rx.push(packEvents(events, 200)[0]), events);
});

test("the default chunk size stays under Realtime's payload comfort zone", () => {
  assert.ok(CHUNK_CHARS <= 60_000);
  const big = [{ type: 2, timestamp: 1, data: { html: "x".repeat(CHUNK_CHARS * 2 + 5) } }];
  for (const p of packEvents(big, 1)) assert.ok(p.data.length <= CHUNK_CHARS);
});

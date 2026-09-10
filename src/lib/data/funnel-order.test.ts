import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeSavedOrder, moveBefore } from "./funnel-order.ts";

/**
 * The funnel cards keep whatever order the person dragged them into, per
 * browser. The saved order has to survive the product changing under it:
 * a card added in a later release must still show up, and a card that no
 * longer exists must not leave a hole.
 */

const DEFAULTS = ["drafts", "sent", "signed", "declined", "void", "changes", "co_pending"];

test("no saved order means the default order", () => {
  assert.deepEqual(mergeSavedOrder(DEFAULTS, []), DEFAULTS);
});

test("a full saved permutation is used as saved", () => {
  const saved = ["co_pending", "signed", "drafts", "sent", "declined", "void", "changes"];
  assert.deepEqual(mergeSavedOrder(DEFAULTS, saved), saved);
});

test("a card added after the order was saved appears at its default position", () => {
  // Saved before co_pending existed, with Contracts dragged to the front.
  const saved = ["signed", "drafts", "sent", "declined", "void", "changes"];
  const merged = mergeSavedOrder(DEFAULTS, saved);
  assert.equal(merged.length, DEFAULTS.length);
  assert.ok(merged.includes("co_pending"));
  // The saved preference is untouched: everything else keeps its dragged order.
  assert.deepEqual(merged.filter((k) => k !== "co_pending"), saved);
});

test("a card that no longer exists is dropped without a trace", () => {
  const saved = ["retired", "signed", "drafts", "sent", "declined", "void", "changes", "co_pending"];
  assert.deepEqual(
    mergeSavedOrder(DEFAULTS, saved),
    ["signed", "drafts", "sent", "declined", "void", "changes", "co_pending"]
  );
});

test("dropping a card on another puts it in that card's place", () => {
  // Dragged backward: co_pending onto sent lands where sent was.
  assert.deepEqual(moveBefore(["a", "b", "c", "d"], "d", "b"), ["a", "d", "b", "c"]);
  // Dragged forward: a onto c.
  assert.deepEqual(moveBefore(["a", "b", "c", "d"], "a", "c"), ["b", "c", "a", "d"]);
});

test("a drop that moves nothing changes nothing", () => {
  assert.deepEqual(moveBefore(["a", "b", "c"], "b", "b"), ["a", "b", "c"]);
  // Unknown keys (stale drag state) leave the order alone.
  assert.deepEqual(moveBefore(["a", "b", "c"], "x", "b"), ["a", "b", "c"]);
  assert.deepEqual(moveBefore(["a", "b", "c"], "a", "x"), ["a", "b", "c"]);
});

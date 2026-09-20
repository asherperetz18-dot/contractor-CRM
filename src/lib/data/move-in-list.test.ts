import { test } from "node:test";
import assert from "node:assert/strict";
import { moveInList } from "./move-in-list.ts";

/**
 * The ▲/▼ buttons on the settings tables (project types, lead sources,
 * pipeline stages, call dispositions, calendars). Drag-and-drop was the
 * only way to reorder, and a finger on Android or an older iPhone fires
 * no drag events at all -- so a button that swaps two neighbours is what
 * makes the order editable from a phone. The edges matter: pressing ▲ on
 * the first row must do nothing, not wrap or drop the row.
 */

test("moves a row up by swapping it with the one above", () => {
  assert.deepEqual(moveInList(["a", "b", "c"], 2, -1), ["a", "c", "b"]);
});

test("moves a row down by swapping it with the one below", () => {
  assert.deepEqual(moveInList(["a", "b", "c"], 0, 1), ["b", "a", "c"]);
});

test("refuses to move past either edge", () => {
  assert.equal(moveInList(["a", "b"], 0, -1), null);
  assert.equal(moveInList(["a", "b"], 1, 1), null);
  assert.equal(moveInList(["only"], 0, 1), null);
});

test("never mutates the list it was given", () => {
  const ids = ["a", "b", "c"];
  moveInList(ids, 1, 1);
  assert.deepEqual(ids, ["a", "b", "c"]);
});

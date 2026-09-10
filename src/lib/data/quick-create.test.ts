import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldAutoOpenNewEstimate } from "./quick-create.ts";

/**
 * Quick Create -> New Estimate lands on /estimates?new=1 and the page
 * opens the create dialog by itself. The rule worth pinning: the param
 * opens it, but never for someone who can't create estimates -- the
 * dialog would let them fill everything in and fail only on save.
 */

test("?new=1 opens the create dialog for someone who can create", () => {
  assert.equal(shouldAutoOpenNewEstimate("1", true), true);
});

test("without the param the page opens normally", () => {
  assert.equal(shouldAutoOpenNewEstimate(null, true), false);
  assert.equal(shouldAutoOpenNewEstimate("", true), false);
});

test("no create permission means no dialog, param or not", () => {
  assert.equal(shouldAutoOpenNewEstimate("1", false), false);
  assert.equal(shouldAutoOpenNewEstimate(null, false), false);
});

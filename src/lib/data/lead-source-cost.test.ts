import { test } from "node:test";
import assert from "node:assert/strict";
import { leadCostInputValue, parseLeadCostInput } from "./lead-source-cost.ts";

/**
 * The "Lead cost" box on a lead source. The distinction that matters is
 * blank versus 0: blank means "this source has no figure of its own, use
 * the company default", 0 means "leads from here are free". Getting
 * those two crossed either charges $375 for every referral or prices a
 * bought lead at nothing, and both end up in Marketing Analytics as
 * spend that never happened -- or spend that did and was never seen.
 */

test("blank means no figure of its own, stored as null", () => {
  assert.deepEqual(parseLeadCostInput(""), { value: null });
  assert.deepEqual(parseLeadCostInput("   "), { value: null });
});

test("a typed 0 is a real answer -- this source is free", () => {
  assert.deepEqual(parseLeadCostInput("0"), { value: 0 });
});

test("reads dollars the way people type them", () => {
  assert.deepEqual(parseLeadCostInput("375"), { value: 375 });
  assert.deepEqual(parseLeadCostInput("$1,250.50"), { value: 1250.5 });
  assert.deepEqual(parseLeadCostInput(" 42.999 "), { value: 43 });
});

test("refuses what is not a price", () => {
  assert.ok("error" in parseLeadCostInput("abc"));
  assert.ok("error" in parseLeadCostInput("-5"));
  assert.ok("error" in parseLeadCostInput("1e999"));
});

test("shows a stored cost back as text, and null as an empty box", () => {
  assert.equal(leadCostInputValue(null), "");
  assert.equal(leadCostInputValue(undefined), "");
  assert.equal(leadCostInputValue(0), "0");
  assert.equal(leadCostInputValue(375), "375");
});

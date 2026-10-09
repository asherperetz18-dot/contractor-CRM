import { test } from "node:test";
import assert from "node:assert/strict";
import { dueFromOffset } from "./checklist-due.ts";

/**
 * A template step "3 days after signing" is due three of the company's
 * days after the day the contract was signed there. The server's UTC
 * calendar put an evening signature on the next day, so every step came
 * out a day late.
 */

const LA = "America/Los_Angeles";

test("an evening signature counts from the day it was signed on the company's calendar", () => {
  // Oct 8 at 6pm in Los Angeles -- already Oct 9 in UTC.
  assert.equal(dueFromOffset("2026-10-09T01:00:00Z", 3, LA), "2026-10-11");
  assert.equal(dueFromOffset("2026-10-09T01:00:00Z", 0, LA), "2026-10-08");
});

test("a paper signature, stored at noon UTC on its date, stays on its date", () => {
  assert.equal(dueFromOffset("2026-10-08T12:00:00.000Z", 2, LA), "2026-10-10");
});

test("offsets run across month and year ends", () => {
  assert.equal(dueFromOffset("2026-10-31T18:00:00Z", 1, LA), "2026-11-01");
  assert.equal(dueFromOffset("2026-12-31T20:00:00Z", 7, LA), "2027-01-07");
});

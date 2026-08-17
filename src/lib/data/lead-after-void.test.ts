import { test } from "node:test";
import assert from "node:assert/strict";
import { leadAfterContractVoid } from "./types.ts";

/**
 * What voiding a signed contract does to the lead. This decides whether
 * a rep's Won column tells the truth, so the edges are tested: the
 * failure it exists to stop is a cancelled test contract leaving a lead
 * on the board as Won $45,000 forever.
 */

test("nothing signed left means the lead is not won", () => {
  assert.deepEqual(leadAfterContractVoid([]), { demote: true, valueDollars: null });
});

test("another signed contract keeps the lead won at that money", () => {
  assert.deepEqual(
    leadAfterContractVoid([{ total_cents: 1000, signed_at: "2026-08-09T01:41:35Z" }]),
    { demote: false, valueDollars: 10 }
  );
});

test("with several remaining, the most recently signed sets the value", () => {
  // Matches what signing does: each signature overwrites the lead's
  // value with its own total, so the newest one is the standing figure.
  assert.deepEqual(
    leadAfterContractVoid([
      { total_cents: 500000, signed_at: "2026-08-01T00:00:00Z" },
      { total_cents: 120000, signed_at: "2026-08-10T00:00:00Z" },
    ]),
    { demote: false, valueDollars: 1200 }
  );
});

test("a remaining contract with no signed_at still counts, valued last", () => {
  assert.deepEqual(
    leadAfterContractVoid([
      { total_cents: 700, signed_at: null },
      { total_cents: 90000, signed_at: "2026-08-10T00:00:00Z" },
    ]),
    { demote: false, valueDollars: 900 }
  );
});

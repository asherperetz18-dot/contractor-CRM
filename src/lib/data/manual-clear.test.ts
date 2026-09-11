import { test } from "node:test";
import assert from "node:assert/strict";
import { manualClearUpdate } from "./manual-clear.ts";

// A cheque or transfer recorded before it landed sits as "pending". The
// only way to settle it used to be recording the payment a second time,
// which left both rows in the history -- the money showing twice.

test("a pending manual payment clears to succeeded with a paid date", () => {
  const res = manualClearUpdate({ source: "manual", status: "pending" }, "2026-08-10");
  assert.equal("error" in res, false);
  if ("update" in res) {
    assert.equal(res.update.status, "succeeded");
    assert.equal(res.update.paid_at, new Date("2026-08-10T12:00:00").toISOString());
  }
});

test("no date given means it cleared now", () => {
  const before = Date.now();
  const res = manualClearUpdate({ source: "manual", status: "pending" });
  const after = Date.now();
  assert.ok("update" in res);
  if ("update" in res) {
    const t = new Date(res.update.paid_at).getTime();
    assert.ok(t >= before && t <= after);
  }
});

test("a payment already succeeded cannot be cleared again", () => {
  const res = manualClearUpdate({ source: "manual", status: "succeeded" });
  assert.ok("error" in res);
});

test("Stripe rows settle by webhook, never by hand", () => {
  const res = manualClearUpdate({ source: "stripe", status: "pending" });
  assert.ok("error" in res);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { isPendingChangeOrder } from "./pending-change-orders.ts";

/**
 * The Change Orders funnel card counts extras nobody has agreed to yet.
 * Pending means unsigned and still alive: once signed it is money in
 * Attached, and once declined, expired or voided there is nothing left
 * to chase -- neither belongs on a card someone works through.
 */

const co = (over: Partial<Parameters<typeof isPendingChangeOrder>[0]> = {}) => ({
  kind: "change_order",
  status: "Sent" as const,
  expires_at: null,
  ...over,
});

test("a draft, sent or viewed change order is pending", () => {
  assert.equal(isPendingChangeOrder(co({ status: "Draft" })), true);
  assert.equal(isPendingChangeOrder(co({ status: "Sent" })), true);
  assert.equal(isPendingChangeOrder(co({ status: "Viewed" })), true);
});

test("a settled change order is not pending, whichever way it settled", () => {
  assert.equal(isPendingChangeOrder(co({ status: "Signed" })), false);
  assert.equal(isPendingChangeOrder(co({ status: "Declined" })), false);
  assert.equal(isPendingChangeOrder(co({ status: "Expired" })), false);
  assert.equal(isPendingChangeOrder(co({ status: "Void" })), false);
});

test("a lapsed expiry counts as settled even while the row still says Sent", () => {
  // Same rule the funnel's other cards apply via estimateExpired: nothing
  // sweeps statuses on a timer, so the date has to be believed over the
  // stored status.
  assert.equal(isPendingChangeOrder(co({ expires_at: "2000-01-01" })), false);
});

test("only change orders qualify -- not contracts, not completions", () => {
  assert.equal(isPendingChangeOrder(co({ kind: "contract" })), false);
  assert.equal(isPendingChangeOrder(co({ kind: "completion" })), false);
});

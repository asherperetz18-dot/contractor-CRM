import { test } from "node:test";
import assert from "node:assert/strict";
import {
  markRinging,
  newCallAttempt,
  settleAttempt,
  shouldRetryError,
} from "./call-attempt.ts";

/**
 * One dial attempt must end exactly once. Twilio's Voice SDK fires more
 * than one terminal event for a single call -- hanging up while ringing
 * fires cancel AND disconnect; a gateway error at hang-up fires
 * disconnect AND error -- and each handler was logging a call_logs row,
 * so every attempt showed twice in Call Reports. Worse, the silent
 * "stale gateway" retry fired on a late 31005 too, re-dialing a number
 * whose phone had already rung: the dialer called people twice. These
 * tests pin the latch and the only case a retry is allowed.
 */

test("an attempt settles exactly once, whatever order the end events arrive", () => {
  const attempt = newCallAttempt();
  assert.equal(settleAttempt(attempt), true); // cancel fires: log it
  assert.equal(settleAttempt(attempt), false); // disconnect follows: no second row
  assert.equal(settleAttempt(attempt), false); // a late error: still no row
});

test("the gateway retry fires only for a call that never rang", () => {
  const fresh = newCallAttempt();
  assert.equal(shouldRetryError(fresh, 31005, false), true);
  assert.equal(shouldRetryError(fresh, 20104, false), true);

  // The customer's phone rang: dialing them again is a second call,
  // not a reconnect. Never.
  const rang = newCallAttempt();
  markRinging(rang);
  assert.equal(shouldRetryError(rang, 31005, false), false);
});

test("no retry after the attempt already ended, whatever the error code", () => {
  const done = newCallAttempt();
  settleAttempt(done);
  assert.equal(shouldRetryError(done, 31005, false), false);
});

test("one retry per attempt, and only for the two gateway codes", () => {
  const attempt = newCallAttempt();
  assert.equal(shouldRetryError(attempt, 31005, true), false); // already retried
  assert.equal(shouldRetryError(attempt, 31000, false), false); // other errors are honest failures
  assert.equal(shouldRetryError(attempt, undefined, false), false);
});

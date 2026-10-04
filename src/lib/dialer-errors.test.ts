import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { callFailureMessage, shouldRebuildDevice } from "./dialer-errors.ts";

/**
 * When Twilio refuses the dialer's calling pass, the Voice SDK closes its
 * connection and rejects the call with nothing at all -- the reason only
 * arrives as a separate "error" event on the Device, which the dialer
 * never listened to. So every such failure read "Could not place the
 * call.", and the dead connection was reused until the page was reloaded
 * (DECISIONS #106).
 */

const twilioError = (code: number, message = `Twilio error ${code}`) =>
  Object.assign(new Error(message), { code });

test("a refused calling setup says so, and where an admin fixes it", () => {
  // 31100 is what Twilio answered for Ca Pro Builder's calling setup, saved
  // before Settings → Twilio checked anything with Twilio.
  for (const code of [20101, 20103, 20107, 31100, 31201, 31202, 31204]) {
    const msg = callFailureMessage(undefined, { code });
    assert.match(msg, /calling setup/, String(code));
    assert.match(msg, /same Twilio account/, String(code));
    assert.match(msg, /Settings → Twilio/, String(code));
    assert.match(msg, new RegExp(String(code)));
  }
});

test("an expired calling pass just asks for another try", () => {
  assert.match(callFailureMessage(undefined, { code: 20104 }), /try again/i);
  assert.match(callFailureMessage(undefined, { code: 31205 }), /try again/i);
});

test("any other Twilio reason is shown with its code", () => {
  assert.match(callFailureMessage(undefined, { code: 31000, message: "Generic error" }), /31000.*Generic error|Generic error.*31000/);
});

test("the connection closing with no reason still says what happened", () => {
  const msg = callFailureMessage(undefined, null);
  assert.notEqual(msg, "Could not place the call.");
  assert.match(msg, /Twilio closed the connection/);
});

test("an ordinary error keeps its own message", () => {
  assert.equal(callFailureMessage(new Error("Calling isn't configured for this company yet."), null), "Calling isn't configured for this company yet.");
  // A Twilio error thrown straight from connect() is explained by its code.
  assert.match(callFailureMessage(twilioError(20101), null), /calling setup/);
});

test("the connection is rebuilt after a refusal, never in the middle of a live call", () => {
  assert.equal(shouldRebuildDevice(undefined, null), true); // closed with no reason
  assert.equal(shouldRebuildDevice(undefined, { code: 20101 }), true);
  assert.equal(shouldRebuildDevice(undefined, { code: 31100 }), true);
  assert.equal(shouldRebuildDevice(twilioError(31204), null), true);
  assert.equal(shouldRebuildDevice(twilioError(20104), null), true);
  // "A Call is already active" -- tearing the device down would hang it up.
  assert.equal(shouldRebuildDevice(new Error("A Call is already active"), null), false);
});

test("the dialer listens for Twilio's reason and starts over after a refusal", () => {
  const src = readFileSync(new URL("../app/(app)/voice-dialer.tsx", import.meta.url), "utf8");
  assert.match(src, /device\.on\("error"/, "the Device's error event carries the reason");
  assert.match(src, /callFailureMessage\(/);
  assert.match(src, /shouldRebuildDevice\(/);
  assert.ok(!src.includes('"Could not place the call."'), "the reasonless message is gone");
});

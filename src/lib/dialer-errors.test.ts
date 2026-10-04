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

/**
 * A blocked microphone used to show Twilio's own sentence --
 * "PermissionDeniedError (31401): The browser or end-user denied
 * permissions to user media..." -- which tells a rep nothing about what to
 * tap. In the phone app the fix is in the phone's Settings, not a browser
 * (DECISIONS #109).
 */
const micDenied = twilioError(
  31401,
  "PermissionDeniedError (31401): The browser or end-user denied permissions to user media. Therefore we were unable to acquire input audio."
);

test("a blocked microphone in the phone app says where on the phone to allow it", () => {
  const msg = callFailureMessage(micDenied, null, true);
  assert.match(msg, /microphone/i);
  assert.match(msg, /Settings/);
  assert.match(msg, /AI Build Pros CRM/);
  assert.match(msg, /Allow/);
  assert.doesNotMatch(msg, /PermissionDeniedError|user media|browser/i);
});

test("a blocked microphone on the website says to allow it for the site", () => {
  const msg = callFailureMessage(micDenied, null, false);
  assert.match(msg, /microphone/i);
  assert.match(msg, /browser/i);
  assert.doesNotMatch(msg, /PermissionDeniedError|user media/);
});

test("a microphone that won't open says so in plain words", () => {
  const msg = callFailureMessage(twilioError(31402, "AcquisitionFailedError (31402): ..."), null, true);
  assert.match(msg, /microphone/i);
  assert.match(msg, /another app/);
  assert.doesNotMatch(msg, /AcquisitionFailedError/);
});

test("a call's own error goes through the same plain-language messages", () => {
  const src = readFileSync(new URL("../app/(app)/voice-dialer.tsx", import.meta.url), "utf8");
  assert.ok(!src.includes("setErrorMsg(err.message"), "Twilio's raw sentence is never shown");
  assert.match(src, /Capacitor\.isNativePlatform\(\)/, "the dialer knows when it runs in the phone app");
});

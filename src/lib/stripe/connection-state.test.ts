import { test } from "node:test";
import assert from "node:assert/strict";
import { stripeConnectionState } from "./connection-state.ts";

/**
 * Settings said "Connected" whenever an encrypted key was stored, while
 * the customer's Pay button needs the key DECRYPTED. A key saved under a
 * different APP_ENCRYPTION_KEY read "Connected" in Settings and "Online
 * payment isn't switched on yet" in the portal -- two screens disagreeing
 * about the same account, with the customer on the losing side.
 */

test("a saved key the server can read is connected", () => {
  assert.equal(stripeConnectionState("v1.a.b.c", true), "connected");
});

test("a saved key the server can't read is not connected -- it must be re-entered", () => {
  assert.equal(stripeConnectionState("v1.a.b.c", false), "unreadable");
});

test("no saved key is simply not connected", () => {
  assert.equal(stripeConnectionState(null, false), "none");
  assert.equal(stripeConnectionState("", false), "none");
});

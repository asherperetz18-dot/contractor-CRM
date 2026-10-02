import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Settings → Twilio has an ID field followed by a password field, which
 * browsers and password managers read as a sign-in form: they filled the
 * owner's own login email and password into Account SID and Auth token.
 * Saving that would have replaced the company's Twilio account with junk.
 * Every field on the form opts out of autofill in the ways Chrome, Safari,
 * 1Password and LastPass each respect.
 */

const form = readFileSync(
  new URL("../app/(app)/settings/twilio/company-twilio.tsx", import.meta.url),
  "utf8"
);
const inputs = [...form.matchAll(/<input\b[\s\S]*?\/>/g)].map((m) => m[0]);

test("the form has its six fields", () => {
  assert.equal(inputs.length, 6);
});

test("secret fields ask for a new password, so saved logins are never offered", () => {
  for (const input of inputs.filter((i) => /type="password"/.test(i))) {
    assert.match(input, /autoComplete="new-password"/);
  }
});

test("every field opts out of autofill and password managers", () => {
  for (const input of inputs) {
    assert.match(input, /autoComplete="(off|new-password)"/, input);
    assert.match(input, /data-1p-ignore/, input);
    assert.match(input, /data-lpignore="true"/, input);
  }
});

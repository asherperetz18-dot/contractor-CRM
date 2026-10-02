import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { oauthTargetAllowed } from "./oauth-target.ts";

/**
 * The Google Drive and Calendar sign-ins carry "which company" (and, for
 * a rep's own calendar, "which person") from the start of the flow to
 * Google's redirect back in a cookie. A cookie is the browser's to edit,
 * so the callback checks it against who is actually signed in before a
 * connection is saved -- or one company could attach its own Google
 * account to another company's files or calendar.
 */

const A = "aaaaaaaa-0000-0000-0000-000000000000";
const B = "bbbbbbbb-0000-0000-0000-000000000000";
const admin = { id: "u-admin", company_id: A, isAdmin: true };
const rep = { id: "u-rep", company_id: A, isAdmin: false };

test("an admin connects their own company's account", () => {
  assert.equal(oauthTargetAllowed(admin, { company_id: A, profile_id: null }), true);
});

test("a cookie naming another company is refused", () => {
  assert.equal(oauthTargetAllowed(admin, { company_id: B, profile_id: null }), false);
});

test("a company-wide connection needs Office or Admin", () => {
  assert.equal(oauthTargetAllowed(rep, { company_id: A, profile_id: null }), false);
});

test("anyone connects their own calendar, and only their own", () => {
  assert.equal(oauthTargetAllowed(rep, { company_id: A, profile_id: "u-rep" }), true);
  assert.equal(oauthTargetAllowed(rep, { company_id: A, profile_id: "u-admin" }), false);
  assert.equal(oauthTargetAllowed(admin, { company_id: A, profile_id: "u-rep" }), false);
});

test("nobody signed in, nothing saved", () => {
  assert.equal(oauthTargetAllowed(null, { company_id: A, profile_id: null }), false);
});

test("both Google callbacks check the cookie against the signed-in person", () => {
  for (const path of [
    "../app/api/oauth/google-drive/callback/route.ts",
    "../app/api/oauth/google-calendar/callback/route.ts",
  ]) {
    const src = readFileSync(new URL(path, import.meta.url), "utf8");
    const check = src.indexOf("oauthTargetAllowed(");
    const tokenExchange = src.indexOf("fetch(TOKEN_URL");
    assert.ok(check > 0, `${path} must call oauthTargetAllowed`);
    assert.ok(check < tokenExchange, `${path} must check before exchanging the code`);
  }
});

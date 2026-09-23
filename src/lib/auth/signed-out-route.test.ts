import { test } from "node:test";
import assert from "node:assert/strict";
import { signedOutRedirect } from "./signed-out-route.ts";

/**
 * Where a visitor with no session is sent. The bare address used to go
 * straight to the staff login, so a contractor who typed the site in
 * never saw what the product was or what it cost. The front page is for
 * them now; every other private page still goes to the login.
 */

test("the bare site address shows the public front page", () => {
  assert.equal(signedOutRedirect("/"), "/home");
});

test("a private page still goes to the staff login", () => {
  assert.equal(signedOutRedirect("/pipeline"), "/login");
  assert.equal(signedOutRedirect("/settings/billing"), "/login");
});

test("public pages are let through as they are", () => {
  for (const path of [
    "/home",
    "/login",
    "/get-started",
    "/welcome",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/portal/estimates/abc",
    "/auth/callback",
  ]) {
    assert.equal(signedOutRedirect(path), null, path);
  }
});

test("a private page whose name merely starts like a public one is not public", () => {
  assert.equal(signedOutRedirect("/homework"), "/login");
  assert.equal(signedOutRedirect("/portalx"), "/login");
});

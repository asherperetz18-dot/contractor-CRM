import { test } from "node:test";
import assert from "node:assert/strict";
import { isPublicPath } from "./public-paths.ts";

test("the store-listed privacy and account-deletion pages open without signing in", () => {
  // Google Play reviewers and the public follow these links from the
  // store listing; a bounce to /login fails the listing's checks.
  assert.equal(isPublicPath("/privacy"), true);
  assert.equal(isPublicPath("/delete-account"), true);
});

test("sign-in, portal and signup stay public", () => {
  for (const p of ["/login", "/portal/estimates/1", "/get-started", "/welcome", "/register"]) {
    assert.equal(isPublicPath(p), true, p);
  }
});

test("the CRM itself is not public", () => {
  for (const p of ["/", "/pipeline", "/settings/billing", "/billing-locked"]) {
    assert.equal(isPublicPath(p), false, p);
  }
});

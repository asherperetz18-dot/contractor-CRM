import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Google Play wants the privacy policy and the way to ask for account
 * deletion reachable inside the app, not only from the store listing
 * (DECISIONS #087). Signed out, that is the sign-in page; signed in, the
 * sidebar every page shows.
 */

const app = join(import.meta.dirname, "..", "..", "app");

test("the privacy and account-deletion pages exist", () => {
  assert.ok(existsSync(join(app, "privacy", "page.tsx")));
  assert.ok(existsSync(join(app, "delete-account", "page.tsx")));
});

for (const [where, file] of [
  ["sign-in page", join(app, "login", "login-form.tsx")],
  ["sidebar", join(app, "(app)", "mobile-nav.tsx")],
] as const) {
  test(`the ${where} links to both`, () => {
    const src = readFileSync(file, "utf8");
    assert.match(src, /href="\/privacy"/);
    assert.match(src, /href="\/delete-account"/);
  });
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { exactEmailPattern } from "./email-match.ts";

/**
 * The portal's "email me a sign-in link" form finds the customer with a
 * case-insensitive match. To ilike, "_" and "%" are wildcards, and
 * underscores are ordinary in email addresses -- so the typed address is
 * escaped to match itself only.
 */

test("wildcards in the typed address match only themselves", () => {
  assert.equal(exactEmailPattern("j_hn@example.com"), "j\\_hn@example.com");
  assert.equal(exactEmailPattern("%@example.com"), "\\%@example.com");
  assert.equal(exactEmailPattern("a\\b@example.com"), "a\\\\b@example.com");
});

test("an ordinary address is unchanged", () => {
  assert.equal(exactEmailPattern("john@example.com"), "john@example.com");
});

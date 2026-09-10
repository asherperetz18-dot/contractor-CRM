import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTaxId } from "./tax-id.ts";

/**
 * The Company Tax ID typed on the Company Profile page is stored as-is
 * except for whitespace: an EIN, SSN, or state ID all pass through, and
 * an emptied field clears the column (null) instead of storing "".
 */

test("a typed tax id is kept exactly, minus surrounding whitespace", () => {
  assert.equal(normalizeTaxId("12-3456789"), "12-3456789");
  assert.equal(normalizeTaxId("  12-3456789  "), "12-3456789");
  // Not every tax id is an EIN; formats are not second-guessed.
  assert.equal(normalizeTaxId("123-45-6789"), "123-45-6789");
  assert.equal(normalizeTaxId("CA 123456"), "CA 123456");
});

test("an emptied field clears the stored id", () => {
  assert.equal(normalizeTaxId(""), null);
  assert.equal(normalizeTaxId("   "), null);
});

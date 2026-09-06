import { test } from "node:test";
import assert from "node:assert/strict";
import { seesOnlyOwnDocuments } from "./document-news-scope.ts";
import type { AppRole } from "./types.ts";

const roles = (...rs: AppRole[]) => ({ roles: rs });

test("company-running roles keep company-wide document news", () => {
  assert.equal(seesOnlyOwnDocuments(roles("Office")), false);
  assert.equal(seesOnlyOwnDocuments(roles("Admin")), false);
  assert.equal(seesOnlyOwnDocuments(roles("Bookkeeping")), false);
  assert.equal(seesOnlyOwnDocuments(roles("Production")), false);
});

test("a sales rep sees only their own documents' news", () => {
  assert.equal(seesOnlyOwnDocuments(roles("Sales")), true);
});

test("field, dispatch and call center are scoped too", () => {
  assert.equal(seesOnlyOwnDocuments(roles("Field")), true);
  assert.equal(seesOnlyOwnDocuments(roles("Dispatch")), true);
  assert.equal(seesOnlyOwnDocuments(roles("Call Center")), true);
});

test("holding a company-wide role alongside Sales lifts the scope", () => {
  // A rep who also runs production is watching every job on purpose.
  assert.equal(seesOnlyOwnDocuments(roles("Sales", "Production")), false);
  assert.equal(seesOnlyOwnDocuments(roles("Sales", "Office")), false);
});

test("no profile means scoped, never company-wide by accident", () => {
  assert.equal(seesOnlyOwnDocuments(null), true);
  assert.equal(seesOnlyOwnDocuments(roles()), true);
});

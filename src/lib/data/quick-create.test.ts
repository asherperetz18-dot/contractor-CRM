import { test } from "node:test";
import assert from "node:assert/strict";
import { quickCreateDialog, shouldOpenQuickCreate } from "./quick-create.ts";

/**
 * Quick Create's items land on their page with ?new=... and the page
 * opens its own "new" form by itself: New Lead on /pipeline, New
 * Appointment on /schedule, New Job on /production, New Contract on
 * /contracts, New Estimate / New Invoice on /estimates. The rule worth
 * pinning: the param opens it, but never for someone the page's own
 * New button is hidden from -- the form would let them fill everything
 * in and fail only on save.
 */

test("?new=1 opens the form for someone who may create", () => {
  assert.equal(shouldOpenQuickCreate("1", true), true);
});

test("without the param the page opens normally", () => {
  assert.equal(shouldOpenQuickCreate(null, true), false);
  assert.equal(shouldOpenQuickCreate("", true), false);
});

test("no create permission means no form, param or not", () => {
  assert.equal(shouldOpenQuickCreate("1", false), false);
  assert.equal(shouldOpenQuickCreate(null, false), false);
});

test("?new=invoice opens the New invoice window instead of a new estimate", () => {
  assert.equal(quickCreateDialog("invoice", true), "invoice");
  assert.equal(quickCreateDialog("1", true), "estimate");
  assert.equal(quickCreateDialog(null, true), null);
  assert.equal(quickCreateDialog("invoice", false), null);
});

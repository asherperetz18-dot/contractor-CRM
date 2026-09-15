import { test } from "node:test";
import assert from "node:assert/strict";
import { manualEditUpdate } from "./manual-edit.ts";

// A hand-recorded payment gets typed wrong: the cheque number was left
// off, the amount fat-fingered, the wrong day picked. Until now the only
// fix was delete-and-record-again, which needs Office/Admin and loses
// who recorded it. These are the rules behind editing the row in place.

test("editing a manual payment builds the update from what changed", () => {
  const res = manualEditUpdate(
    { source: "manual", status: "succeeded" },
    { amountCents: 700000, method: "check", reference: " 1042 ", note: "" }
  );
  assert.equal("error" in res, false);
  if ("update" in res) {
    assert.equal(res.update.amount_cents, 700000);
    assert.equal(res.update.method, "check");
    // Trimmed, and an emptied field stores null rather than "".
    assert.equal(res.update.reference, "1042");
    assert.equal(res.update.note, null);
    // Untouched fields stay untouched.
    assert.equal("created_at" in res.update, false);
    assert.equal("paid_at" in res.update, false);
  }
});

test("a new received-on date moves the settled date with it", () => {
  const res = manualEditUpdate(
    { source: "manual", status: "succeeded" },
    { receivedOn: "2026-04-07" }
  );
  assert.ok("update" in res);
  if ("update" in res) {
    // Noon, matching recordManualPayment, so the date never slips a day
    // across timezones.
    const noon = new Date("2026-04-07T12:00:00").toISOString();
    assert.equal(res.update.created_at, noon);
    assert.equal(res.update.paid_at, noon);
  }
});

test("a still-clearing payment keeps paid_at empty when re-dated", () => {
  const res = manualEditUpdate(
    { source: "manual", status: "pending" },
    { receivedOn: "2026-04-07" }
  );
  assert.ok("update" in res);
  if ("update" in res) {
    assert.equal(res.update.created_at, new Date("2026-04-07T12:00:00").toISOString());
    // It has not landed; giving it a paid date would count it as money.
    assert.equal("paid_at" in res.update, false);
  }
});

test("Stripe rows are never edited by hand", () => {
  const res = manualEditUpdate(
    { source: "stripe", status: "succeeded" },
    { reference: "1042" }
  );
  assert.ok("error" in res);
});

test("an amount must stay above zero", () => {
  const res = manualEditUpdate({ source: "manual", status: "succeeded" }, { amountCents: 0 });
  assert.ok("error" in res);
});

test("an unknown method is refused", () => {
  const res = manualEditUpdate(
    { source: "manual", status: "succeeded" },
    { method: "crypto" }
  );
  assert.ok("error" in res);
});

test("an edit that changes nothing is refused rather than written", () => {
  const res = manualEditUpdate({ source: "manual", status: "succeeded" }, {});
  assert.ok("error" in res);
});

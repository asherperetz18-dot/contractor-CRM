import { test } from "node:test";
import assert from "node:assert/strict";
import { canEditJobCosts, expenseEditLock, jobExpensePatch } from "./expense-edit.ts";

test("only the roles the database lets write costs get Edit -- Field records, never edits", () => {
  assert.equal(canEditJobCosts({ roles: ["Office"] }), true);
  assert.equal(canEditJobCosts({ roles: ["Admin"] }), true);
  assert.equal(canEditJobCosts({ roles: ["Bookkeeping"] }), true);
  assert.equal(canEditJobCosts({ roles: ["Production"] }), true);
  assert.equal(canEditJobCosts({ roles: ["Field"] }), false);
  assert.equal(canEditJobCosts({ roles: ["Sales"] }), false);
  assert.equal(canEditJobCosts(null), false);
});

test("QuickBooks and bill-payment costs are locked, receipts entered by hand are not", () => {
  assert.equal(expenseEditLock({ source: "manual" }), null);
  assert.match(expenseEditLock({ source: "quickbooks" }) ?? "", /QuickBooks/);
  assert.match(expenseEditLock({ source: "bill" }) ?? "", /Bills to Pay/);
});

const current = { lead_id: "l1", estimate_payment_id: "ph1" };
const input = {
  leadId: "l1",
  vendorId: "",
  vendor: "  Vera ",
  description: " Framing ",
  amountCents: 2750000,
  spentOn: "2026-09-23",
};

test("a valid edit becomes a trimmed patch that keeps the phase on the same job", () => {
  const res = jobExpensePatch(input, current);
  assert.deepEqual(res, {
    patch: {
      lead_id: "l1",
      estimate_payment_id: "ph1",
      vendor_id: null,
      vendor: "Vera",
      description: "Framing",
      amount_cents: 2750000,
      spent_on: "2026-09-23",
    },
  });
});

test("moving the cost to another job drops its phase -- phases belong to one job", () => {
  const res = jobExpensePatch({ ...input, leadId: "l2" }, current);
  assert.ok("patch" in res);
  assert.equal(res.patch.lead_id, "l2");
  assert.equal(res.patch.estimate_payment_id, null);
});

test("a picked vendor record clears the free-text name", () => {
  const res = jobExpensePatch({ ...input, vendorId: "v1" }, current);
  assert.ok("patch" in res);
  assert.equal(res.patch.vendor_id, "v1");
  assert.equal(res.patch.vendor, null);
});

test("refuses a missing job, amount or date", () => {
  assert.ok("error" in jobExpensePatch({ ...input, leadId: "" }, current));
  assert.ok("error" in jobExpensePatch({ ...input, amountCents: 0 }, current));
  assert.ok("error" in jobExpensePatch({ ...input, spentOn: "" }, current));
});

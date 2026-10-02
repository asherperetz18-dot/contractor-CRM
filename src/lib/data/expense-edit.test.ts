import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canEditJobCosts,
  expenseDeleteLock,
  expenseEditLock,
  jobExpensePatch,
  phaseRefileIds,
} from "./expense-edit.ts";

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

test("a contract picked in the window wins -- including moving it to 'not filed'", () => {
  const picked = jobExpensePatch({ ...input, estimatePaymentId: "ph9" }, current);
  assert.ok("patch" in picked);
  assert.equal(picked.patch.estimate_payment_id, "ph9");
  const cleared = jobExpensePatch({ ...input, estimatePaymentId: "" }, current);
  assert.ok("patch" in cleared);
  assert.equal(cleared.patch.estimate_payment_id, null);
});

// The contract page's × once deleted a bill payment's job cost and left
// the payment behind: Bills to Pay still read check #180408 as $6,030
// paid while the job counted $0 spent and profit read $6,030 high.
test("a bill payment's cost can't be deleted on its own -- the payment is deleted in Bills to Pay", () => {
  assert.equal(expenseDeleteLock({ source: "manual" }), null);
  const bill = expenseDeleteLock({ source: "bill" }) ?? "";
  assert.match(bill, /Bills to Pay/);
  assert.match(bill, /delete the payment/);
  assert.match(expenseDeleteLock({ source: "quickbooks" }) ?? "", /QuickBooks/);
});

test("filing a receipt to a phase moves just that receipt", () => {
  assert.deepEqual(phaseRefileIds({ id: "c1", source: "manual" }, []), ["c1"]);
});

test("filing a bill payment's cost moves every payment of that bill -- one bill, one phase", () => {
  assert.deepEqual(phaseRefileIds({ id: "c1", source: "bill" }, ["c1", "c2", null]), ["c1", "c2"]);
  // Its payment row not found: the cost itself still moves.
  assert.deepEqual(phaseRefileIds({ id: "c1", source: "bill" }, []), ["c1"]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { billRemainingCents } from "./types.ts";
import { billPaymentMethodLabel, billReferenceLabel, openBillsByPhase, type OpenJobBill } from "./bills.ts";

/**
 * What Job costs shows as "Unpaid" per phase is these two functions
 * back to back: what is left on each bill, grouped by the phase the
 * bill was filed to. A bill with nothing left must drop out entirely,
 * and an overpayment must never read as negative debt.
 */

const bill = (over: Partial<OpenJobBill>): OpenJobBill => ({
  id: "b",
  lead_id: "l",
  estimate_payment_id: null,
  vendor_id: null,
  vendor_name: "BMC",
  reference: null,
  amount_cents: 10000,
  remaining_cents: 10000,
  bill_date: null,
  due_date: null,
  scheduled_date: null,
  receipt_url: null,
  receipt_path: null,
  ...over,
});

test("remaining is the bill less its payments, floored at zero", () => {
  assert.equal(billRemainingCents({ amount_cents: 600000 }, []), 600000);
  assert.equal(billRemainingCents({ amount_cents: 600000 }, [{ amount_cents: 250000 }]), 350000);
  assert.equal(billRemainingCents({ amount_cents: 600000 }, [{ amount_cents: 600000 }]), 0);
  assert.equal(billRemainingCents({ amount_cents: 600000 }, [{ amount_cents: 700000 }]), 0);
});

test("bills group by the phase they are filed to, unfiled under null", () => {
  const grouped = openBillsByPhase([
    bill({ id: "1", estimate_payment_id: "plans", remaining_cents: 600000 }),
    bill({ id: "2", estimate_payment_id: "plans", remaining_cents: 100 }),
    bill({ id: "3", estimate_payment_id: null, remaining_cents: 10000 }),
  ]);
  const sum = (k: string | null) => (grouped.get(k) ?? []).reduce((s, b) => s + b.remaining_cents, 0);
  assert.equal(sum("plans"), 600100);
  assert.equal(sum(null), 10000);
  assert.equal(sum("demo"), 0);
});

test("the reference box is named for the method, and old rows read back plainly", () => {
  assert.equal(billReferenceLabel("check"), "Check #");
  assert.equal(billReferenceLabel("zelle"), "Confirmation #");
  assert.equal(billReferenceLabel("card"), "Last 4 / receipt #");
  assert.equal(billPaymentMethodLabel("wire"), "Wire / bank transfer");
  // A payment recorded before migration 0124 has no method at all.
  assert.equal(billPaymentMethodLabel(null), null);
  assert.equal(billPaymentMethodLabel(undefined), null);
  // An unknown stored value is shown as-is rather than hidden.
  assert.equal(billPaymentMethodLabel("venmo"), "venmo");
});

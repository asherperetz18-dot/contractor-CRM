import { test } from "node:test";
import assert from "node:assert/strict";
import { BILL_PAYMENT_METHODS, planBillPayments } from "./bills.ts";

const line = (amountCents: number, method = "card", over = {}) => ({
  amountCents,
  method,
  paidOn: "2026-09-23",
  reference: "",
  paidFromAccountId: "",
  ...over,
});

test("ACH is a method -- QuickBooks and the bank both call it that", () => {
  assert.ok((BILL_PAYMENT_METHODS as readonly string[]).includes("ach"));
});

test("lines that add up to the bill are paid in full", () => {
  const r = planBillPayments(125000, [line(80000), line(45000, "check")], { allowPartial: true });
  assert.ok("status" in r);
  assert.equal(r.status, "full");
  assert.equal(r.paidCents, 125000);
  assert.equal(r.leftCents, 0);
});

test("less than the bill is a part payment; the rest stays owed", () => {
  const r = planBillPayments(125000, [line(80000), line(30000, "check")], { allowPartial: true });
  assert.ok("status" in r);
  assert.equal(r.status, "partial");
  assert.equal(r.leftCents, 15000);
});

test("paying more than the bill is refused", () => {
  const r = planBillPayments(1000, [line(800), line(300)], { allowPartial: true });
  assert.ok("error" in r);
});

test("someone who can't leave a bill owing (Field) must pay it in full", () => {
  const r = planBillPayments(1000, [line(800)], { allowPartial: false });
  assert.ok("error" in r);
  assert.match(r.error, /whole bill/i);
});

test("every line needs an amount, a method from the list and a date", () => {
  assert.ok("error" in planBillPayments(1000, [line(0)], { allowPartial: true }));
  assert.ok("error" in planBillPayments(1000, [line(1000, "bitcoin")], { allowPartial: true }));
  assert.ok("error" in planBillPayments(1000, [line(1000, "")], { allowPartial: true }));
  assert.ok("error" in planBillPayments(1000, [line(1000, "card", { paidOn: "" })], { allowPartial: true }));
});

test("no lines is not a payment -- that's 'not paid yet', a different save", () => {
  assert.ok("error" in planBillPayments(1000, [], { allowPartial: true }));
});

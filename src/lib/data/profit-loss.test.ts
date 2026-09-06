import { test } from "node:test";
import assert from "node:assert/strict";
import {
  plPeriodWindow,
  profitLoss,
  type ProfitLossInput,
} from "./profit-loss.ts";
import { ALL_TIME } from "./date-range.ts";

// One small company, one month of activity, engineered so every rule
// below has a row that exercises it. All amounts are exact cents.
//
// Job A (lead-a, contract est-a): $50,000 contract, $1,000 deposit
//   signed Aug 5. Phase 1 $20,000 requested Aug 10, customer paid
//   $15,000 of it Aug 20 (partial). A $2,000 check is still clearing.
//   Costs: $3,000 lumber receipt Aug 12; $4,000 vendor bill dated
//   Aug 14, half-paid ($2,000) Aug 25 -- which wrote a source:"bill"
//   job cost the same day.
// Job B (lead-b, contract est-b): deposit $500 signed July 30 (prior
//   month). Phase $10,000 requested Sep 2 (next month).
// Overhead: office-rent bill $1,500 dated Aug 1 (no job), paid $1,500
//   Aug 3. A voided no-job bill for $9,900 dated Aug 2 with a real
//   $300 payment made Aug 2 before the void.
const COMPANY: ProfitLossInput = {
  contracts: [
    { id: "est-a", lead_id: "lead-a", deposit_cents: 100000, signed_at: "2026-08-05T18:30:00Z" },
    { id: "est-b", lead_id: "lead-b", deposit_cents: 50000, signed_at: "2026-07-30T12:00:00Z" },
  ],
  phases: [
    { estimate_id: "est-a", amount_cents: 2000000, requested_at: "2026-08-10T09:00:00Z" },
    { estimate_id: "est-b", amount_cents: 1000000, requested_at: "2026-09-02T09:00:00Z" },
    // A phase on a document nobody signed: no lead in the contracts
    // map, so it must count as nothing on either basis.
    { estimate_id: "est-draft", amount_cents: 555500, requested_at: "2026-08-11T09:00:00Z" },
  ],
  payments: [
    // The deposit, paid through the portal the day of signing.
    { estimate_id: "est-a", lead_id: "lead-a", amount_cents: 100000, status: "succeeded", paid_at: "2026-08-05T19:00:00Z", created_at: "2026-08-05T19:00:00Z" },
    // Partial payment on phase 1.
    { estimate_id: "est-a", lead_id: "lead-a", amount_cents: 1500000, status: "succeeded", paid_at: "2026-08-20T16:00:00Z", created_at: "2026-08-20T16:00:00Z" },
    // A check taken but not banked: clearing, not income.
    { estimate_id: "est-a", lead_id: "lead-a", amount_cents: 200000, status: "pending", paid_at: null, created_at: "2026-08-21T16:00:00Z" },
    // An old row without lead_id: resolved through its contract.
    { estimate_id: "est-b", lead_id: null, amount_cents: 50000, status: "succeeded", paid_at: "2026-07-30T13:00:00Z", created_at: "2026-07-30T13:00:00Z" },
  ],
  expenses: [
    // A receipt, entered by hand.
    { lead_id: "lead-a", amount_cents: 300000, spent_on: "2026-08-12", source: "manual" },
    // The job cost recordBillPayment wrote for the half-paid bill.
    { lead_id: "lead-a", amount_cents: 200000, spent_on: "2026-08-25", source: "bill" },
  ],
  bills: [
    // Job-linked vendor bill, half paid.
    { id: "bill-a", lead_id: "lead-a", vendor_id: "v-1", vendor_name: null, amount_cents: 400000, bill_date: "2026-08-14", created_at: "2026-08-14T08:00:00Z", voided_at: null },
    // Overhead: the office rent.
    { id: "bill-rent", lead_id: null, vendor_id: null, vendor_name: "Canyon Property Mgmt", amount_cents: 150000, bill_date: "2026-08-01", created_at: "2026-08-01T08:00:00Z", voided_at: null },
    // Overhead bill entered wrong and voided -- but $300 really left.
    { id: "bill-void", lead_id: null, vendor_id: null, vendor_name: "Duplicate Entry Inc", amount_cents: 990000, bill_date: "2026-08-02", created_at: "2026-08-02T08:00:00Z", voided_at: "2026-08-03T08:00:00Z" },
  ],
  billPayments: [
    { bill_id: "bill-a", amount_cents: 200000, paid_on: "2026-08-25" },
    { bill_id: "bill-rent", amount_cents: 150000, paid_on: "2026-08-03" },
    { bill_id: "bill-void", amount_cents: 30000, paid_on: "2026-08-02" },
  ],
};

const AUG = { from: "2026-08-01", to: "2026-08-31" };

test("cash basis: income is settled payments only, dated the day they settled", () => {
  const r = profitLoss("cash", AUG, COMPANY);
  // $1,000 deposit + $15,000 partial. The $2,000 clearing check is not
  // money, and July's $500 deposit is outside the window.
  assert.equal(r.incomeCents, 1600000);
});

test("cash basis: job costs are the ledger as spent, bill payments included", () => {
  const r = profitLoss("cash", AUG, COMPANY);
  // $3,000 receipt + $2,000 bill payment (via its source:"bill" cost).
  assert.equal(r.jobCostCents, 500000);
  assert.equal(r.grossProfitCents, 1100000);
});

test("cash basis: overhead is payments on no-job bills, void or not", () => {
  const r = profitLoss("cash", AUG, COMPANY);
  // $1,500 rent + the $300 that left before the void.
  assert.equal(r.overheadCents, 180000);
  assert.equal(r.netProfitCents, 1100000 - 180000);
});

test("accrual basis: income is what was billed -- deposit at signing, phases at request", () => {
  const r = profitLoss("accrual", AUG, COMPANY);
  // $1,000 deposit (signed Aug 5) + $20,000 phase (requested Aug 10).
  // July's deposit and September's phase fall outside; the unsigned
  // document's phase counts as nothing.
  assert.equal(r.incomeCents, 2100000);
});

test("accrual basis: costs are bills as billed plus receipts, never the bill's cash twin", () => {
  const r = profitLoss("accrual", AUG, COMPANY);
  // $3,000 receipt + $4,000 bill at its bill date. The $2,000
  // source:"bill" cost is the same money as half that bill and is
  // excluded -- were it counted, paying a bill would inflate accrual
  // costs by every dollar paid.
  assert.equal(r.jobCostCents, 700000);
  assert.equal(r.grossProfitCents, 2100000 - 700000);
});

test("accrual basis: overhead is no-job bills as billed; a voided bill is no expense", () => {
  const r = profitLoss("accrual", AUG, COMPANY);
  assert.equal(r.overheadCents, 150000);
  assert.equal(r.netProfitCents, 2100000 - 700000 - 150000);
  // The voided $9,900 must not appear anywhere.
  assert.ok(r.overhead.every((o) => o.vendorName !== "Duplicate Entry Inc"));
});

test("the same dollar never lands twice on one basis", () => {
  // Every reading of the half-paid bill: cash sees $2,000 (the payment,
  // via its job cost), accrual sees $4,000 (the bill) -- never $6,000.
  const cash = profitLoss("cash", ALL_TIME, COMPANY);
  const accrual = profitLoss("accrual", ALL_TIME, COMPANY);
  const cashJobA = cash.jobs.find((j) => j.leadId === "lead-a")!;
  const accrualJobA = accrual.jobs.find((j) => j.leadId === "lead-a")!;
  assert.equal(cashJobA.costCents, 500000);
  assert.equal(accrualJobA.costCents, 700000);
});

test("a payment without lead_id finds its job through the contract", () => {
  const r = profitLoss("cash", ALL_TIME, COMPANY);
  const jobB = r.jobs.find((j) => j.leadId === "lead-b");
  assert.equal(jobB?.incomeCents, 50000);
});

test("jobs are listed biggest income first", () => {
  const r = profitLoss("cash", ALL_TIME, COMPANY);
  assert.deepEqual(
    r.jobs.map((j) => j.leadId),
    ["lead-a", "lead-b"]
  );
});

test("window edges are inclusive and read timestamps as their day", () => {
  // The Aug 20 payment carries a time-of-day; a window ending Aug 20
  // must still include it.
  const r = profitLoss("cash", { from: "2026-08-20", to: "2026-08-20" }, COMPANY);
  assert.equal(r.incomeCents, 1500000);
});

test("summary lines always reconcile: gross = income - costs, net = gross - overhead", () => {
  for (const basis of ["cash", "accrual"] as const) {
    const r = profitLoss(basis, AUG, COMPANY);
    assert.equal(r.grossProfitCents, r.incomeCents - r.jobCostCents);
    assert.equal(r.netProfitCents, r.grossProfitCents - r.overheadCents);
    const jobIncome = r.jobs.reduce((s, j) => s + j.incomeCents, 0);
    assert.equal(jobIncome, r.incomeCents, basis + ": job rows sum to the income line");
  }
});

test("calendar periods cover whole months, not month-to-today", () => {
  const midMonth = new Date(2026, 8, 6); // Sep 6, 2026
  assert.deepEqual(plPeriodWindow("this-month", midMonth), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(plPeriodWindow("last-month", midMonth), { from: "2026-08-01", to: "2026-08-31" });
  assert.deepEqual(plPeriodWindow("this-quarter", midMonth), { from: "2026-07-01", to: "2026-09-30" });
  assert.deepEqual(plPeriodWindow("this-year", midMonth), { from: "2026-01-01", to: "2026-12-31" });
  assert.deepEqual(plPeriodWindow("last-year", midMonth), { from: "2025-01-01", to: "2025-12-31" });
  assert.deepEqual(plPeriodWindow("all", midMonth), { from: null, to: null });
});

test("quarter and year-end months roll over correctly", () => {
  const december = new Date(2026, 11, 15);
  assert.deepEqual(plPeriodWindow("this-quarter", december), { from: "2026-10-01", to: "2026-12-31" });
  const january = new Date(2026, 0, 2);
  assert.deepEqual(plPeriodWindow("last-month", january), { from: "2025-12-01", to: "2025-12-31" });
});

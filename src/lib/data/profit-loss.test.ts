import { test } from "node:test";
import assert from "node:assert/strict";
import {
  plPeriodWindow,
  profitLoss,
  profitLossByMonth,
  jobBarRows,
  uncostedJobs,
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

// ── Month by month: the same ledger, bucketed for the trend chart ────

const SEP_20 = new Date(2026, 8, 20);

test("months: one bucket per calendar month in the window, oldest first, zero-filled", () => {
  const months = profitLossByMonth("cash", { from: "2026-07-01", to: "2026-09-30" }, COMPANY, SEP_20);
  assert.deepEqual(
    months.map((m) => m.month),
    ["2026-07", "2026-08", "2026-09"]
  );
  // July: only job B's $500 deposit settled (Jul 30).
  assert.equal(months[0].incomeCents, 50000);
  assert.equal(months[0].jobCostCents, 0);
  // September: nothing moved on the cash basis -- the phase requested
  // Sep 2 is billed, not banked.
  assert.deepEqual(months[2], {
    month: "2026-09",
    incomeCents: 0,
    jobCostCents: 0,
    overheadCents: 0,
    netCents: 0,
  });
});

test("months: every bucket reconciles with the statement for that month", () => {
  for (const basis of ["cash", "accrual"] as const) {
    const months = profitLossByMonth(basis, { from: "2026-07-01", to: "2026-09-30" }, COMPANY, SEP_20);
    const aug = months.find((m) => m.month === "2026-08")!;
    const stmt = profitLoss(basis, AUG, COMPANY);
    assert.equal(aug.incomeCents, stmt.incomeCents, basis + ": income");
    assert.equal(aug.jobCostCents, stmt.jobCostCents, basis + ": job costs");
    assert.equal(aug.overheadCents, stmt.overheadCents, basis + ": overhead");
    assert.equal(aug.netCents, stmt.netProfitCents, basis + ": net");
    // The buckets sum to the whole window's statement.
    const whole = profitLoss(basis, { from: "2026-07-01", to: "2026-09-30" }, COMPANY);
    assert.equal(months.reduce((s, m) => s + m.incomeCents, 0), whole.incomeCents);
    assert.equal(months.reduce((s, m) => s + m.netCents, 0), whole.netProfitCents);
  }
});

test("months: accrual books September's phase the day it was requested", () => {
  const months = profitLossByMonth("accrual", { from: "2026-07-01", to: "2026-09-30" }, COMPANY, SEP_20);
  assert.equal(months[2].incomeCents, 1000000);
});

test("months: all time runs from the first month with activity through this month", () => {
  const months = profitLossByMonth("cash", ALL_TIME, COMPANY, new Date(2026, 7, 20));
  assert.deepEqual(
    months.map((m) => m.month),
    ["2026-07", "2026-08"]
  );
});

test("months: an open-ended window is closed at the later of today and the last entry", () => {
  // "From July on", asked in October: the chart should run through
  // October's empty month, not stop at the last dollar.
  const months = profitLossByMonth(
    "cash",
    { from: "2026-07-01", to: null },
    COMPANY,
    new Date(2026, 9, 15)
  );
  assert.deepEqual(
    months.map((m) => m.month),
    ["2026-07", "2026-08", "2026-09", "2026-10"]
  );
});

test("months: a window that runs into the future stops at this month", () => {
  // "This year" asked in September: Oct-Dec have not happened, and an
  // empty bar for each would read as profit falling to nothing.
  const months = profitLossByMonth("cash", { from: "2026-01-01", to: "2026-12-31" }, COMPANY, SEP_20);
  assert.equal(months[0].month, "2026-01");
  assert.equal(months[months.length - 1].month, "2026-09");
});

test("months: nothing in the window means no buckets", () => {
  assert.deepEqual(profitLossByMonth("cash", { from: "2020-01-01", to: "2020-12-31" }, COMPANY), []);
});

// ── Profit-by-job bars: the table's rows, folded to fit a panel ──────

test("job bars: the first N jobs keep their names, the rest fold into one summed row", () => {
  const jobs = [
    { leadId: "a", incomeCents: 500, costCents: 100, profitCents: 400 },
    { leadId: "b", incomeCents: 300, costCents: 50, profitCents: 250 },
    { leadId: "c", incomeCents: 200, costCents: 0, profitCents: 200 },
    { leadId: null, incomeCents: 100, costCents: 0, profitCents: 100 },
  ];
  const rows = jobBarRows(jobs, (id) => (id ? `Job ${id}` : "Not tied to a job"), 2);
  assert.deepEqual(rows, [
    { key: "a", label: "Job a", incomeCents: 500, costCents: 100 },
    { key: "b", label: "Job b", incomeCents: 300, costCents: 50 },
    { key: "~more", label: "2 more jobs", incomeCents: 300, costCents: 0 },
  ]);
});

test("job bars: nothing folds when the list fits", () => {
  const jobs = [{ leadId: "a", incomeCents: 500, costCents: 100, profitCents: 400 }];
  assert.equal(jobBarRows(jobs, () => "A", 8).length, 1);
});

test("uncosted jobs: income with no cost recorded, never a job with nothing at all", () => {
  const jobs = [
    { leadId: "a", incomeCents: 500, costCents: 0, profitCents: 500 },
    { leadId: "b", incomeCents: 300, costCents: 50, profitCents: 250 },
    { leadId: "c", incomeCents: 0, costCents: 20, profitCents: -20 },
  ];
  assert.equal(uncostedJobs(jobs), 1);
});

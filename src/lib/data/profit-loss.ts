// The .ts extension is what lets `node --test` run this module raw --
// tsconfig has allowImportingTsExtensions on, and the bundler resolves
// it the same as the bare name.
import { withinWindow, isoDay, type DateWindow } from "./date-range.ts";

/**
 * The Profit & Loss arithmetic, with no database and no dates-of-today
 * baked in, so the tests can hand it a tiny company and assert exact
 * dollars.
 *
 * One report, two readings of the same records:
 *
 * CASH answers "what actually moved". Income is customer payments that
 * settled (Stripe or recorded by hand), dated the day they settled.
 * Costs are the job-cost ledger as spent -- receipts AND the payments
 * made against vendor bills, because paying a bill writes a job cost
 * (see recordBillPayment). Overhead is the payments made against no-job
 * bills, dated the day the check went out.
 *
 * ACCRUAL answers "what was earned and owed". Income is what was BILLED:
 * the deposit the day the contract was signed, each progress phase the
 * day it was requested. Costs are vendor bills the day they were billed
 * plus receipts as spent -- but NOT the job costs that bill payments
 * wrote, because those are the cash half of bills already counted.
 * Overhead is no-job bills the day they were billed.
 *
 * The same dollar therefore never lands twice on either basis: a bill
 * shows on accrual when billed and on cash when paid, never both in one
 * reading.
 */

export type PLBasis = "cash" | "accrual";

// ── Input rows: the narrow slice of each table the report reads ──────

export type PLPayment = {
  estimate_id: string;
  lead_id: string | null;
  amount_cents: number;
  /** Only "succeeded" is money. "pending" is a check not yet banked. */
  status: string;
  paid_at: string | null;
  created_at: string;
};

export type PLPhase = {
  estimate_id: string;
  amount_cents: number;
  requested_at: string | null;
};

/** A signed money document -- contract or change order. */
export type PLContract = {
  id: string;
  lead_id: string;
  deposit_cents: number | null;
  signed_at: string | null;
};

export type PLExpense = {
  lead_id: string;
  amount_cents: number;
  spent_on: string;
  /** "bill" rows are the auto-written cash half of a bill payment. */
  source: string;
};

export type PLBill = {
  id: string;
  lead_id: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  amount_cents: number;
  bill_date: string | null;
  created_at: string;
  voided_at: string | null;
};

export type PLBillPayment = {
  bill_id: string;
  amount_cents: number;
  paid_on: string;
};

export type ProfitLossInput = {
  payments: PLPayment[];
  phases: PLPhase[];
  contracts: PLContract[];
  expenses: PLExpense[];
  bills: PLBill[];
  billPayments: PLBillPayment[];
};

// ── Output ───────────────────────────────────────────────────────────

export type PLJobLine = {
  /** Null when a payment could not be tied to a job -- shown as its own row. */
  leadId: string | null;
  incomeCents: number;
  costCents: number;
  profitCents: number;
};

export type PLOverheadLine = {
  vendorId: string | null;
  /** Free-text payee when no vendor record matched. */
  vendorName: string | null;
  entries: number;
  amountCents: number;
};

export type ProfitLoss = {
  incomeCents: number;
  jobCostCents: number;
  grossProfitCents: number;
  overheadCents: number;
  netProfitCents: number;
  /** Biggest income first; the no-job bucket, if any, last. */
  jobs: PLJobLine[];
  /** Biggest total first. */
  overhead: PLOverheadLine[];
};

// ── Periods ──────────────────────────────────────────────────────────

export type PLPeriodKey =
  | "this-month"
  | "last-month"
  | "this-quarter"
  | "this-year"
  | "last-year"
  | "all";

export const PL_PERIODS: { key: PLPeriodKey; label: string }[] = [
  { key: "this-month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "this-quarter", label: "This quarter" },
  { key: "this-year", label: "This year" },
  { key: "last-year", label: "Last year" },
  { key: "all", label: "All time" },
];

/**
 * Whole calendar periods, both edges inclusive. Full months rather than
 * month-to-today, so a bill dated the 28th belongs to "this month" on
 * the 5th -- the report answers "how did the month do", not "so far".
 */
export function plPeriodWindow(key: PLPeriodKey, now: Date = new Date()): DateWindow {
  const y = now.getFullYear();
  const m = now.getMonth();
  const endOfMonth = (year: number, month: number) => isoDay(new Date(year, month + 1, 0));
  const startOfMonth = (year: number, month: number) => isoDay(new Date(year, month, 1));
  switch (key) {
    case "this-month":
      return { from: startOfMonth(y, m), to: endOfMonth(y, m) };
    case "last-month":
      return { from: startOfMonth(y, m - 1), to: endOfMonth(y, m - 1) };
    case "this-quarter": {
      const q = Math.floor(m / 3) * 3;
      return { from: startOfMonth(y, q), to: endOfMonth(y, q + 2) };
    }
    case "this-year":
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    case "last-year":
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    default:
      return { from: null, to: null };
  }
}

// ── The report ───────────────────────────────────────────────────────

/** When a bill counts on the accrual basis: the day it was billed. */
function billDay(bill: Pick<PLBill, "bill_date" | "created_at">): string {
  return bill.bill_date ?? bill.created_at;
}

export function profitLoss(
  basis: PLBasis,
  window: DateWindow,
  input: ProfitLossInput
): ProfitLoss {
  const leadOfEstimate = new Map(input.contracts.map((c) => [c.id, c.lead_id]));
  const billById = new Map(input.bills.map((b) => [b.id, b]));

  const income = new Map<string | null, number>();
  const costs = new Map<string | null, number>();
  const add = (map: Map<string | null, number>, leadId: string | null, cents: number) => {
    if (!cents) return;
    map.set(leadId, (map.get(leadId) ?? 0) + cents);
  };

  if (basis === "cash") {
    for (const p of input.payments) {
      if (p.status !== "succeeded") continue;
      if (!withinWindow(p.paid_at ?? p.created_at, window)) continue;
      add(income, p.lead_id ?? leadOfEstimate.get(p.estimate_id) ?? null, p.amount_cents || 0);
    }
    for (const e of input.expenses) {
      if (!withinWindow(e.spent_on, window)) continue;
      add(costs, e.lead_id, e.amount_cents || 0);
    }
  } else {
    for (const c of input.contracts) {
      if (!c.signed_at || !(c.deposit_cents || 0)) continue;
      if (!withinWindow(c.signed_at, window)) continue;
      add(income, c.lead_id, c.deposit_cents || 0);
    }
    for (const ph of input.phases) {
      if (!ph.requested_at) continue;
      if (!withinWindow(ph.requested_at, window)) continue;
      // A phase on a document that is not a signed contract (or change
      // order) has no lead here and is skipped -- nothing was earned.
      const leadId = leadOfEstimate.get(ph.estimate_id);
      if (leadId === undefined) continue;
      add(income, leadId, ph.amount_cents || 0);
    }
    // Receipts are incurred the day the money was spent on either basis;
    // "bill" rows are excluded because the bill itself is counted below.
    for (const e of input.expenses) {
      if (e.source === "bill") continue;
      if (!withinWindow(e.spent_on, window)) continue;
      add(costs, e.lead_id, e.amount_cents || 0);
    }
    for (const b of input.bills) {
      if (!b.lead_id || b.voided_at) continue;
      if (!withinWindow(billDay(b), window)) continue;
      add(costs, b.lead_id, b.amount_cents || 0);
    }
  }

  // Overhead: the no-job bills. Accrual reads the bills as billed; cash
  // reads the payments made against them. A voided bill leaves the
  // accrual reading, but money genuinely paid against it before the void
  // stays on cash -- it left the account either way.
  const overheadMap = new Map<string, PLOverheadLine>();
  const addOverhead = (bill: PLBill, cents: number) => {
    if (!cents) return;
    const key = bill.vendor_id ?? `name:${(bill.vendor_name ?? "").trim().toLowerCase()}`;
    const line =
      overheadMap.get(key) ??
      ({
        vendorId: bill.vendor_id,
        vendorName: bill.vendor_name,
        entries: 0,
        amountCents: 0,
      } as PLOverheadLine);
    line.entries += 1;
    line.amountCents += cents;
    overheadMap.set(key, line);
  };
  if (basis === "cash") {
    for (const bp of input.billPayments) {
      const bill = billById.get(bp.bill_id);
      if (!bill || bill.lead_id) continue;
      if (!withinWindow(bp.paid_on, window)) continue;
      addOverhead(bill, bp.amount_cents || 0);
    }
  } else {
    for (const b of input.bills) {
      if (b.lead_id || b.voided_at) continue;
      if (!withinWindow(billDay(b), window)) continue;
      addOverhead(b, b.amount_cents || 0);
    }
  }

  const jobIds = new Set<string | null>([...income.keys(), ...costs.keys()]);
  const jobs: PLJobLine[] = [...jobIds].map((leadId) => {
    const incomeCents = income.get(leadId) ?? 0;
    const costCents = costs.get(leadId) ?? 0;
    return { leadId, incomeCents, costCents, profitCents: incomeCents - costCents };
  });
  jobs.sort((a, b) => {
    // The unattributed bucket reads as a footnote, so it sits last.
    if ((a.leadId === null) !== (b.leadId === null)) return a.leadId === null ? 1 : -1;
    return b.incomeCents - a.incomeCents || b.costCents - a.costCents;
  });

  const overhead = [...overheadMap.values()].sort((a, b) => b.amountCents - a.amountCents);

  const incomeCents = jobs.reduce((s, j) => s + j.incomeCents, 0);
  const jobCostCents = jobs.reduce((s, j) => s + j.costCents, 0);
  const overheadCents = overhead.reduce((s, o) => s + o.amountCents, 0);
  const grossProfitCents = incomeCents - jobCostCents;
  return {
    incomeCents,
    jobCostCents,
    grossProfitCents,
    overheadCents,
    netProfitCents: grossProfitCents - overheadCents,
    jobs,
    overhead,
  };
}

import type { JobExpense, VendorBill, VendorBillPayment } from "./types.ts";

/**
 * The bill side of "money out", as the newer screens read it. Kept in
 * its own module rather than appended to types.ts (which is large
 * enough that every edit is a risk) -- everything here is additive.
 */

/**
 * A vendor_bills row including the columns migration 0123 adds. They
 * are optional because a database where the migration hasn't run yet
 * still returns the older shape, and every reader copes with that.
 */
export type VendorBillRow = VendorBill & {
  /** The phase of the job this bill is filed to, like a job cost. Null
   *  means "on the job, not filed" (or no job at all). */
  estimate_payment_id?: string | null;
  /** The receipt file behind the bill -- a photo or the vendor's PDF.
   *  Same pair job_expenses carries; copied onto the cost when paid. */
  receipt_url?: string | null;
  receipt_path?: string | null;
};

/**
 * A bill still owed on one job, with what is left on it. What Projects
 * and Job costs show as "unpaid" beside what was actually spent.
 */
export type OpenJobBill = {
  id: string;
  lead_id: string;
  estimate_payment_id: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  reference: string | null;
  amount_cents: number;
  remaining_cents: number;
  bill_date: string | null;
  due_date: string | null;
  scheduled_date: string | null;
  receipt_url: string | null;
  receipt_path: string | null;
};

/** Open bills grouped by the phase they are filed to; null = not filed. */
export function openBillsByPhase(bills: OpenJobBill[]): Map<string | null, OpenJobBill[]> {
  const map = new Map<string | null, OpenJobBill[]>();
  for (const b of bills) {
    const key = b.estimate_payment_id ?? null;
    const list = map.get(key) ?? [];
    list.push(b);
    map.set(key, list);
  }
  return map;
}

/**
 * How a vendor bill gets paid. When QuickBooks sync lands, card is a
 * Credit Card bill payment and everything else a Check-type one out of
 * the chosen bank account, the method written in its memo. The customer side (MANUAL_PAYMENT_METHODS)
 * plus card, because a supply-house counter takes a card and a customer
 * mostly doesn't pay a contractor with one by hand. Stored as-is in
 * vendor_bill_payments.method (migration 0124).
 */
export const BILL_PAYMENT_METHODS = ["check", "card", "cash", "zelle", "ach", "wire", "other"] as const;
export type BillPaymentMethod = (typeof BILL_PAYMENT_METHODS)[number];

export const BILL_PAYMENT_METHOD_LABEL: Record<BillPaymentMethod, string> = {
  check: "Check",
  cash: "Cash",
  zelle: "Zelle",
  card: "Card",
  ach: "ACH / bank transfer",
  wire: "Wire",
  other: "Other",
};

/** The label for a stored method, tolerant of rows saved before 0124. */
export function billPaymentMethodLabel(method: string | null | undefined): string | null {
  if (!method) return null;
  return (BILL_PAYMENT_METHOD_LABEL as Record<string, string>)[method] ?? method;
}

/** What the reference box is called for a given method. */
export function billReferenceLabel(method: BillPaymentMethod): string {
  if (method === "check") return "Check #";
  if (method === "card") return "Last 4 / receipt #";
  if (method === "cash") return "Receipt #";
  return "Confirmation #";
}

/** A vendor_bill_payments row including the method column from 0124. */
export type VendorBillPaymentRow = VendorBillPayment & {
  method?: string | null;
  /** Migration 0176. */
  paid_from_account_id?: string | null;
};

/**
 * The job costs that never were a bill: receipts saved with "Already
 * paid" on (and QuickBooks-synced costs). Bills to Pay's Paid tab lists
 * these beside the paid bills so it holds every dollar paid out on a
 * job. A cost created by paying a bill is left out -- the paid bill is
 * already on the tab, and listing both would count it twice.
 */
export function paidOnEntryReceipts(
  expenses: JobExpense[],
  billPayments: { job_expense_id: string | null }[]
): JobExpense[] {
  const fromBills = new Set(billPayments.map((p) => p.job_expense_id).filter(Boolean));
  return expenses
    .filter((e) => e.source !== "bill" && !fromBills.has(e.id))
    .sort((a, b) => b.spent_on.localeCompare(a.spent_on));
}

/** One payment line on "+ Add bill": a slice of the bill, paid one way. */
export type BillPaymentLine = {
  amountCents: number;
  method: string;
  paidOn: string;
  /** Check number, confirmation, card last four. */
  reference: string;
  /** A payment_accounts row, or "" (none picked / table not there yet). */
  paidFromAccountId: string;
};

/**
 * Checks the payment lines against the bill and says what they add up
 * to. More than the bill is refused -- an overpayment is a mistake here,
 * not a credit. Someone who may not leave a bill owing (Field, at the
 * counter) must cover the whole of it.
 */
export function planBillPayments(
  totalCents: number,
  lines: BillPaymentLine[],
  opts: { allowPartial: boolean }
):
  | { error: string }
  | { status: "full" | "partial"; paidCents: number; leftCents: number } {
  if (lines.length === 0) return { error: "Add at least one payment." };
  for (const l of lines) {
    if (!(Math.round(l.amountCents) > 0)) return { error: "Every payment needs an amount." };
    if (!(BILL_PAYMENT_METHODS as readonly string[]).includes(l.method)) {
      return { error: "Pick how each payment was made." };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(l.paidOn)) return { error: "Every payment needs its date." };
  }
  const paidCents = lines.reduce((s, l) => s + Math.round(l.amountCents), 0);
  if (paidCents > totalCents) {
    return { error: `The payments add up to more than the bill (${(paidCents / 100).toFixed(2)}).` };
  }
  if (paidCents < totalCents && !opts.allowPartial) {
    return { error: "Receipts are paid in full — the payments must add up to the whole bill." };
  }
  return {
    status: paidCents === totalCents ? "full" : "partial",
    paidCents,
    leftCents: totalCents - paidCents,
  };
}

/** A "paid from" account: Chase checking, the Amex card, petty cash. */
export type PaymentAccount = {
  id: string;
  name: string;
  kind: "bank" | "credit_card" | "cash";
  last4: string | null;
  qb_account_id: string | null;
  archived_at: string | null;
};

export const PAYMENT_ACCOUNT_KIND_LABEL: Record<PaymentAccount["kind"], string> = {
  bank: "Bank",
  credit_card: "Credit card",
  cash: "Cash",
};

export function paymentAccountLabel(a: Pick<PaymentAccount, "name" | "last4">): string {
  return a.last4 ? `${a.name} ••${a.last4}` : a.name;
}

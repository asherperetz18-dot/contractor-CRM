import type { VendorBill, VendorBillPayment } from "./types";

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
 * How a vendor bill gets paid. The customer side (MANUAL_PAYMENT_METHODS)
 * plus card, because a supply-house counter takes a card and a customer
 * mostly doesn't pay a contractor with one by hand. Stored as-is in
 * vendor_bill_payments.method (migration 0124).
 */
export const BILL_PAYMENT_METHODS = ["check", "cash", "zelle", "card", "wire", "other"] as const;
export type BillPaymentMethod = (typeof BILL_PAYMENT_METHODS)[number];

export const BILL_PAYMENT_METHOD_LABEL: Record<BillPaymentMethod, string> = {
  check: "Check",
  cash: "Cash",
  zelle: "Zelle",
  card: "Card",
  wire: "Wire / bank transfer",
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
export type VendorBillPaymentRow = VendorBillPayment & { method?: string | null };

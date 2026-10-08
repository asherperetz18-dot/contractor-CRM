/**
 * Where a bill and its payments stand with QuickBooks (DECISIONS #173),
 * as Bills to Pay shows it. Kept apart from bill-sync.ts, which hashes
 * with node:crypto, so the page's browser code can use it. Pure.
 */

export type RecordType = "bill" | "bill_payment";
export type SyncStatus = "sent" | "waiting" | "failed" | "removed";

/** A quickbooks_sync row: what was sent for one bill or payment, to one QuickBooks company. */
export type SyncRecord = {
  record_type: RecordType;
  record_id: string;
  bill_id: string | null;
  qb_id: string | null;
  /** What was last sent or tried, to tell when it changed. */
  qb_hash: string | null;
  status: SyncStatus;
  reason: string | null;
  tries: number;
  next_try_at: string | null;
  sent_at: string | null;
};

/** The day a bill counts from: its bill date, or the day it was entered. */
export function billDay(bill: { billDate: string | null; createdAt: string }): string {
  return bill.billDate ?? bill.createdAt.slice(0, 10);
}

/** Has this record been sent and is it still in QuickBooks? */
export const inQuickBooks = (r: SyncRecord | null | undefined) => !!r?.qb_id && r.status !== "removed";

/** The QuickBooks Online page for a bill (or bill payment), in the right company. */
export function qbWebUrl(environment: "sandbox" | "production", kind: "bill" | "billpayment", txnId: string, realmId: string): string {
  const host = environment === "production" ? "https://app.qbo.intuit.com" : "https://app.sandbox.qbo.intuit.com";
  return `${host}/app/${kind}?txnId=${encodeURIComponent(txnId)}&companyId=${encodeURIComponent(realmId)}`;
}

export type QbChip = { tone: "good" | "wait" | "bad" | "off"; text: string };

/** Where one bill stands with QuickBooks, as Bills to Pay shows it. */
export function billQbChips(p: {
  sending: boolean;
  sendFrom: string | null;
  bill: { billDate: string | null; createdAt: string; voided: boolean };
  billRecord: SyncRecord | null;
  /** The bill's payments in the CRM, each with its record. */
  payments: { id: string; record: SyncRecord | null }[];
  day: (iso: string) => string;
}): { chips: QbChip[]; qbId: string | null } {
  const r = p.billRecord;
  const qbId = inQuickBooks(r) ? r!.qb_id : null;
  if (p.bill.voided) {
    if (!r) return { chips: [], qbId: null };
    if (r.status === "removed") return { chips: [{ tone: "off", text: "Removed from QuickBooks" }], qbId: null };
    if (r.status === "failed" && r.qb_id) return { chips: [{ tone: "bad", text: `Couldn't remove from QuickBooks: ${r.reason ?? ""}`.trim() }], qbId };
    if (r.qb_id) return { chips: [{ tone: "off", text: "Being removed from QuickBooks" }], qbId };
    return { chips: [], qbId: null };
  }
  if (!r || r.status === "removed") {
    if (!p.sending || !p.sendFrom) return { chips: [], qbId: null };
    if (billDay(p.bill) < p.sendFrom) return { chips: [{ tone: "off", text: `Before ${p.day(p.sendFrom)}: not sent` }], qbId: null };
    return { chips: [{ tone: "off", text: "Goes to QuickBooks in a few minutes" }], qbId: null };
  }
  if (r.status === "waiting") return { chips: [{ tone: "wait", text: `Waiting: ${r.reason ?? ""}`.trim() }], qbId };
  if (r.status === "failed") {
    return {
      chips: [{ tone: "bad", text: r.qb_id ? `In QuickBooks, but the last change didn't go: ${r.reason ?? ""}` : `Didn't go to QuickBooks: ${r.reason ?? ""}` }],
      qbId,
    };
  }
  // Sent. Every payment too?
  const open = p.payments.filter((x) => !inQuickBooks(x.record));
  if (!open.length) {
    const what = p.payments.length === 0 ? "Bill" : p.payments.length === 1 ? "Bill and payment" : `Bill and ${p.payments.length} payments`;
    return { chips: [{ tone: "good", text: `✓ In QuickBooks · ${what}${r.sent_at ? ` · ${p.day(r.sent_at)}` : ""}` }], qbId };
  }
  const first = open[0].record;
  const chip: QbChip =
    !first || (first.status !== "waiting" && first.status !== "failed")
      ? { tone: "off", text: "Payment goes in a few minutes" }
      : first.status === "failed"
        ? { tone: "bad", text: `Payment didn't go: ${first.reason ?? ""}`.trim() }
        : { tone: "wait", text: `Payment waiting: ${first.reason ?? ""}`.trim() };
  return { chips: [{ tone: "good", text: "✓ Bill in QuickBooks" }, chip], qbId };
}

/** One payment's line on Bills to Pay: "in QuickBooks", or why not. */
export function paymentQbNote(record: SyncRecord | null): string | null {
  if (!record) return null;
  if (inQuickBooks(record)) return "in QuickBooks";
  if (record.status === "waiting") return `waiting for QuickBooks: ${record.reason ?? ""}`.trim();
  if (record.status === "failed") return `didn't go to QuickBooks: ${record.reason ?? ""}`.trim();
  return null;
}

/** What Bills to Pay knows about QuickBooks: null when it was never connected. */
export type BillsQuickBooks = {
  /** Sending is on, and QuickBooks is connected. */
  sending: boolean;
  sendFrom: string | null;
  environment: "sandbox" | "production";
  realmId: string;
  /** This company's records for the connected QuickBooks company. */
  records: SyncRecord[];
};

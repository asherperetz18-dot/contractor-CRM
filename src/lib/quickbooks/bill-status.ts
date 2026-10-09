/**
 * Where a bill and its payments stand with QuickBooks (DECISIONS #173),
 * as Bills to Pay shows it. Kept apart from bill-sync.ts, which hashes
 * with node:crypto, so the page's browser code can use it. Pure.
 */

/**
 * A bill, a payment on it, or its receipt (one per bill, keyed by the
 * bill's id) -- and from step 3 (DECISIONS #183) a customer, a job, an
 * invoice (a billed stage or an issued invoice, keyed by its stage), a
 * deposit invoice (keyed by its contract), a customer payment, a credit
 * and the $0.00 payment that applies it, and a refund.
 */
export type RecordType =
  | "bill"
  | "bill_payment"
  | "receipt"
  | "customer"
  | "job"
  | "invoice"
  | "deposit"
  | "customer_payment"
  | "credit"
  | "credit_link"
  | "refund";
/**
 * sent: in QuickBooks as the CRM has it. waiting: can't go yet, or its
 * last change can't. failed: QuickBooks refused it, or its last change.
 * removed: voided or deleted in QuickBooks after the CRM voided or deleted
 * it. gone: someone deleted it in QuickBooks, so the CRM leaves it alone.
 */
export type SyncStatus = "sent" | "waiting" | "failed" | "removed" | "gone";

/** A request the CRM sent without learning whether QuickBooks saved it:
 *  repeated as is (same request id) before anything else happens to it. */
export type InDoubt = { requestId: string; body: unknown; hash: string };

/** A quickbooks_sync row: what was sent for one bill or payment, to one QuickBooks company. */
export type SyncRecord = {
  record_type: RecordType;
  record_id: string;
  bill_id: string | null;
  qb_id: string | null;
  /** What QuickBooks has: the hash of the last version that went. */
  qb_hash: string | null;
  /** The last version that didn't go (waiting or refused), to tell when it changes. */
  tried_hash: string | null;
  doubt: InDoubt | null;
  status: SyncStatus;
  /** Which step QuickBooks refused, while status is failed: adding it, a change, or removing it. */
  failed_op: "add" | "change" | "remove" | null;
  reason: string | null;
  tries: number;
  next_try_at: string | null;
  sent_at: string | null;
};

/** What Bills to Pay needs of a record. */
export type ChipRecord = Pick<SyncRecord, "record_type" | "record_id" | "bill_id" | "qb_id" | "status" | "failed_op" | "reason" | "sent_at">;

/** The day a bill counts from: its bill date, or the day it was entered. */
export function billDay(bill: { billDate: string | null; createdAt: string }): string {
  return bill.billDate ?? bill.createdAt.slice(0, 10);
}

/** Has this record been sent, and is it still in QuickBooks for the CRM to look after? */
export const inQuickBooks = (r: Pick<SyncRecord, "qb_id" | "status"> | null | undefined) =>
  !!r?.qb_id && r.status !== "removed" && r.status !== "gone";

/** The QuickBooks Online page for a bill (or bill payment), in the right company. */
export function qbWebUrl(environment: "sandbox" | "production", kind: "bill" | "billpayment" | "invoice", txnId: string, realmId: string): string {
  const host = environment === "production" ? "https://app.qbo.intuit.com" : "https://app.sandbox.qbo.intuit.com";
  return `${host}/app/${kind}?txnId=${encodeURIComponent(txnId)}&companyId=${encodeURIComponent(realmId)}`;
}

export type QbChip = { tone: "good" | "wait" | "bad" | "off"; text: string };

/** How a receipt whose upload got no answer reads while QuickBooks won't say whether it has it. */
export const LOOKUP_FAILED = "Couldn't check whether QuickBooks got it.";

const OFF = "sending to QuickBooks is off";

/** Where one bill stands with QuickBooks, as Bills to Pay shows it. */
export function billQbChips(p: {
  /** Sending is on and QuickBooks is connected: pending things will go. */
  sending: boolean;
  sendFrom: string | null;
  bill: { billDate: string | null; createdAt: string; voided: boolean };
  billRecord: ChipRecord | null;
  /** The bill's payments in the CRM, each with its record. */
  payments: { id: string; record: ChipRecord | null }[];
  /** Whether the bill has a receipt in the CRM, and its record (DECISIONS #174). */
  receipt?: { has: boolean; record: ChipRecord | null };
  /** Every other record of the bill (its payments, deleted ones too, and its receipt). */
  related?: ChipRecord[];
  day: (iso: string) => string;
}): { chips: QbChip[]; qbId: string | null } {
  const r = p.billRecord;
  const qbId = inQuickBooks(r) ? r!.qb_id : null;
  const why = (x: ChipRecord) => (x.reason ? `: ${x.reason}` : "");
  if (r?.status === "gone") return { chips: [{ tone: "off", text: "Deleted in QuickBooks, so the CRM doesn't send it again" }], qbId: null };
  if (p.bill.voided) {
    if (!r || !inQuickBooks(r)) return { chips: r?.status === "removed" ? [{ tone: "off", text: "Removed from QuickBooks" }] : [], qbId: null };
    if (!p.sending) return { chips: [{ tone: "wait", text: `Still in QuickBooks: ${OFF}` }], qbId };
    if (r.status === "failed" && r.failed_op === "remove") return { chips: [{ tone: "bad", text: `Couldn't remove from QuickBooks${why(r)}` }], qbId };
    // A payment's void or the receipt's removal QuickBooks refused holds the bill back.
    const stuck = (p.related ?? []).find((x) => inQuickBooks(x) && x.status === "failed" && x.failed_op === "remove");
    if (stuck) {
      const what = stuck.record_type === "receipt" ? "its receipt" : "a payment on it";
      const said = (stuck.reason ?? "").replace(/^Couldn't \w+ it in QuickBooks\.\s*/, "");
      return { chips: [{ tone: "bad", text: `Couldn't remove from QuickBooks: ${what} can't be taken off first.${said ? ` ${said}` : ""}` }], qbId };
    }
    // A receipt whose upload got no answer, and QuickBooks won't say whether it has it.
    const unsure = (p.related ?? []).find((x) => x.status === "waiting" && !!x.reason?.startsWith(LOOKUP_FAILED));
    if (unsure) {
      const said = unsure.reason!.slice(LOOKUP_FAILED.length).trim();
      return {
        chips: [{ tone: "bad", text: `Couldn't remove from QuickBooks yet: its receipt may be on it, and QuickBooks won't say.${said ? ` ${said}` : ""}` }],
        qbId,
      };
    }
    return { chips: [{ tone: "off", text: "Being removed from QuickBooks" }], qbId };
  }
  if (!r || !inQuickBooks(r)) {
    if (!p.sending) return { chips: r && r.status !== "removed" ? [{ tone: "off", text: `Not sent: ${OFF}` }] : [], qbId: null };
    if (r?.status === "waiting") return { chips: [{ tone: "wait", text: `Waiting${why(r)}` }], qbId: null };
    if (r?.status === "failed") return { chips: [{ tone: "bad", text: `Didn't go to QuickBooks${why(r)}` }], qbId: null };
    if (!p.sendFrom) return { chips: [], qbId: null };
    if (billDay(p.bill) < p.sendFrom) return { chips: [{ tone: "off", text: `Before ${p.day(p.sendFrom)}: not sent` }], qbId: null };
    return { chips: [{ tone: "off", text: "Goes to QuickBooks in a few minutes" }], qbId: null };
  }
  // In QuickBooks. Did its last change go?
  if (r.status === "failed") return { chips: [{ tone: "bad", text: `In QuickBooks, but the last change didn't go${why(r)}` }], qbId };
  if (r.status === "waiting") return { chips: [{ tone: "wait", text: `In QuickBooks; the last change waits${why(r)}` }], qbId };
  // Every payment, and the receipt, too?
  const open = p.payments.filter((x) => !inQuickBooks(x.record));
  const rr = p.receipt?.has ? p.receipt.record : null;
  const receiptOpen = !!p.receipt?.has && (!inQuickBooks(rr) || rr!.status === "failed" || rr!.status === "waiting");
  if (!open.length && !receiptOpen) {
    const parts = [
      "Bill",
      ...(p.payments.length === 1 ? ["payment"] : p.payments.length > 1 ? [`${p.payments.length} payments`] : []),
      ...(p.receipt?.has ? ["receipt"] : []),
    ];
    const what = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
    return { chips: [{ tone: "good", text: `✓ In QuickBooks · ${what}${r.sent_at ? ` · ${p.day(r.sent_at)}` : ""}` }], qbId };
  }
  const chips: QbChip[] = [{ tone: "good", text: "✓ Bill in QuickBooks" }];
  const pending = (label: string, x: ChipRecord | null): QbChip =>
    !p.sending
      ? { tone: "off", text: `${label} not sent: ${OFF}` }
      : x?.status === "failed"
        ? { tone: "bad", text: `${label} didn't go${why(x)}` }
        : x?.status === "waiting"
          ? { tone: "wait", text: `${label} waiting${why(x)}` }
          : { tone: "off", text: `${label} goes in a few minutes` };
  if (open.length) chips.push(pending("Payment", open[0].record));
  if (receiptOpen) chips.push(pending("Receipt", rr));
  return { chips, qbId };
}

/** One payment's line on Bills to Pay: "in QuickBooks", or why not. */
export function paymentQbNote(record: ChipRecord | null): string | null {
  if (!record) return null;
  if (inQuickBooks(record) && record.status === "sent") return "in QuickBooks";
  if (record.status === "waiting") return `waiting for QuickBooks${record.reason ? `: ${record.reason}` : ""}`;
  if (record.status === "failed") return `didn't go to QuickBooks${record.reason ? `: ${record.reason}` : ""}`;
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
  records: ChipRecord[];
  /** 0223 has run: receipts go with their bills (DECISIONS #174). */
  receipts: boolean;
};

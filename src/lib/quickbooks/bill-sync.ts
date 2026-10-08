import { createHash } from "node:crypto";
import { categoryKey } from "./accounts.ts";
import { billPaymentMethodLabel } from "../data/bills.ts";
import type { QbBillBody, QbBillPaymentBody } from "./api.ts";
import { billDay, inQuickBooks, type RecordType, type SyncRecord } from "./bill-status.ts";

export {
  billDay,
  billQbChips,
  inQuickBooks,
  paymentQbNote,
  qbWebUrl,
  type QbChip,
  type RecordType,
  type SyncRecord,
  type SyncStatus,
} from "./bill-status.ts";

/**
 * QuickBooks, step 2 (DECISIONS #173): which bills and bill payments go
 * to QuickBooks, which change there, which come out, and which wait. Pure:
 * the runner (bill-sync-run.ts) reads the rows, asks this what to do,
 * then does it.
 *
 * - A bill goes once its date is on or after the company's start date
 *   (no bill date: the day it was entered). Once sent it follows its
 *   changes even if its date moves earlier.
 * - A change QuickBooks would show (vendor, amount, dates, what for, the
 *   job) is sent again; the CRM's planned pay date isn't in QuickBooks.
 * - A bill voided in the CRM is deleted in QuickBooks (QuickBooks has no
 *   void for bills), after its payments there are voided. A payment
 *   deleted in the CRM is voided in QuickBooks. Only what the CRM sent is
 *   ever changed; what someone typed in QuickBooks is never touched.
 * - What can't go yet waits with a reason, and goes on its own once fixed.
 *   What QuickBooks refused is tried again later (backing off), or at once
 *   when it changes in the CRM.
 */

export type SyncBill = {
  id: string;
  vendorName: string | null;
  /** The vendor's usual expense category, when the bill names a vendor record. */
  vendorCategory: string | null;
  reference: string | null;
  amountCents: number;
  billDate: string | null;
  dueDate: string | null;
  createdAt: string;
  voided: boolean;
  /** The job, as the memo reads: billMemo(). */
  memo: string;
};

export type SyncPayment = {
  id: string;
  billId: string;
  amountCents: number;
  paidOn: string;
  method: string | null;
  reference: string | null;
  note: string | null;
  createdAt: string;
  account: { id: string; name: string; kind: string; qbAccountId: string | null } | null;
};

// ---------------------------------------------------------------- text

/** Typed characters QuickBooks' US companies don't take, as the plain ones they mean. */
const PLAIN: Record<string, string> = { "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", "…": "..." };

/** Text as QuickBooks takes it: Latin-1 only (an emoji is dropped), at most `max` long. */
export function qbText(value: string | null | undefined, max: number): string {
  let out = "";
  for (const ch of (value ?? "").normalize("NFC")) {
    const plain = PLAIN[ch] ?? ch;
    if ([...plain].every((c) => (c.codePointAt(0) ?? 0) <= 0xff)) out += plain;
  }
  return out.trim().slice(0, max);
}

/** A vendor's name as QuickBooks allows it: no colon, tab or new line, at most 500 long. */
export function qbVendorName(value: string | null | undefined): string {
  const cleaned = qbText((value ?? "").replace(/[\t\r\n]/g, " ").replace(/:/g, " - "), 2000).replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 500).trim();
}

/** "EST-1047 · Maria Lopez · Kitchen remodel"; a bill with no job says so. */
export function billMemo(p: { docNumber: string | null; customer: string | null; title: string | null }): string {
  const parts = [p.docNumber, p.customer, p.title].map((s) => (s ?? "").trim()).filter(Boolean);
  return parts.length ? parts.join(" · ") : "No job (overhead)";
}

const dollars = (cents: number) => Math.round(cents) / 100;

// ---------------------------------------------------------------- what is sent

export function billBody(bill: SyncBill, ref: { vendorId: string; accountId: string }): QbBillBody {
  const description = qbText(bill.reference, 4000);
  return {
    VendorRef: { value: ref.vendorId },
    TxnDate: billDay(bill),
    ...(bill.dueDate ? { DueDate: bill.dueDate } : {}),
    PrivateNote: qbText(bill.memo, 4000),
    Line: [
      {
        DetailType: "AccountBasedExpenseLineDetail",
        Amount: dollars(bill.amountCents),
        ...(description ? { Description: description } : {}),
        AccountBasedExpenseLineDetail: { AccountRef: { value: ref.accountId } },
      },
    ],
  };
}

/**
 * A payment as QuickBooks takes it. The paid-from account's kind decides:
 * a credit card account pays by card; a bank account or cash pays as a
 * check-type payment from it (the method, Zelle or ACH, goes in the memo).
 * Callers check the account is matched first (planBillSync).
 */
export function billPaymentBody(payment: SyncPayment, ref: { vendorId: string; billQbId: string }): QbBillPaymentBody {
  const account = payment.account!;
  const amount = dollars(payment.amountCents);
  const reference = qbText(payment.reference, 100);
  const note = [billPaymentMethodLabel(payment.method), reference ? `ref ${reference}` : null, qbText(payment.note, 1000) || null]
    .filter(Boolean)
    .join(" · ");
  const isCheck = payment.method === "check";
  return {
    VendorRef: { value: ref.vendorId },
    ...(account.kind === "credit_card"
      ? { PayType: "CreditCard" as const, CreditCardPayment: { CCAccountRef: { value: account.qbAccountId! } } }
      : {
          PayType: "Check" as const,
          // Already paid: not put in QuickBooks' queue of checks to print.
          CheckPayment: { BankAccountRef: { value: account.qbAccountId! }, PrintStatus: isCheck ? ("PrintComplete" as const) : ("NotSet" as const) },
        }),
    TotalAmt: amount,
    TxnDate: payment.paidOn,
    ...(isCheck && reference ? { DocNumber: reference.slice(0, 21) } : {}),
    ...(note ? { PrivateNote: note } : {}),
    Line: [{ Amount: amount, LinkedTxn: [{ TxnId: ref.billQbId, TxnType: "Bill" as const }] }],
  };
}

const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** What QuickBooks would show of a bill: a change here is sent again. */
export function billHash(bill: SyncBill): string {
  return sha([
    "bill",
    qbVendorName(bill.vendorName),
    bill.amountCents,
    billDay(bill),
    bill.dueDate,
    qbText(bill.reference, 4000),
    qbText(bill.memo, 4000),
  ]);
}

export function paymentHash(payment: SyncPayment): string {
  return sha([
    "payment",
    payment.amountCents,
    payment.paidOn,
    payment.method,
    payment.reference,
    payment.note,
    payment.account?.id ?? null,
    payment.account?.qbAccountId ?? null,
  ]);
}

/**
 * The request id for one write: the same for a repeat of the same write
 * (QuickBooks then answers it without doing it twice), new after a try
 * QuickBooks refused. At most 50 characters.
 */
export function qbRequestId(parts: (string | number | null)[]): string {
  return `crm-${sha(parts).slice(0, 40)}`;
}

/**
 * The request id for adding a bill or payment. A retry of the same try is
 * the same id, so QuickBooks never adds it twice. A new try after a refusal
 * (tries), or adding it again after it was removed (its last sent time),
 * is a new id -- else QuickBooks would answer with the first, deleted one.
 */
export function qbCreateRequestId(
  scope: { companyId: string; realmId: string },
  type: RecordType,
  recordId: string,
  hash: string,
  record: Pick<SyncRecord, "tries" | "sent_at"> | null
): string {
  return qbRequestId([scope.companyId, scope.realmId, type, recordId, "create", hash, record?.tries ?? 0, record?.sent_at ?? null]);
}

export const BACKOFF_MINUTES = [15, 60, 240, 720, 1440];

/** When to try again after the `tries`-th refusal. */
export function nextTryAt(tries: number, now: Date): string {
  const minutes = BACKOFF_MINUTES[Math.min(Math.max(tries, 1), BACKOFF_MINUTES.length) - 1];
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

// ---------------------------------------------------------------- the plan

export type SyncStep =
  | { op: "void_payment"; recordId: string; record: SyncRecord }
  | { op: "delete_bill"; recordId: string; record: SyncRecord }
  | { op: "drop"; recordType: RecordType; recordId: string }
  | { op: "wait"; recordType: RecordType; recordId: string; billId: string; reason: string; hash: string }
  | { op: "create_bill" | "update_bill"; recordId: string; bill: SyncBill; hash: string; accountId: string; record: SyncRecord | null }
  | { op: "create_payment"; recordId: string; payment: SyncPayment; hash: string; record: SyncRecord | null };

export const WAIT = {
  noVendor: "This bill has no vendor.",
  noAccount: "No QuickBooks account for its cost yet. Match a QuickBooks account for job costs in Settings › QuickBooks.",
  noPaidFrom: 'No "Paid from" account on this payment. Delete it and record it again with one.',
  unmatched: (name: string) => `"${name}" isn't matched to a QuickBooks account yet. Match it in Settings › QuickBooks.`,
  overpaid: "This payment is more than what's left on the bill.",
  billFirst: "Waits for its bill to go to QuickBooks first.",
};

/** A record QuickBooks refused (or couldn't be asked about) that isn't due another try yet. */
function resting(record: SyncRecord | null, hash: string, now: Date, force: boolean): boolean {
  if (force || !record || record.status === "sent" || record.status === "removed") return false;
  if (record.qb_hash !== hash) return false;
  return !!record.next_try_at && new Date(record.next_try_at).getTime() > now.getTime();
}

export function planBillSync(p: {
  bills: SyncBill[];
  payments: SyncPayment[];
  /** This company's records for the connected QuickBooks company. */
  records: SyncRecord[];
  sendFrom: string;
  now: Date;
  /** Expense account per category key, and the default (quickbooks_expense_accounts). */
  accounts: { byCategory: Map<string, string>; fallback: string | null };
  /** Send now: everything due is tried, refusals included. */
  force?: boolean;
}): SyncStep[] {
  const force = !!p.force;
  const recordOf = new Map(p.records.map((r) => [`${r.record_type}:${r.record_id}`, r]));
  const billRecord = (id: string) => recordOf.get(`bill:${id}`) ?? null;
  const paymentRecord = (id: string) => recordOf.get(`bill_payment:${id}`) ?? null;
  const billsById = new Map(p.bills.map((b) => [b.id, b]));
  const paymentIds = new Set(p.payments.map((x) => x.id));

  const voids: SyncStep[] = [];
  const deletes: SyncStep[] = [];
  const drops: SyncStep[] = [];
  const work: SyncStep[] = [];
  const voided = new Set<string>();

  // A removal QuickBooks refused (a closed month, say) waits its turn too.
  const removalResting = (r: SyncRecord) =>
    !force && r.status === "failed" && !!r.next_try_at && new Date(r.next_try_at).getTime() > p.now.getTime();
  const voidPayment = (r: SyncRecord) => {
    if (voided.has(r.record_id)) return;
    voided.add(r.record_id);
    if (!removalResting(r)) voids.push({ op: "void_payment", recordId: r.record_id, record: r });
  };
  const deleteBill = (r: SyncRecord) => {
    if (!removalResting(r)) deletes.push({ op: "delete_bill", recordId: r.record_id, record: r });
  };
  const wait = (recordType: RecordType, recordId: string, billId: string, reason: string, hash: string) => {
    const r = recordOf.get(`${recordType}:${recordId}`);
    // Already noted, the same way: nothing to write.
    if (r && r.status === "waiting" && r.reason === reason && !r.qb_id) return;
    work.push({ op: "wait", recordType, recordId, billId, reason, hash });
  };

  // Payments gone from the CRM: voided in QuickBooks if they went, else forgotten.
  for (const r of p.records) {
    if (r.record_type !== "bill_payment" || paymentIds.has(r.record_id)) continue;
    if (inQuickBooks(r)) voidPayment(r);
    else if (r.status !== "removed") drops.push({ op: "drop", recordType: "bill_payment", recordId: r.record_id });
  }

  // Bills gone from the CRM altogether: as if voided.
  for (const r of p.records) {
    if (r.record_type !== "bill" || billsById.has(r.record_id)) continue;
    if (inQuickBooks(r)) {
      for (const pr of p.records) if (pr.record_type === "bill_payment" && pr.bill_id === r.record_id && inQuickBooks(pr)) voidPayment(pr);
      deleteBill(r);
    } else if (r.status !== "removed") drops.push({ op: "drop", recordType: "bill", recordId: r.record_id });
  }

  const paymentsByBill = new Map<string, SyncPayment[]>();
  for (const pay of p.payments) {
    const list = paymentsByBill.get(pay.billId) ?? [];
    list.push(pay);
    paymentsByBill.set(pay.billId, list);
  }

  for (const bill of p.bills) {
    const rec = billRecord(bill.id);
    const pays = (paymentsByBill.get(bill.id) ?? []).sort(
      (a, b) => a.paidOn.localeCompare(b.paidOn) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
    );

    if (bill.voided) {
      if (inQuickBooks(rec)) {
        for (const pay of pays) if (inQuickBooks(paymentRecord(pay.id))) voidPayment(paymentRecord(pay.id)!);
        for (const pr of p.records) if (pr.record_type === "bill_payment" && pr.bill_id === bill.id && inQuickBooks(pr)) voidPayment(pr);
        deleteBill(rec!);
      } else if (rec && rec.status !== "removed") {
        drops.push({ op: "drop", recordType: "bill", recordId: bill.id });
      }
      for (const pay of pays) {
        const pr = paymentRecord(pay.id);
        if (pr && !inQuickBooks(pr) && pr.status !== "removed") drops.push({ op: "drop", recordType: "bill_payment", recordId: pay.id });
      }
      continue;
    }

    const tracked = inQuickBooks(rec);
    if (!tracked && billDay(bill) < p.sendFrom) {
      // Moved before the start date before it ever went: it stays out.
      if (rec && rec.status !== "removed") drops.push({ op: "drop", recordType: "bill", recordId: bill.id });
      for (const pay of pays) {
        const pr = paymentRecord(pay.id);
        if (pr && !inQuickBooks(pr) && pr.status !== "removed") drops.push({ op: "drop", recordType: "bill_payment", recordId: pay.id });
      }
      continue;
    }

    const hash = billHash(bill);
    const accountId = p.accounts.byCategory.get(categoryKey(bill.vendorCategory ?? "")) ?? p.accounts.fallback;
    // Will the bill be in QuickBooks, as of this run, for its payments to link to?
    let billGoes = tracked;
    if (!qbVendorName(bill.vendorName)) {
      if (!tracked) wait("bill", bill.id, bill.id, WAIT.noVendor, hash);
    } else if (!accountId) {
      if (!tracked) wait("bill", bill.id, bill.id, WAIT.noAccount, hash);
    } else if (!tracked) {
      if (!resting(rec, hash, p.now, force)) {
        work.push({ op: "create_bill", recordId: bill.id, bill, hash, accountId, record: rec });
        billGoes = true;
      }
    } else if (rec!.qb_hash !== hash && !resting(rec, hash, p.now, force)) {
      work.push({ op: "update_bill", recordId: bill.id, bill, hash, accountId, record: rec });
    }

    let paid = 0;
    for (const pay of pays) {
      paid += pay.amountCents;
      const pr = paymentRecord(pay.id);
      if (inQuickBooks(pr)) continue;
      const pHash = paymentHash(pay);
      if (paid > bill.amountCents) wait("bill_payment", pay.id, bill.id, WAIT.overpaid, pHash);
      else if (!pay.account) wait("bill_payment", pay.id, bill.id, WAIT.noPaidFrom, pHash);
      else if (!pay.account.qbAccountId) wait("bill_payment", pay.id, bill.id, WAIT.unmatched(pay.account.name), pHash);
      else if (!billGoes) wait("bill_payment", pay.id, bill.id, WAIT.billFirst, pHash);
      else if (!resting(pr, pHash, p.now, force)) work.push({ op: "create_payment", recordId: pay.id, payment: pay, hash: pHash, record: pr });
    }
  }

  return [...voids, ...deletes, ...drops, ...work];
}


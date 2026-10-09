import { createHash, randomUUID } from "node:crypto";
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
  type ChipRecord,
  type InDoubt,
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
 *   job) is sent again, as a change to the same bill: what the bookkeeper
 *   set on it there (account, class, customer, terms) is left alone. The
 *   CRM's planned pay date isn't in QuickBooks.
 * - A bill voided in the CRM is deleted in QuickBooks (QuickBooks has no
 *   void for bills), after its payments there are voided. A payment
 *   deleted in the CRM is voided in QuickBooks. Only what the CRM sent is
 *   ever changed; what someone typed in QuickBooks is never touched.
 * - What can't go yet waits with a reason, and goes on its own once fixed.
 *   What QuickBooks refused is tried again later (backing off), or at once
 *   when it changes in the CRM, or on Send now.
 * - Never twice: before adding a bill or payment the runner writes down the
 *   exact request, with a new request id; if the answer never comes, the
 *   next run repeats that request (same id), which QuickBooks answers
 *   without adding it again, before anything else is done to it.
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
  /** The receipt file in storage (vendor_bills.receipt_path), if any. */
  receiptPath: string | null;
  /** The QuickBooks job (or customer) the bill's line is tagged with, once step 3 has added it (DECISIONS #184). */
  tag?: string | null;
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
  account: {
    id: string;
    name: string;
    kind: string;
    qbAccountId: string | null;
    /** The matched QuickBooks account's type ("Bank", "Credit Card"), when known. */
    qbType: string | null;
  } | null;
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

// ---------------------------------------------------------------- receipts (DECISIONS #174)

/** The kinds of file QuickBooks takes as an attachment that a receipt can be. */
const RECEIPT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  tif: "image/tiff",
  tiff: "image/tiff",
  pdf: "application/pdf",
};

/** Kinds of photo a phone may take that QuickBooks doesn't. */
const PHOTO_TYPES = new Set(["heic", "heif", "webp", "avif", "bmp"]);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A bill's receipt as QuickBooks will hold it: "Receipt · Contractor
 * Warehouse · Oct 7.jpg", with its type. A kind of file QuickBooks doesn't
 * take, or one kept in Google Drive, waits instead, saying why.
 */
export function receiptFile(path: string, vendorName: string | null, day: string): { file: { fileName: string; contentType: string } } | { wait: string } {
  if (!path.startsWith("receipts/")) {
    return { wait: "This receipt is kept in Google Drive, so it can't be attached in QuickBooks. Attach the file to the bill instead." };
  }
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  const contentType = RECEIPT_TYPES[ext];
  if (!contentType) {
    return {
      wait: ext
        ? `QuickBooks doesn't take .${ext} ${PHOTO_TYPES.has(ext) ? "photos" : "files"}. Attach it again as a JPG, PNG or PDF.`
        : "QuickBooks doesn't take this kind of file. Attach it again as a JPG, PNG or PDF.",
    };
  }
  const [, m, d] = day.split("-").map(Number);
  const when = m && d ? `${MONTHS[m - 1]} ${d}` : day;
  const vendor = qbVendorName(vendorName) || "Bill";
  return { file: { fileName: qbText(`Receipt · ${vendor} · ${when}.${ext}`, 1000), contentType } };
}

/** Which receipt went: a different file (replaced in the CRM) is sent again. */
export function receiptHash(path: string): string {
  return sha(["receipt", path]);
}

/** "EST-1047 · Maria Lopez · Kitchen remodel"; a bill with no job says so. */
export function billMemo(p: { docNumber: string | null; customer: string | null; title: string | null }): string {
  const parts = [p.docNumber, p.customer, p.title].map((s) => (s ?? "").trim()).filter(Boolean);
  return parts.length ? parts.join(" · ") : "No job (overhead)";
}

const dollars = (cents: number) => Math.round(cents) / 100;

// ---------------------------------------------------------------- what is sent

/** Tags a bill's line with its job: not billable, since the CRM bills its own costs back. */
const jobTag = (tag: string | null | undefined) => (tag ? { CustomerRef: { value: tag }, BillableStatus: "NotBillable" as const } : {});

/** A new bill. With no due date in the CRM it's due on its bill date. */
export function billBody(bill: SyncBill, ref: { vendorId: string; accountId: string }): QbBillBody {
  const description = qbText(bill.reference, 4000);
  return {
    VendorRef: { value: ref.vendorId },
    TxnDate: billDay(bill),
    DueDate: bill.dueDate ?? billDay(bill),
    PrivateNote: qbText(bill.memo, 4000),
    Line: [
      {
        DetailType: "AccountBasedExpenseLineDetail",
        Amount: dollars(bill.amountCents),
        ...(description ? { Description: description } : {}),
        AccountBasedExpenseLineDetail: { AccountRef: { value: ref.accountId }, ...jobTag(bill.tag) },
      },
    ],
  };
}

/**
 * Moving a bill's job on its lines. The job goes on a line with no customer,
 * or one carrying the tag the CRM itself last sent on this bill (`lastTag`),
 * and comes off it when the bill leaves the job. Any other customer on a line
 * -- even one the CRM also knows -- is the bookkeeper's, and stays.
 */
function lineTags(bill: SyncBill, lastTag: string | null) {
  const detailOf = (l: Record<string, unknown>) => (l.AccountBasedExpenseLineDetail ?? {}) as Record<string, unknown>;
  const tagOn = (l: Record<string, unknown>) => {
    const value = (detailOf(l).CustomerRef as { value?: unknown } | undefined)?.value;
    return value == null ? "" : String(value);
  };
  const retag = (l: Record<string, unknown>) =>
    l.DetailType === "AccountBasedExpenseLineDetail" && (tagOn(l) === "" || (!!lastTag && tagOn(l) === lastTag)) && tagOn(l) !== (bill.tag ?? "");
  const tagged = (l: Record<string, unknown>) => {
    if (!retag(l)) return l;
    const { CustomerRef: _ref, BillableStatus: _billable, ...detail } = detailOf(l);
    return { ...l, AccountBasedExpenseLineDetail: { ...detail, ...jobTag(bill.tag) } };
  };
  return { retag, tagged };
}

/** The tag the CRM last sent on a bill, kept in its hash (none before step 3). */
export function lastSentTag(hash: string | null | undefined): string | null {
  return hash?.split(JOB_HASH)[1] ?? null;
}

/**
 * Only the job changed: a sparse change naming just the lines (and the vendor
 * QuickBooks has), so the dates, memo and amounts stay as QuickBooks has them
 * -- a bookkeeper's fixes included. Null when no line is the CRM's to move.
 */
export function billRetagBody(bill: SyncBill, current: QbBillNow, lastTag: string | null): Record<string, unknown> | null {
  const { retag, tagged } = lineTags(bill, lastTag);
  if (!current.lines.some(retag)) return null;
  return {
    Id: current.id,
    SyncToken: current.syncToken,
    sparse: true,
    ...(current.vendorRef ? { VendorRef: current.vendorRef } : {}),
    Line: current.lines.map(tagged),
  };
}

/** A bill as QuickBooks has it now: what a change must name and keep. */
export type QbBillNow = { id: string; syncToken: string; lines: Record<string, unknown>[]; vendorRef?: unknown };

/**
 * A change to a bill already in QuickBooks, sparse: the vendor, dates and
 * memo, and -- only when they changed -- the line's amount and description.
 * Everything else on the line (its account, a class or customer the
 * bookkeeper added) is sent back as QuickBooks has it, so it stays. A bill
 * the bookkeeper split into several lines keeps its lines; if its total
 * no longer matches, the change waits for them.
 */
export function billUpdateBody(
  bill: SyncBill,
  current: QbBillNow,
  ref: { vendorId: string; lastTag?: string | null }
): { body: Record<string, unknown> } | { wait: string } {
  const amount = dollars(bill.amountCents);
  const description = qbText(bill.reference, 4000);
  const header = {
    Id: current.id,
    SyncToken: current.syncToken,
    sparse: true,
    VendorRef: { value: ref.vendorId },
    TxnDate: billDay(bill),
    DueDate: bill.dueDate ?? billDay(bill),
    PrivateNote: qbText(bill.memo, 4000),
  };
  const { retag, tagged } = lineTags(bill, ref.lastTag ?? null);
  const lines = current.lines;
  const near = (a: unknown, b: number) => Math.abs((Number(a) || 0) - b) < 0.005;
  if (lines.length === 1 && lines[0].DetailType === "AccountBasedExpenseLineDetail") {
    const line = lines[0];
    if (near(line.Amount, amount) && String(line.Description ?? "") === description) {
      return { body: retag(line) ? { ...header, Line: [tagged(line)] } : header };
    }
    const next: Record<string, unknown> = { ...tagged(line), Amount: amount };
    if (description) next.Description = description;
    else delete next.Description;
    return { body: { ...header, Line: [next] } };
  }
  const total = lines.reduce((t, l) => t + (Number(l.Amount) || 0), 0);
  if (near(total, amount)) return { body: lines.some(retag) ? { ...header, Line: lines.map(tagged) } : header };
  return { wait: WAIT.split };
}

/**
 * A payment as QuickBooks takes it. The matched QuickBooks account decides
 * (else the CRM account's kind): a credit card account pays by card; a bank
 * account (or cash) as a check-type payment from it, the method -- Zelle,
 * ACH -- in the memo. Callers check the account is matched first.
 */
export function billPaymentBody(payment: SyncPayment, ref: { vendorId: string; billQbId: string }): QbBillPaymentBody {
  const account = payment.account!;
  const amount = dollars(payment.amountCents);
  const reference = qbText(payment.reference, 100);
  const note = [billPaymentMethodLabel(payment.method), reference ? `ref ${reference}` : null, qbText(payment.note, 1000) || null]
    .filter(Boolean)
    .join(" · ");
  const isCheck = payment.method === "check";
  const byCard = account.qbType ? account.qbType === "Credit Card" : account.kind === "credit_card";
  return {
    VendorRef: { value: ref.vendorId },
    ...(byCard
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
  const base = sha([
    "bill",
    qbVendorName(bill.vendorName),
    bill.amountCents,
    billDay(bill),
    bill.dueDate,
    qbText(bill.reference, 4000),
    qbText(bill.memo, 4000),
  ]);
  // Only a tagged bill's hash says so, kept apart (a change of job alone can be told
  // apart): a bill without a job hashes as before.
  return bill.tag ? `${base}${JOB_HASH}${bill.tag}` : base;
}

const JOB_HASH = ":job:";

/**
 * Why a sent bill's job was left off in QuickBooks: its books are closed for
 * the bill's date. Names the closing date it was checked against, so a new
 * closing date (the books reopened) has it tried again.
 */
export function keptOutReason(closeDate: string | null): string {
  return closeDate
    ? `Its job is left off in QuickBooks: the books there are closed through ${closeDate}.`
    : "Its job is left off in QuickBooks: the books there are closed for its date.";
}
/** Two bill hashes that differ only in the job. */
const onlyJobDiffers = (a: string | null, b: string) => !!a && a !== b && a.split(JOB_HASH)[0] === b.split(JOB_HASH)[0];

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
 * A request id for one new try of a write (at most 50 characters):
 * QuickBooks answers a repeat of an id with its first answer, so every new
 * try needs its own. An add's id is kept with the written-down request, so
 * an add whose answer never came is repeated with the same one.
 */
export function newRequestId(): string {
  return `crm-${randomUUID().replace(/-/g, "")}`;
}

export const BACKOFF_MINUTES = [15, 60, 240, 720, 1440];

/** When to try again after the `tries`-th refusal. */
export function nextTryAt(tries: number, now: Date): string {
  const minutes = BACKOFF_MINUTES[Math.min(Math.max(tries, 1), BACKOFF_MINUTES.length) - 1];
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

// ---------------------------------------------------------------- the plan

export type SyncStep =
  | { op: "resolve"; recordType: RecordType; recordId: string; record: SyncRecord }
  | { op: "void_payment"; recordId: string; record: SyncRecord }
  | { op: "delete_bill"; recordId: string; record: SyncRecord }
  | { op: "drop"; recordType: RecordType; recordId: string }
  /** Only its job changed: just its lines are sent (billRetagBody). */
  | { op: "retag_bill"; recordId: string; bill: SyncBill; hash: string; record: SyncRecord }
  /**
   * Noted as done. `noted`: a job change QuickBooks' closed books keep out, noted
   * by that version without changing what was really sent (the hash keeps the tag
   * the CRM last sent).
   */
  | { op: "settle"; recordType: "bill" | "receipt"; recordId: string; noted?: string; noteReason?: string }
  | { op: "wait"; recordType: RecordType; recordId: string; billId: string; reason: string; hash: string }
  | { op: "create_bill" | "update_bill"; recordId: string; bill: SyncBill; hash: string; accountId: string; record: SyncRecord | null }
  | { op: "create_payment"; recordId: string; payment: SyncPayment; hash: string; record: SyncRecord | null }
  /** Attach the bill's receipt; `record` in QuickBooks means it replaces the one the CRM attached. */
  | { op: "attach_receipt"; recordId: string; bill: SyncBill; hash: string; file: { fileName: string; contentType: string }; record: SyncRecord | null }
  | { op: "remove_receipt"; recordId: string; record: SyncRecord };

export const WAIT = {
  noVendor: "This bill has no vendor.",
  noAccount: "No QuickBooks account for its cost yet. Match a QuickBooks account for job costs in Settings › QuickBooks.",
  noPaidFrom: 'No "Paid from" account on this payment. Delete it and record it again with one.',
  unmatched: (name: string) => `"${name}" isn't matched to a QuickBooks account yet. Match it in Settings › QuickBooks.`,
  overpaid: "This payment is more than what's left on the bill.",
  billFirst: "Waits for its bill to go to QuickBooks first.",
  billGone: "Its bill was deleted in QuickBooks, so the CRM doesn't send its payments.",
  split: "It's split into several lines in QuickBooks, so the CRM can't change its amount there. Change it in QuickBooks.",
};

const keyOf = (type: RecordType, id: string) => `${type}:${id}`;

/** What the bills job sends and looks after; the rest of quickbooks_sync is the invoices job's. */
export const BILL_RECORD_TYPES: RecordType[] = ["bill", "bill_payment", "receipt"];

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
  /** QuickBooks' closing date, as the invoices job last read it (DECISIONS #184); null if none or unknown. */
  closeDate?: string | null;
}): SyncStep[] {
  const force = !!p.force;
  const now = p.now.getTime();
  // Only the bills side's own records: invoices and their money are step 3's (DECISIONS #184).
  const records = p.records.filter((r) => BILL_RECORD_TYPES.includes(r.record_type));
  const recordOf = new Map(records.map((r) => [keyOf(r.record_type, r.record_id), r]));
  const billRecord = (id: string) => recordOf.get(keyOf("bill", id)) ?? null;
  const paymentRecord = (id: string) => recordOf.get(keyOf("bill_payment", id)) ?? null;
  const billsById = new Map(p.bills.map((b) => [b.id, b]));
  const paymentIds = new Set(p.payments.map((x) => x.id));
  const paymentRecordsOf = (billId: string) => records.filter((r) => r.record_type === "bill_payment" && r.bill_id === billId);
  const receiptRecord = (billId: string) => recordOf.get(keyOf("receipt", billId)) ?? null;

  const resolves: SyncStep[] = [];
  const voids: SyncStep[] = [];
  const deletes: SyncStep[] = [];
  const drops: SyncStep[] = [];
  const work: SyncStep[] = [];

  // First, anything whose last add never got an answer: repeat it exactly,
  // and leave it (and a bill's payments) alone until the next run.
  const busy = new Set<string>();
  for (const r of records) {
    if (!r.doubt) continue;
    busy.add(keyOf(r.record_type, r.record_id));
    resolves.push({ op: "resolve", recordType: r.record_type, recordId: r.record_id, record: r });
  }
  const isBusy = (r: SyncRecord | null) => !!r && busy.has(keyOf(r.record_type, r.record_id));

  /** Refused (or waiting) at this version, and not due another try yet. */
  const resting = (r: SyncRecord | null, hash: string) =>
    !force &&
    !!r &&
    (r.status === "failed" || r.status === "waiting") &&
    r.tried_hash === hash &&
    !!r.next_try_at &&
    new Date(r.next_try_at).getTime() > now;
  // A removal QuickBooks refused (a closed month, say) waits its turn too.
  const removalResting = (r: SyncRecord) =>
    !force && r.status === "failed" && r.failed_op === "remove" && !!r.next_try_at && new Date(r.next_try_at).getTime() > now;

  const voided = new Set<string>();
  // Bills with a payment still in QuickBooks after this run: not deleted yet.
  const blocked = new Set<string>();
  const voidPayment = (r: SyncRecord) => {
    if (voided.has(r.record_id)) return;
    voided.add(r.record_id);
    if (isBusy(r) || removalResting(r)) {
      if (r.bill_id) blocked.add(r.bill_id);
      return;
    }
    voids.push({ op: "void_payment", recordId: r.record_id, record: r });
  };
  /** Take out the receipt the CRM attached (before its bill is deleted). */
  const removeReceipt = (billId: string) => {
    const rr = receiptRecord(billId);
    if (!rr) return;
    if (!inQuickBooks(rr)) {
      if (!isBusy(rr) && rr.status !== "removed" && rr.status !== "gone") drops.push({ op: "drop", recordType: "receipt", recordId: billId });
      else if (isBusy(rr)) blocked.add(billId);
      return;
    }
    if (isBusy(rr) || removalResting(rr)) {
      blocked.add(billId);
      return;
    }
    voids.push({ op: "remove_receipt", recordId: billId, record: rr });
  };
  const deleteBill = (r: SyncRecord) => {
    // Not while a payment or its receipt is still in QuickBooks, or may be (in doubt).
    if (blocked.has(r.record_id) || removalResting(r) || paymentRecordsOf(r.record_id).some(isBusy)) return;
    deletes.push({ op: "delete_bill", recordId: r.record_id, record: r });
  };
  const drop = (r: SyncRecord | null) => {
    if (r && !isBusy(r) && !inQuickBooks(r) && r.status !== "removed" && r.status !== "gone") {
      drops.push({ op: "drop", recordType: r.record_type, recordId: r.record_id });
    }
  };
  const wait = (recordType: RecordType, recordId: string, billId: string, reason: string, hash: string) => {
    const r = recordOf.get(keyOf(recordType, recordId));
    // Already noted, the same way: nothing to write. (A receipt can wait
    // while the one before it is still attached.)
    if (r && r.status === "waiting" && r.reason === reason && (recordType === "receipt" || !inQuickBooks(r))) return;
    work.push({ op: "wait", recordType, recordId, billId, reason, hash });
  };

  // Payments gone from the CRM: voided in QuickBooks if they went, else forgotten.
  for (const r of records) {
    if (r.record_type !== "bill_payment" || paymentIds.has(r.record_id) || isBusy(r)) continue;
    if (inQuickBooks(r)) voidPayment(r);
    else drop(r);
  }

  // Bills gone from the CRM altogether: as if voided.
  for (const r of records) {
    if (r.record_type !== "bill" || billsById.has(r.record_id) || isBusy(r)) continue;
    if (inQuickBooks(r)) {
      for (const pr of paymentRecordsOf(r.record_id)) if (inQuickBooks(pr)) voidPayment(pr);
      removeReceipt(r.record_id);
      deleteBill(r);
    } else {
      drop(r);
      removeReceipt(r.record_id);
    }
  }

  const paymentsByBill = new Map<string, SyncPayment[]>();
  for (const pay of p.payments) {
    const list = paymentsByBill.get(pay.billId) ?? [];
    list.push(pay);
    paymentsByBill.set(pay.billId, list);
  }

  for (const bill of p.bills) {
    const rec = billRecord(bill.id);
    if (isBusy(rec)) continue;
    const pays = (paymentsByBill.get(bill.id) ?? []).sort(
      (a, b) => a.paidOn.localeCompare(b.paidOn) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
    );

    if (rec?.status === "gone") {
      // Deleted in QuickBooks by someone there: left alone, and so are its
      // payments and its receipt. A receipt that never got there is
      // forgotten; one still there is left as it is, with nothing pending.
      for (const pay of pays) {
        const pr = paymentRecord(pay.id);
        if (!isBusy(pr) && !inQuickBooks(pr)) wait("bill_payment", pay.id, bill.id, WAIT.billGone, paymentHash(pay));
      }
      const gr = receiptRecord(bill.id);
      if (inQuickBooks(gr) && !isBusy(gr) && gr!.status !== "sent") work.push({ op: "settle", recordType: "receipt", recordId: bill.id });
      else drop(gr);
      continue;
    }

    if (bill.voided) {
      if (inQuickBooks(rec)) {
        for (const pay of pays) if (inQuickBooks(paymentRecord(pay.id))) voidPayment(paymentRecord(pay.id)!);
        for (const pr of paymentRecordsOf(bill.id)) if (inQuickBooks(pr)) voidPayment(pr);
        removeReceipt(bill.id);
        deleteBill(rec!);
      } else {
        drop(rec);
        removeReceipt(bill.id);
      }
      for (const pay of pays) drop(paymentRecord(pay.id));
      continue;
    }

    const tracked = inQuickBooks(rec);
    if (!tracked && billDay(bill) < p.sendFrom) {
      // Moved before the start date before it ever went: it stays out.
      drop(rec);
      for (const pay of pays) drop(paymentRecord(pay.id));
      drop(receiptRecord(bill.id));
      continue;
    }

    const hash = billHash(bill);
    const accountId = p.accounts.byCategory.get(categoryKey(bill.vendorCategory ?? "")) ?? p.accounts.fallback;
    // Will the bill be in QuickBooks, as of this run, for its payments to link to?
    let billGoes = tracked;
    if (!tracked) {
      if (!qbVendorName(bill.vendorName)) wait("bill", bill.id, bill.id, WAIT.noVendor, hash);
      else if (!accountId) wait("bill", bill.id, bill.id, WAIT.noAccount, hash);
      else if (!resting(rec, hash)) {
        work.push({ op: "create_bill", recordId: bill.id, bill, hash, accountId, record: rec });
        billGoes = true;
      }
    } else if (rec!.qb_hash !== hash && onlyJobDiffers(rec!.qb_hash, hash)) {
      // Only its job changed. In a month QuickBooks has closed: left as it is there. Else just its lines go.
      // Kept out by closed books before, with this version and this closing date: left so (Send now tries again).
      const why = keptOutReason(p.closeDate ?? null);
      const noted = rec!.tried_hash === hash && rec!.status === "sent" && rec!.reason === why;
      if (p.closeDate && billDay(bill) <= p.closeDate) {
        if (!noted) work.push({ op: "settle", recordType: "bill", recordId: bill.id, noted: hash, noteReason: why });
      } else if ((!noted || force) && !resting(rec, hash)) work.push({ op: "retag_bill", recordId: bill.id, bill, hash, record: rec! });
    } else if (rec!.qb_hash !== hash) {
      // Changed since it went (or its last change didn't go): send the change.
      if (!resting(rec, hash)) work.push({ op: "update_bill", recordId: bill.id, bill, hash, accountId: accountId ?? "", record: rec });
    } else if (rec!.status !== "sent") {
      // Put back the way QuickBooks has it: nothing to send any more.
      work.push({ op: "settle", recordType: "bill", recordId: bill.id });
    }

    // What QuickBooks already has paid on it counts first, then the rest by date.
    let paid = pays.filter((x) => inQuickBooks(paymentRecord(x.id))).reduce((t, x) => t + x.amountCents, 0);
    for (const pay of pays) {
      const pr = paymentRecord(pay.id);
      if (isBusy(pr) || inQuickBooks(pr)) continue;
      paid += pay.amountCents;
      const pHash = paymentHash(pay);
      if (paid > bill.amountCents) wait("bill_payment", pay.id, bill.id, WAIT.overpaid, pHash);
      else if (!pay.account) wait("bill_payment", pay.id, bill.id, WAIT.noPaidFrom, pHash);
      else if (!pay.account.qbAccountId) wait("bill_payment", pay.id, bill.id, WAIT.unmatched(pay.account.name), pHash);
      else if (!billGoes) wait("bill_payment", pay.id, bill.id, WAIT.billFirst, pHash);
      else if (!resting(pr, pHash)) work.push({ op: "create_payment", recordId: pay.id, payment: pay, hash: pHash, record: pr });
    }

    // Its receipt, once the bill is (or is about to be) in QuickBooks.
    const rr = receiptRecord(bill.id);
    if (isBusy(rr)) continue;
    if (!bill.receiptPath) {
      // No receipt any more: the one the CRM attached comes out.
      if (inQuickBooks(rr)) {
        if (!removalResting(rr!)) work.push({ op: "remove_receipt", recordId: bill.id, record: rr! });
      } else drop(rr);
      continue;
    }
    const rHash = receiptHash(bill.receiptPath);
    if (inQuickBooks(rr) && rr!.qb_hash === rHash) {
      if (rr!.status !== "sent") work.push({ op: "settle", recordType: "receipt", recordId: bill.id });
      continue;
    }
    if (!billGoes) continue;
    const file = receiptFile(bill.receiptPath, bill.vendorName, billDay(bill));
    if ("wait" in file) wait("receipt", bill.id, bill.id, file.wait, rHash);
    else if (!resting(rr, rHash)) work.push({ op: "attach_receipt", recordId: bill.id, bill, hash: rHash, file: file.file, record: rr });
  }

  return [...resolves, ...voids, ...deletes, ...drops, ...work];
}

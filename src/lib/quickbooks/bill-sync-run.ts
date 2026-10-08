import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { leadDisplayName, type ContactType } from "@/lib/data/types";
import { isMissingSchemaError } from "@/lib/schema-drift";
import { RECEIPT_BUCKET } from "@/lib/receipts";
import { quickBooksAccess } from "./connection";
import {
  createBill,
  createBillPayment,
  createVendor,
  deleteAttachable,
  deleteBill,
  findAttachableByNote,
  findVendor,
  readAttachable,
  readBill,
  readBillPayment,
  updateBill,
  uploadReceipt,
  voidBillPayment,
  type QbAccess,
  type QbError,
} from "./api";
import type { QbAccount } from "./accounts";
import { LOOKUP_FAILED } from "./bill-status";
import {
  WAIT,
  inQuickBooks,
  billBody,
  billMemo,
  billPaymentBody,
  billUpdateBody,
  nextTryAt,
  newRequestId,
  planBillSync,
  qbVendorName,
  type InDoubt,
  type RecordType,
  type SyncBill,
  type SyncPayment,
  type SyncRecord,
  type SyncStep,
} from "./bill-sync";

/**
 * One company's turn of the QuickBooks bills job (DECISIONS #173), from
 * the five-minute job (/api/cron/quickbooks-sync) or Send now.
 *
 * Claims the company first (quickbooks_connections.bills_claimed_until),
 * so two runs never send its bills at once. Reads the bills dated from the
 * start date, the ones already sent, their payments and what's needed to
 * describe them; asks planBillSync what to do; does it, one QuickBooks
 * call at a time, writing quickbooks_sync after each. Before adding a bill
 * or payment it writes down the exact request (`doubt`), so a run cut off
 * mid-way is finished by repeating that request, never by adding it again.
 * A bill's receipt (DECISIONS #174) is downloaded from storage and attached
 * to the bill in QuickBooks, with a note unique to the try written down
 * first: a lost answer is settled by looking for that note.
 * Stops starting work at the time budget or the write cap; the rest goes
 * next run.
 */

type Admin = ReturnType<typeof createAdminClient>;

export type BillSyncSummary = {
  sent: number;
  changed: number;
  removed: number;
  waiting: number;
  failed: number;
  /** Stopped at the cap or the time budget: the rest goes next run. */
  more: boolean;
  /** Another run had the company. */
  busy?: boolean;
  /** Why the run stopped early or never started. */
  error?: string;
};

const IN_CHUNK = 100;
/** Longer than any one run can take (the job's limit is five minutes). */
const CLAIM_MINUTES = 6;
/** QuickBooks not answering this many times in a run: it's down, stop for now. */
const MAX_TRANSIENT = 3;
/** Past the budget, a call already started gets this long before it's cut off. */
const GRACE_MS = 25_000;
/** The largest file QuickBooks takes as an attachment. */
const QB_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

const RECORD_COLUMNS =
  "record_type, record_id, bill_id, qb_id, qb_hash, tried_hash, doubt, status, failed_op, reason, tries, next_try_at, sent_at";
const BILL_COLUMNS =
  "id, vendor_id, vendor_name, lead_id, estimate_payment_id, reference, amount_cents, bill_date, due_date, voided_at, created_at, receipt_path";
const PAYMENT_COLUMNS = "id, bill_id, amount_cents, paid_on, method, check_number, note, paid_from_account_id, created_at";

type BillRow = {
  id: string;
  vendor_id: string | null;
  vendor_name: string | null;
  lead_id: string | null;
  estimate_payment_id: string | null;
  reference: string | null;
  amount_cents: number;
  bill_date: string | null;
  due_date: string | null;
  voided_at: string | null;
  created_at: string;
  receipt_path: string | null;
};
type PaymentRow = {
  id: string;
  bill_id: string;
  amount_cents: number;
  paid_on: string;
  method: string | null;
  check_number: string | null;
  note: string | null;
  paid_from_account_id: string | null;
  created_at: string;
};

class StopRun extends Error {}
/** The database hasn't had 0223 yet: a receipt can't be recorded, so none go this run. */
class NoReceipts extends Error {}

/**
 * Every row of a query, page by page -- and a failed read stops the run.
 * Not selectAll: it answers a failed read with no rows, and here "no rows"
 * would read as "nothing was ever sent" (every bill sent twice) or "every
 * bill was deleted" (every bill removed from QuickBooks).
 */
async function readAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data as T[] | null) ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

async function inChunks<T>(ids: string[], read: (chunk: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  const unique = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += IN_CHUNK) {
    const { data, error } = await read(unique.slice(i, i + IN_CHUNK));
    if (error) throw new Error(error.message);
    out.push(...((data as T[] | null) ?? []));
  }
  return out;
}

const empty = (): BillSyncSummary => ({ sent: 0, changed: 0, removed: 0, waiting: 0, failed: 0, more: false });

export async function syncCompanyBills(
  admin: Admin,
  companyId: string,
  opts: { writeCap?: number; budgetMs?: number; force?: boolean; fetchImpl?: typeof fetch } = {}
): Promise<BillSyncSummary> {
  const summary = empty();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const { data: conn, error: connError } = await admin
    .from("quickbooks_connections")
    .select("realm_id, disconnected_at, send_bills, send_bills_from, accounts")
    .eq("company_id", companyId)
    .maybeSingle<{
      realm_id: string | null;
      disconnected_at: string | null;
      send_bills: boolean;
      send_bills_from: string | null;
      accounts: QbAccount[] | null;
    }>();
  if (connError) {
    return { ...summary, error: isMissingSchemaError(connError) ? "QuickBooks needs a database update first: run 0222_quickbooks_bills.sql in Supabase." : connError.message };
  }
  if (!conn?.realm_id || conn.disconnected_at) return { ...summary, error: "Connect QuickBooks first." };
  if (!conn.send_bills || !conn.send_bills_from) return { ...summary, error: "Sending bills to QuickBooks is off." };
  const realmId = conn.realm_id;
  const sendFrom = conn.send_bills_from;

  // One run at a time per company: a claim that runs out by itself if a run dies.
  const started = new Date();
  const { data: claimed, error: claimError } = await admin
    .from("quickbooks_connections")
    .update({ bills_claimed_until: new Date(started.getTime() + CLAIM_MINUTES * 60_000).toISOString() })
    .eq("company_id", companyId)
    .or(`bills_claimed_until.is.null,bills_claimed_until.lt."${started.toISOString()}"`)
    .select("company_id");
  if (claimError) return { ...summary, error: claimError.message };
  if (!claimed?.length) return { ...summary, busy: true };

  try {
    const got = await quickBooksAccess(admin, companyId, fetchImpl);
    if ("error" in got) return { ...summary, error: got.error };
    if (got.access.realmId !== realmId) return { ...summary, error: "QuickBooks needs you to connect again." };
    const qbTypes = new Map((Array.isArray(conn.accounts) ? conn.accounts : []).map((a) => [a.id, a.type]));
    await run(admin, companyId, realmId, sendFrom, qbTypes, got.access, fetchImpl, opts, summary);
    return summary;
  } finally {
    await admin
      .from("quickbooks_connections")
      .update({ bills_claimed_until: null, bills_checked_at: new Date().toISOString() })
      .eq("company_id", companyId);
  }
}

async function run(
  admin: Admin,
  companyId: string,
  realmId: string,
  sendFrom: string,
  qbTypes: Map<string, string>,
  access: QbAccess,
  baseFetch: typeof fetch,
  opts: { writeCap?: number; budgetMs?: number; force?: boolean },
  summary: BillSyncSummary
) {
  const deadline = Date.now() + (opts.budgetMs ?? 120_000);
  const cap = opts.writeCap ?? 100;
  // No call outlives the run: one still going GRACE_MS past the budget is
  // cut off (and an add cut off that way is repeated next run, not doubled).
  const hardStop = deadline + GRACE_MS;
  const fetchImpl = ((url: string, init: RequestInit = {}) => {
    const left = Math.max(1_000, hardStop - Date.now());
    const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(left)]) : AbortSignal.timeout(left);
    return baseFetch(url, { ...init, signal });
  }) as typeof fetch;

  // ---------------------------------------------------------------- read
  const records = await readAll<SyncRecord>((f, t) =>
    admin
      .from("quickbooks_sync")
      .select(RECORD_COLUMNS)
      .eq("company_id", companyId)
      .eq("realm_id", realmId)
      .order("record_type")
      .order("record_id")
      .range(f, t)
  );
  const recent = await readAll<BillRow>((f, t) =>
    admin
      .from("vendor_bills")
      .select(BILL_COLUMNS)
      .eq("company_id", companyId)
      .or(`bill_date.gte.${sendFrom},and(bill_date.is.null,created_at.gte.${sendFrom})`)
      .order("id")
      .range(f, t)
  );
  const have = new Set(recent.map((b) => b.id));
  const trackedIds = records.map((r) => (r.record_type === "bill" ? r.record_id : r.bill_id ?? "")).filter((id) => id && !have.has(id));
  const older = await inChunks<BillRow>(trackedIds, (chunk) =>
    admin.from("vendor_bills").select(BILL_COLUMNS).eq("company_id", companyId).in("id", chunk)
  );
  const billRows = [...recent, ...older];
  const billIds = billRows.map((b) => b.id);

  const [paymentRows, vendors, leads, phases, accountsRows, matchRows] = await Promise.all([
    inChunks<PaymentRow>(billIds, (chunk) =>
      admin.from("vendor_bill_payments").select(PAYMENT_COLUMNS).eq("company_id", companyId).in("bill_id", chunk)
    ),
    inChunks<{ id: string; name: string; default_category: string | null }>(
      billRows.map((b) => b.vendor_id ?? ""),
      (chunk) => admin.from("vendors").select("id, name, default_category").eq("company_id", companyId).in("id", chunk)
    ),
    inChunks<{ id: string; first_name: string | null; last_name: string | null; company_name: string | null; contact_type: ContactType }>(
      billRows.map((b) => b.lead_id ?? ""),
      (chunk) =>
        admin.from("leads").select("id, first_name, last_name, company_name, contact_type").eq("company_id", companyId).in("id", chunk)
    ),
    inChunks<{ id: string; estimate_id: string }>(billRows.map((b) => b.estimate_payment_id ?? ""), (chunk) =>
      admin.from("estimate_payments").select("id, estimate_id").eq("company_id", companyId).in("id", chunk)
    ),
    admin.from("payment_accounts").select("id, name, kind, qb_account_id").eq("company_id", companyId),
    admin.from("quickbooks_expense_accounts").select("category_key, qb_account_id").eq("company_id", companyId),
  ]);
  const estimates = await inChunks<{ id: string; doc_number: string | null; title: string | null; lead_id: string | null }>(
    phases.map((ph) => ph.estimate_id),
    (chunk) => admin.from("estimates").select("id, doc_number, title, lead_id").eq("company_id", companyId).in("id", chunk)
  );
  if (accountsRows.error) throw new Error(accountsRows.error.message);
  if (matchRows.error) throw new Error(matchRows.error.message);

  const vendorById = new Map(vendors.map((v) => [v.id, v]));
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const estimateOfPhase = new Map(phases.map((ph) => [ph.id, ph.estimate_id]));
  const estimateById = new Map(estimates.map((e) => [e.id, e]));
  const accountById = new Map(
    ((accountsRows.data ?? []) as { id: string; name: string; kind: string; qb_account_id: string | null }[]).map((a) => [a.id, a])
  );
  const matches = (matchRows.data ?? []) as { category_key: string; qb_account_id: string }[];

  const bills: SyncBill[] = billRows.map((b) => {
    const vendor = b.vendor_id ? vendorById.get(b.vendor_id) : undefined;
    const lead = b.lead_id ? leadById.get(b.lead_id) : undefined;
    // The phase's contract, but only if it's still this job's (a bill moved
    // to another job keeps its old phase).
    const est = b.estimate_payment_id ? estimateById.get(estimateOfPhase.get(b.estimate_payment_id) ?? "") : undefined;
    const contract = est && est.lead_id === b.lead_id ? est : undefined;
    return {
      id: b.id,
      vendorName: vendor?.name ?? b.vendor_name,
      vendorCategory: vendor?.default_category ?? null,
      reference: b.reference,
      amountCents: Number(b.amount_cents),
      billDate: b.bill_date,
      dueDate: b.due_date,
      createdAt: b.created_at,
      voided: !!b.voided_at,
      memo: b.lead_id
        ? billMemo({ docNumber: contract?.doc_number ?? null, customer: lead ? leadDisplayName(lead) : null, title: contract?.title ?? null })
        : billMemo({ docNumber: null, customer: null, title: null }),
      receiptPath: b.receipt_path ?? null,
    };
  });
  const payments: SyncPayment[] = paymentRows.map((x) => {
    const account = x.paid_from_account_id ? accountById.get(x.paid_from_account_id) : undefined;
    return {
      id: x.id,
      billId: x.bill_id,
      amountCents: Number(x.amount_cents),
      paidOn: x.paid_on,
      method: x.method,
      reference: x.check_number,
      note: x.note,
      createdAt: x.created_at,
      account: account
        ? {
            id: account.id,
            name: account.name,
            kind: account.kind,
            qbAccountId: account.qb_account_id,
            qbType: account.qb_account_id ? qbTypes.get(account.qb_account_id) ?? null : null,
          }
        : null,
    };
  });

  const steps = planBillSync({
    bills,
    payments,
    records,
    sendFrom,
    now: new Date(),
    accounts: {
      byCategory: new Map(matches.filter((m) => m.category_key).map((m) => [m.category_key, m.qb_account_id])),
      fallback: matches.find((m) => m.category_key === "")?.qb_account_id ?? null,
    },
    force: opts.force,
  });

  // ---------------------------------------------------------------- write
  const billById = new Map(bills.map((b) => [b.id, b]));
  // QuickBooks' id for each bill, as it stands during this run.
  const billQb = new Map(
    records.filter((r) => r.record_type === "bill" && r.qb_id && r.status !== "removed" && r.status !== "gone").map((r) => [r.record_id, r.qb_id!])
  );
  const vendorIds = new Map<string, string>();
  // Bills whose payment void or receipt removal didn't finish this run:
  // they aren't deleted until it does.
  const held = new Set<string>();
  let writes = 0;
  let transient = 0;

  const save = async (type: RecordType, id: string, billId: string | null, fields: Partial<SyncRecord>) => {
    const { error } = await admin.from("quickbooks_sync").upsert(
      {
        company_id: companyId,
        realm_id: realmId,
        record_type: type,
        record_id: id,
        bill_id: billId,
        ...fields,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_id,realm_id,record_type,record_id" }
    );
    if (error) {
      if (type === "receipt" && /quickbooks_sync_record_type_check/.test(error.message)) throw new NoReceipts(error.message);
      throw new Error(error.message);
    }
  };
  const drop = async (type: RecordType, id: string) => {
    const { error } = await admin
      .from("quickbooks_sync")
      .delete()
      .eq("company_id", companyId)
      .eq("realm_id", realmId)
      .eq("record_type", type)
      .eq("record_id", id);
    if (error) throw new Error(error.message);
  };
  const sentNow = (qbId: string, hash: string): Partial<SyncRecord> => ({
    status: "sent",
    qb_id: qbId,
    qb_hash: hash,
    tried_hash: null,
    doubt: null,
    failed_op: null,
    reason: null,
    tries: 0,
    next_try_at: null,
    sent_at: new Date().toISOString(),
  });

  /** A login refused or QuickBooks asking to slow down: the run stops. */
  const stopIf = async (err: QbError) => {
    if (err.kind === "auth") {
      await admin.from("quickbooks_connections").update({ last_error: err.message, updated_at: new Date().toISOString() }).eq("company_id", companyId);
      throw new StopRun(err.message);
    }
    if (err.kind === "throttle") throw new StopRun(err.message);
  };
  const countTransient = (err: QbError) => {
    transient += 1;
    if (transient >= MAX_TRANSIENT) throw new StopRun(err.message);
  };
  /** A vendor lookup QuickBooks didn't answer: a bill or payment not sent yet says so meanwhile. */
  const vendorTrouble = async (type: RecordType, id: string, billId: string, record: SyncRecord | null, hash: string, err: QbError) => {
    await stopIf(err);
    if (err.kind === "transient" || err.kind === "stale") {
      if (!inQuickBooks(record)) await save(type, id, billId, { status: "waiting", reason: err.message, tried_hash: hash, next_try_at: null });
      return countTransient(err);
    }
    return refusedAt(type, id, billId, record, hash, err, inQuickBooks(record) ? "change" : "add");
  };
  /** QuickBooks refused a version for good: say why, rest, try again later or when it changes. */
  const refusedAt = async (
    type: RecordType,
    id: string,
    billId: string | null,
    record: SyncRecord | null,
    hash: string,
    err: QbError,
    op: "add" | "change"
  ) => {
    const tries = (record?.failed_op === op ? record.tries : 0) + 1;
    await save(type, id, billId, {
      status: "failed",
      failed_op: op,
      reason: err.message,
      tried_hash: hash,
      doubt: null,
      tries,
      next_try_at: nextTryAt(tries, new Date()),
    });
    summary.failed += 1;
  };
  /** QuickBooks refused a void or a delete: say why, try again later. */
  const removalRefused = async (type: RecordType, r: SyncRecord, what: string, err: QbError) => {
    const tries = (r.failed_op === "remove" ? r.tries : 0) + 1;
    await save(type, r.record_id, r.bill_id ?? r.record_id, {
      status: "failed",
      failed_op: "remove",
      reason: `Couldn't ${what} it in QuickBooks. ${err.message}`,
      tries,
      next_try_at: nextTryAt(tries, new Date()),
    });
    summary.failed += 1;
  };
  /** Someone deleted the bill in QuickBooks: the CRM leaves it alone, and nothing more is done to it this run. */
  const billGone = async (billId: string, hash: string | null) => {
    await save("bill", billId, billId, {
      status: "gone",
      reason: "Deleted in QuickBooks, so the CRM doesn't send it again.",
      tried_hash: hash,
      next_try_at: null,
    });
    billQb.delete(billId);
    summary.failed += 1;
  };
  /** Can't go yet for a reason found while sending (a vendor): rests like a refusal. */
  const waitAt = async (type: RecordType, id: string, billId: string, record: SyncRecord | null, hash: string, reason: string) => {
    const tries = (record?.tries ?? 0) + 1;
    await save(type, id, billId, { status: "waiting", reason, tried_hash: hash, tries, next_try_at: nextTryAt(tries, new Date()) });
    summary.waiting += 1;
  };

  const isTransient = (err: QbError) => err.kind === "transient" || err.kind === "stale";

  /** Takes off the attachment the CRM put on a bill. Only a read saying "not found" means it's already gone. */
  const takeOffReceipt = async (r: SyncRecord): Promise<{ ok: true } | { error: QbError }> => {
    const current = await readAttachable(access, r.qb_id!, fetchImpl);
    if ("error" in current) return current.error.kind === "notfound" ? { ok: true } : current;
    const done = await deleteAttachable(access, current.attachable, newRequestId(), fetchImpl);
    return "error" in done ? done : { ok: true };
  };

  /** The receipt file from storage, or why it can't be read now. Cut off with the run, like a QuickBooks call. */
  const receiptBytes = async (path: string): Promise<{ blob: Blob } | { missing: true } | { unreadable: true }> => {
    try {
      const signal = AbortSignal.timeout(Math.max(1_000, hardStop - Date.now()));
      const got = await admin.storage.from(RECEIPT_BUCKET).download(path, {}, { signal });
      if (got.data && !got.error) return { blob: got.data };
      if (signal.aborted) return { unreadable: true };
      // Told apart by listing its folder: a download error doesn't say reliably.
      const folder = path.slice(0, path.lastIndexOf("/"));
      const base = path.slice(path.lastIndexOf("/") + 1);
      const listed = await admin.storage.from(RECEIPT_BUCKET).list(folder, { search: base }, { signal });
      if (!listed.error && !listed.data?.some((f) => f.name === base)) return { missing: true };
    } catch {
      // Cut off, or the file stopped part-way: tried again next run.
    }
    return { unreadable: true };
  };

  /**
   * A receipt upload whose answer never came: QuickBooks has it if an
   * attachment carries the note written down for that try. Only QuickBooks
   * answering that none does clears it, to be sent again next run; a lookup
   * that fails keeps it in doubt and is tried again later, so the file is
   * never uploaded twice.
   */
  const resolveReceipt = async (r: SyncRecord) => {
    const doubt = r.doubt!;
    const body = (doubt.body ?? {}) as { note?: unknown; billQbId?: unknown };
    if (!opts.force && r.next_try_at && new Date(r.next_try_at).getTime() > Date.now()) return;
    const found =
      typeof body.note === "string"
        ? await findAttachableByNote(access, { note: body.note, billQbId: typeof body.billQbId === "string" ? body.billQbId : null }, fetchImpl)
        : ({ attachable: null } as const);
    if ("error" in found) {
      await stopIf(found.error);
      if (isTransient(found.error)) return countTransient(found.error);
      const tries = r.tries + 1;
      await save("receipt", r.record_id, r.record_id, {
        status: "waiting",
        reason: `${LOOKUP_FAILED} ${found.error.message}`,
        tries,
        next_try_at: nextTryAt(tries, new Date()),
      });
      summary.waiting += 1;
      return;
    }
    if (found.attachable) {
      await save("receipt", r.record_id, r.record_id, sentNow(found.attachable.id, doubt.hash));
      summary.sent += 1;
      return;
    }
    // Not there: sent again next run.
    await save("receipt", r.record_id, r.record_id, {
      doubt: null,
      status: "waiting",
      reason: "Didn't reach QuickBooks. Sending it again in a few minutes.",
      tried_hash: null,
      tries: 0,
      next_try_at: null,
    });
  };

  /** The QuickBooks vendor for a name: found, else added. */
  const vendorFor = async (name: string | null): Promise<{ id: string } | { wait: string } | { error: QbError }> => {
    const clean = qbVendorName(name);
    if (!clean) return { wait: WAIT.noVendor };
    const key = clean.toLowerCase();
    const known = vendorIds.get(key);
    if (known) return { id: known };
    const found = await findVendor(access, clean, fetchImpl);
    if ("error" in found) return found;
    if (found.vendor) {
      if (!found.vendor.active) return { wait: `"${clean}" is inactive in QuickBooks. Make it active there, or pick another vendor in the CRM.` };
      vendorIds.set(key, found.vendor.id);
      return { id: found.vendor.id };
    }
    writes += 1;
    // A vendor added but whose answer was lost is found by name next time.
    const made = await createVendor(access, clean, newRequestId(), fetchImpl);
    if ("error" in made) {
      if (made.error.kind === "duplicate") {
        return { wait: `QuickBooks already has a customer or employee named "${clean}". Rename the vendor in the CRM or in QuickBooks.` };
      }
      return made;
    }
    vendorIds.set(key, made.id);
    return { id: made.id };
  };

  /**
   * Adds a bill or payment. The exact request is written down first; if no
   * answer comes, it stays written down and the next run repeats it (same
   * request id: QuickBooks answers a repeat without adding it again).
   */
  const add = async (type: RecordType, id: string, billId: string, record: SyncRecord | null, doubt: InDoubt) => {
    await save(type, id, billId, record ? { doubt } : { doubt, status: "waiting", reason: "Being sent to QuickBooks now." });
    writes += 1;
    const res = type === "bill" ? await createBill(access, doubt.body, doubt.requestId, fetchImpl) : await createBillPayment(access, doubt.body, doubt.requestId, fetchImpl);
    if (!("error" in res)) {
      await save(type, id, billId, sentNow(res.id, doubt.hash));
      if (type === "bill") billQb.set(id, res.id);
      summary.sent += 1;
      return;
    }
    await stopIf(res.error);
    if (res.error.kind === "transient" || res.error.kind === "stale") {
      // No answer: it may be in QuickBooks. Kept in doubt, repeated next run.
      await save(type, id, billId, { status: "waiting", reason: res.error.message, tried_hash: doubt.hash, next_try_at: null });
      countTransient(res.error);
      return;
    }
    // Refused: QuickBooks didn't add it. The next try is a new request.
    await refusedAt(type, id, billId, record, doubt.hash, res.error, "add");
  };

  const doStep = async (step: SyncStep) => {
    switch (step.op) {
      case "drop":
        await drop(step.recordType, step.recordId);
        return;
      case "settle":
        await save(step.recordType, step.recordId, step.recordId, {
          status: "sent",
          failed_op: null,
          reason: null,
          tried_hash: null,
          tries: 0,
          next_try_at: null,
        });
        return;
      case "wait":
        // A receipt says nothing of its own until its bill is in QuickBooks.
        if (step.recordType === "receipt" && !billQb.has(step.billId)) return;
        await save(step.recordType, step.recordId, step.billId, {
          status: "waiting",
          reason: step.reason,
          tried_hash: step.hash,
          next_try_at: null,
        });
        summary.waiting += 1;
        return;
      case "resolve": {
        const r = step.record;
        if (r.record_type === "receipt") return resolveReceipt(r);
        await add(r.record_type, r.record_id, r.bill_id ?? r.record_id, r, r.doubt!);
        return;
      }
      case "void_payment": {
        const r = step.record;
        writes += 1;
        // Only a read saying "not found" means it's gone; the same answer
        // to the void itself can mean something it uses was made inactive.
        const current = await readBillPayment(access, r.qb_id!, fetchImpl);
        let err: QbError | null = "error" in current && current.error.kind !== "notfound" ? current.error : null;
        if (!err && !("error" in current) && !current.voided) {
          const done = await voidBillPayment(access, current, newRequestId(), fetchImpl);
          if ("error" in done) err = done.error;
        }
        if (err) {
          if (r.bill_id) held.add(r.bill_id);
          await stopIf(err);
          if (err.kind === "transient" || err.kind === "stale") return countTransient(err);
          return removalRefused("bill_payment", r, "void", err);
        }
        await save("bill_payment", r.record_id, r.bill_id, { status: "removed", failed_op: null, reason: null, tried_hash: null, next_try_at: null, tries: 0 });
        summary.removed += 1;
        return;
      }
      case "delete_bill": {
        const r = step.record;
        // Its payment or receipt is still on it in QuickBooks: next run.
        if (held.has(r.record_id)) return;
        writes += 1;
        const current = await readBill(access, r.qb_id!, fetchImpl);
        let err: QbError | null = "error" in current && current.error.kind !== "notfound" ? current.error : null;
        if (!err && !("error" in current)) {
          const done = await deleteBill(access, current, newRequestId(), fetchImpl);
          if ("error" in done) err = done.error;
        }
        if (err) {
          await stopIf(err);
          if (err.kind === "transient" || err.kind === "stale") return countTransient(err);
          return removalRefused("bill", r, "delete", err);
        }
        await save("bill", r.record_id, r.record_id, {
          status: "removed",
          qb_id: null,
          failed_op: null,
          reason: null,
          tried_hash: null,
          next_try_at: null,
          tries: 0,
        });
        billQb.delete(r.record_id);
        summary.removed += 1;
        return;
      }
      case "create_bill": {
        const { bill, hash, record } = step;
        const vendor = await vendorFor(bill.vendorName);
        if ("wait" in vendor) return waitAt("bill", bill.id, bill.id, record, hash, vendor.wait);
        if ("error" in vendor) return vendorTrouble("bill", bill.id, bill.id, record, hash, vendor.error);
        const body = billBody(bill, { vendorId: vendor.id, accountId: step.accountId });
        await add("bill", bill.id, bill.id, record, { requestId: newRequestId(), body, hash });
        return;
      }
      case "update_bill": {
        const { bill, hash, record } = step;
        const vendor = await vendorFor(bill.vendorName);
        if ("wait" in vendor) return waitAt("bill", bill.id, bill.id, record, hash, vendor.wait);
        if ("error" in vendor) return vendorTrouble("bill", bill.id, bill.id, record, hash, vendor.error);
        writes += 1;
        let result: Awaited<ReturnType<typeof updateBill>> | null = null;
        // Read it as QuickBooks has it now; if it changed there meanwhile, once more.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const current = await readBill(access, record!.qb_id!, fetchImpl);
          if ("error" in current) {
            if (current.error.kind === "notfound") {
              // Deleted in QuickBooks by someone there: the CRM leaves it alone.
              await billGone(bill.id, hash);
              return;
            }
            result = current;
            break;
          }
          const update = billUpdateBody(bill, current, { vendorId: vendor.id });
          if ("wait" in update) return waitAt("bill", bill.id, bill.id, record, hash, update.wait);
          result = await updateBill(access, update.body, newRequestId(), fetchImpl);
          if (!("error" in result) || result.error.kind !== "stale") break;
        }
        if (result && !("error" in result)) {
          await save("bill", bill.id, bill.id, sentNow(result.id, hash));
          summary.changed += 1;
          return;
        }
        const err = result!.error;
        await stopIf(err);
        // No answer: QuickBooks keeps what it had; the change goes next run.
        if (err.kind === "transient" || err.kind === "stale") return countTransient(err);
        return refusedAt("bill", bill.id, bill.id, record, hash, err, "change");
      }
      case "create_payment": {
        const { payment, hash, record } = step;
        const bill = billById.get(payment.billId);
        const billQbId = billQb.get(payment.billId);
        if (!bill || !billQbId) {
          await save("bill_payment", payment.id, payment.billId, { status: "waiting", reason: WAIT.billFirst, tried_hash: hash, next_try_at: null });
          summary.waiting += 1;
          return;
        }
        const vendor = await vendorFor(bill.vendorName);
        if ("wait" in vendor) return waitAt("bill_payment", payment.id, payment.billId, record, hash, vendor.wait);
        if ("error" in vendor) return vendorTrouble("bill_payment", payment.id, payment.billId, record, hash, vendor.error);
        const body = billPaymentBody(payment, { vendorId: vendor.id, billQbId });
        await add("bill_payment", payment.id, payment.billId, record, { requestId: newRequestId(), body, hash });
        return;
      }
      case "remove_receipt": {
        const r = step.record;
        // Its bill was found deleted in QuickBooks this run: left alone.
        if (!billQb.has(r.record_id)) return;
        writes += 1;
        const off = await takeOffReceipt(r);
        if ("error" in off) {
          held.add(r.record_id);
          await stopIf(off.error);
          if (isTransient(off.error)) return countTransient(off.error);
          return removalRefused("receipt", r, "remove", off.error);
        }
        await save("receipt", r.record_id, r.record_id, {
          status: "removed",
          qb_id: null,
          qb_hash: null,
          failed_op: null,
          reason: null,
          tried_hash: null,
          next_try_at: null,
          tries: 0,
        });
        summary.removed += 1;
        return;
      }
      case "attach_receipt": {
        const { bill, hash, file, record } = step;
        // Its bill didn't go this run: the receipt follows it next run.
        const billQbId = billQb.get(bill.id);
        if (!billQbId) return;
        writes += 1;
        // Its first row is written before the download: a database without
        // 0223 refuses it here, before anything is fetched.
        if (!record) await save("receipt", bill.id, bill.id, { status: "waiting", reason: "Being sent to QuickBooks now." });
        const got = await receiptBytes(bill.receiptPath!);
        if ("missing" in got) return waitAt("receipt", bill.id, bill.id, record, hash, "The receipt file couldn't be found. Attach it again.");
        if ("unreadable" in got) {
          await save("receipt", bill.id, bill.id, {
            status: "waiting",
            reason: "The receipt file couldn't be read just now. Trying again in a few minutes.",
            tried_hash: hash,
            next_try_at: null,
          });
          summary.waiting += 1;
          return;
        }
        if (got.blob.size > QB_MAX_UPLOAD_BYTES) {
          return waitAt("receipt", bill.id, bill.id, record, hash, "This receipt is too big for QuickBooks (over 100 MB). Attach a smaller copy.");
        }
        // Replaced in the CRM: the one it attached before comes off first.
        const replacing = inQuickBooks(record);
        if (replacing) {
          const off = await takeOffReceipt(record!);
          if ("error" in off) {
            await stopIf(off.error);
            if (isTransient(off.error)) return countTransient(off.error);
            return refusedAt("receipt", bill.id, bill.id, record, hash, off.error, "change");
          }
        }
        // Written down first, with a note unique to this try: a lost answer
        // is settled next run by looking for the note, never by uploading twice.
        const requestId = newRequestId();
        const note = `From the CRM, ref ${requestId}`;
        const doubt: InDoubt = { requestId, body: { note, billQbId }, hash };
        await save("receipt", bill.id, bill.id, {
          doubt,
          qb_id: null,
          qb_hash: null,
          status: "waiting",
          reason: "Being sent to QuickBooks now.",
          failed_op: null,
          tries: 0,
          next_try_at: null,
        });
        const res = await uploadReceipt(
          access,
          { billQbId, fileName: file.fileName, contentType: file.contentType, note, bytes: got.blob },
          fetchImpl
        );
        if (!("error" in res)) {
          await save("receipt", bill.id, bill.id, sentNow(res.id, hash));
          if (replacing) summary.changed += 1;
          else summary.sent += 1;
          return;
        }
        await stopIf(res.error);
        if (isTransient(res.error)) {
          // No answer: it may be in QuickBooks. Looked for by its note next run.
          await save("receipt", bill.id, bill.id, { status: "waiting", reason: res.error.message, tried_hash: hash, next_try_at: null });
          return countTransient(res.error);
        }
        // Refused. Its bill deleted in QuickBooks meanwhile? Then both are left alone.
        const billNow = await readBill(access, billQbId, fetchImpl);
        if ("error" in billNow && billNow.error.kind === "notfound") {
          await drop("receipt", bill.id);
          return billGone(bill.id, null);
        }
        // Else not attached: the next try is a new upload.
        return refusedAt("receipt", bill.id, bill.id, record, hash, res.error, "add");
      }
    }
  };

  /** A step about a receipt: skipped once the database turns out not to have 0223. */
  const aboutReceipt = (step: SyncStep) =>
    step.op === "attach_receipt" || step.op === "remove_receipt" || ("recordType" in step && step.recordType === "receipt");
  let receiptsOff = false;

  for (const step of steps) {
    if (receiptsOff && aboutReceipt(step)) continue;
    const writesQuickBooks = step.op !== "drop" && step.op !== "wait" && step.op !== "settle";
    if (writesQuickBooks && (writes >= cap || Date.now() > deadline)) {
      summary.more = true;
      break;
    }
    try {
      await doStep(step);
    } catch (err) {
      if (err instanceof StopRun) {
        summary.error = err.message;
        summary.more = true;
        return;
      }
      if (err instanceof NoReceipts) {
        // Bills and payments still go; receipts start once 0223 is run.
        receiptsOff = true;
        continue;
      }
      throw err;
    }
  }
}

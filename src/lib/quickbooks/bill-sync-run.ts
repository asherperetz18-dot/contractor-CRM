import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { leadDisplayName, type ContactType } from "@/lib/data/types";
import { isMissingSchemaError } from "@/lib/schema-drift";
import { quickBooksAccess } from "./connection";
import {
  createBill,
  createBillPayment,
  createVendor,
  deleteBill,
  findVendor,
  readBill,
  readBillPayment,
  updateBill,
  voidBillPayment,
  type QbAccess,
  type QbError,
} from "./api";
import {
  WAIT,
  billBody,
  billMemo,
  billPaymentBody,
  nextTryAt,
  planBillSync,
  qbCreateRequestId,
  qbRequestId,
  qbVendorName,
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
 * call at a time, writing quickbooks_sync after each. Stops at the write
 * cap or the time budget; the rest goes next run.
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
/** QuickBooks not answering this many times in a row: it's down, stop for now. */
const MAX_TRANSIENT = 3;

const RECORD_COLUMNS = "record_type, record_id, bill_id, qb_id, qb_hash, status, reason, tries, next_try_at, sent_at";
const BILL_COLUMNS =
  "id, vendor_id, vendor_name, lead_id, estimate_payment_id, reference, amount_cents, bill_date, due_date, voided_at, created_at";
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
    .select("realm_id, disconnected_at, send_bills, send_bills_from")
    .eq("company_id", companyId)
    .maybeSingle<{ realm_id: string | null; disconnected_at: string | null; send_bills: boolean; send_bills_from: string | null }>();
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
    await run(admin, companyId, realmId, sendFrom, got.access, fetchImpl, opts, summary);
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
  access: QbAccess,
  fetchImpl: typeof fetch,
  opts: { writeCap?: number; budgetMs?: number; force?: boolean },
  summary: BillSyncSummary
) {
  const deadline = Date.now() + (opts.budgetMs ?? 120_000);
  const cap = opts.writeCap ?? 100;

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
      account: account ? { id: account.id, name: account.name, kind: account.kind, qbAccountId: account.qb_account_id } : null,
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
  const paymentBill = new Map(payments.map((x) => [x.id, x.billId]));
  // QuickBooks' id for each bill, as it stands during this run.
  const billQb = new Map(
    records.filter((r) => r.record_type === "bill" && r.qb_id && r.status !== "removed").map((r) => [r.record_id, r.qb_id!])
  );
  const vendorIds = new Map<string, string>();
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
    if (error) throw new Error(error.message);
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

  /** QuickBooks said no: what that means for this record, and for the run. */
  const refused = async (type: RecordType, id: string, billId: string | null, record: SyncRecord | null, hash: string | null, err: QbError) => {
    if (err.kind === "auth") {
      await admin.from("quickbooks_connections").update({ last_error: err.message, updated_at: new Date().toISOString() }).eq("company_id", companyId);
      throw new StopRun(err.message);
    }
    if (err.kind === "throttle") throw new StopRun(err.message);
    if (err.kind === "transient" || err.kind === "stale") {
      transient += 1;
      // Not sent yet: say so meanwhile. Already in QuickBooks: it stays as
      // it was there, and the change is tried again next run.
      if (!record?.qb_id || record.status === "removed") {
        await save(type, id, billId, { status: "waiting", reason: err.message, qb_hash: hash, next_try_at: null });
      }
      if (transient >= MAX_TRANSIENT) throw new StopRun(err.message);
      return;
    }
    const tries = (record?.tries ?? 0) + 1;
    await save(type, id, billId, {
      status: "failed",
      reason: err.message,
      qb_hash: hash,
      tries,
      // Gone from QuickBooks: trying again won't bring it back.
      next_try_at: err.kind === "notfound" ? null : nextTryAt(tries, new Date()),
    });
    summary.failed += 1;
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
    // Per day: a retry today is the same request; a vendor removed in
    // QuickBooks since is added fresh tomorrow, not answered with the old one.
    const made = await createVendor(access, clean, qbRequestId([companyId, realmId, "vendor", key, new Date().toISOString().slice(0, 10)]), fetchImpl);
    if ("error" in made) {
      if (made.error.kind === "duplicate") {
        return { wait: `QuickBooks already has a customer or employee named "${clean}". Rename the vendor in the CRM or in QuickBooks.` };
      }
      return made;
    }
    vendorIds.set(key, made.id);
    return { id: made.id };
  };

  /** A vendor problem holds the record, tried again later like a refusal. */
  const vendorWait = async (type: RecordType, id: string, billId: string, record: SyncRecord | null, hash: string, reason: string) => {
    const tries = (record?.tries ?? 0) + 1;
    await save(type, id, billId, { status: "waiting", reason, qb_hash: hash, tries, next_try_at: nextTryAt(tries, new Date()) });
    summary.waiting += 1;
  };

  const doStep = async (step: SyncStep) => {
    switch (step.op) {
      case "drop":
        await drop(step.recordType, step.recordId);
        return;
      case "wait":
        await save(step.recordType, step.recordId, step.billId, {
          status: "waiting",
          reason: step.reason,
          qb_hash: step.hash,
          qb_id: null,
          next_try_at: null,
        });
        summary.waiting += 1;
        return;
      case "void_payment": {
        const r = step.record;
        writes += 1;
        const current = await readBillPayment(access, r.qb_id!, fetchImpl);
        if ("error" in current && current.error.kind !== "notfound") return refused("bill_payment", r.record_id, r.bill_id, r, r.qb_hash, current.error);
        if (!("error" in current)) {
          const done = await voidBillPayment(access, current, qbRequestId([companyId, realmId, "bill_payment", r.record_id, "void", current.syncToken]), fetchImpl);
          if ("error" in done && done.error.kind !== "notfound") return refused("bill_payment", r.record_id, r.bill_id, r, r.qb_hash, done.error);
        }
        await save("bill_payment", r.record_id, r.bill_id, { status: "removed", reason: null, next_try_at: null, tries: 0 });
        summary.removed += 1;
        return;
      }
      case "delete_bill": {
        const r = step.record;
        writes += 1;
        const current = await readBill(access, r.qb_id!, fetchImpl);
        if ("error" in current && current.error.kind !== "notfound") return refused("bill", r.record_id, r.record_id, r, r.qb_hash, current.error);
        if (!("error" in current)) {
          const done = await deleteBill(access, current, qbRequestId([companyId, realmId, "bill", r.record_id, "delete", current.syncToken]), fetchImpl);
          if ("error" in done && done.error.kind !== "notfound") return refused("bill", r.record_id, r.record_id, r, r.qb_hash, done.error);
        }
        await save("bill", r.record_id, r.record_id, { status: "removed", qb_id: null, reason: null, next_try_at: null, tries: 0 });
        billQb.delete(r.record_id);
        summary.removed += 1;
        return;
      }
      case "create_bill":
      case "update_bill": {
        const { bill, hash, record } = step;
        const vendor = await vendorFor(bill.vendorName);
        if ("wait" in vendor) return vendorWait("bill", bill.id, bill.id, record, hash, vendor.wait);
        if ("error" in vendor) return refused("bill", bill.id, bill.id, record, hash, vendor.error);
        const body = billBody(bill, { vendorId: vendor.id, accountId: step.accountId });
        writes += 1;
        let result;
        if (step.op === "create_bill") {
          result = await createBill(access, body, qbCreateRequestId({ companyId, realmId }, "bill", bill.id, hash, record), fetchImpl);
        } else {
          let current = await readBill(access, record!.qb_id!, fetchImpl);
          if ("error" in current) {
            const err =
              current.error.kind === "notfound"
                ? { ...current.error, message: "It was deleted in QuickBooks, so changes to it aren't sent." }
                : current.error;
            return refused("bill", bill.id, bill.id, record, hash, err);
          }
          result = await updateBill(access, current, body, qbRequestId([companyId, realmId, "bill", bill.id, "update", hash, current.syncToken]), fetchImpl);
          // Changed in QuickBooks meanwhile: read it again, once.
          if ("error" in result && result.error.kind === "stale") {
            current = await readBill(access, record!.qb_id!, fetchImpl);
            if ("error" in current) return refused("bill", bill.id, bill.id, record, hash, current.error);
            result = await updateBill(access, current, body, qbRequestId([companyId, realmId, "bill", bill.id, "update", hash, current.syncToken]), fetchImpl);
          }
        }
        if ("error" in result) return refused("bill", bill.id, bill.id, record, hash, result.error);
        await save("bill", bill.id, bill.id, {
          status: "sent",
          qb_id: result.id,
          qb_hash: hash,
          reason: null,
          tries: 0,
          next_try_at: null,
          sent_at: new Date().toISOString(),
        });
        billQb.set(bill.id, result.id);
        if (step.op === "create_bill") summary.sent += 1;
        else summary.changed += 1;
        return;
      }
      case "create_payment": {
        const { payment, hash, record } = step;
        const bill = billById.get(paymentBill.get(payment.id) ?? "");
        const billQbId = billQb.get(payment.billId);
        if (!bill || !billQbId) {
          await save("bill_payment", payment.id, payment.billId, { status: "waiting", reason: WAIT.billFirst, qb_hash: hash, qb_id: null, next_try_at: null });
          summary.waiting += 1;
          return;
        }
        const vendor = await vendorFor(bill.vendorName);
        if ("wait" in vendor) return vendorWait("bill_payment", payment.id, payment.billId, record, hash, vendor.wait);
        if ("error" in vendor) return refused("bill_payment", payment.id, payment.billId, record, hash, vendor.error);
        writes += 1;
        const made = await createBillPayment(
          access,
          billPaymentBody(payment, { vendorId: vendor.id, billQbId }),
          qbCreateRequestId({ companyId, realmId }, "bill_payment", payment.id, hash, record),
          fetchImpl
        );
        if ("error" in made) return refused("bill_payment", payment.id, payment.billId, record, hash, made.error);
        await save("bill_payment", payment.id, payment.billId, {
          status: "sent",
          qb_id: made.id,
          qb_hash: hash,
          reason: null,
          tries: 0,
          next_try_at: null,
          sent_at: new Date().toISOString(),
        });
        summary.sent += 1;
        return;
      }
    }
  };

  for (const step of steps) {
    const writesQuickBooks = step.op !== "drop" && step.op !== "wait";
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
      throw err;
    }
  }
}

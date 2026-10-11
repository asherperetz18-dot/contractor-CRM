import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { leadDisplayName, type ContactType } from "@/lib/data/types";
import { isMissingSchemaError } from "@/lib/schema-drift";
import { RECEIPT_BUCKET } from "@/lib/receipts";
import { quickBooksAccess } from "./connection";
import { billJobLinks } from "./bill-jobs";
import { categoryKey, type QbAccount } from "./accounts";
import {
  createPurchase,
  createVendor,
  customerStanding,
  deleteAttachable,
  deletePurchase,
  findAttachableByNote,
  findVendor,
  readAttachable,
  readPreferences,
  readPurchase,
  updatePurchase,
  uploadReceipt,
  type QbAccess,
  type QbError,
} from "./api";
import { LOOKUP_FAILED, inQuickBooks, type InDoubt, type RecordType, type SyncRecord } from "./bill-status";
import { billMemo, keptOutReason, lastSentTag, newRequestId, nextTryAt, qbVendorName } from "./bill-sync";
import type { BillSyncSummary } from "./bill-sync-run";
import { COST_WAIT, isCostRecord } from "./cost-status";
import {
  closeDateFor,
  payoutAccountOf,
  planCostSync,
  purchaseBody,
  purchaseRetagBody,
  purchaseUpdateBody,
  type CostStep,
  type SyncCost,
} from "./cost-sync";

/**
 * One company's turn of the QuickBooks job-costs job (DECISIONS #199), from
 * the five-minute job (/api/cron/quickbooks-sync) or Send now.
 *
 * Claims the company first (quickbooks_connections.costs_claimed_until),
 * so two runs never send its costs at once. Reads QuickBooks' closing date
 * (or the invoices job's, when it's under 10 minutes old); then what was
 * sent, the "Already paid" costs dated from the start date and the ones
 * already sent, and what's needed to describe them; asks planCostSync what
 * to do; does it, one QuickBooks call at a time, writing quickbooks_sync
 * after each. Only lender fees ever go, each as an expense. Before adding
 * one it writes down the exact request (`doubt`), so a run cut off mid-way
 * is finished by repeating that request, never by adding it again. A fee's
 * receipt is downloaded from storage and attached to its expense, with a
 * note unique to the try written down first.
 *
 * Never writes job_expenses (a cost stays editable in the CRM), never adds
 * customers or jobs (the invoices job does), never uses the default
 * account, and never deletes in QuickBooks a cost whose customer was
 * deleted: the order of the reads below is what tells the two apart.
 * Stops starting work at the time budget or the write cap; the rest goes
 * next run.
 */

type Admin = ReturnType<typeof createAdminClient>;

export type CostSyncSummary = BillSyncSummary;

const IN_CHUNK = 100;
/** Longer than any one run can take (the job's limit is five minutes). */
const CLAIM_MINUTES = 6;
/** QuickBooks not answering this many times in a run: it's down, stop for now. */
const MAX_TRANSIENT = 3;
/** Past the budget, a call already started gets this long before it's cut off. */
const GRACE_MS = 25_000;
/** The largest file QuickBooks takes as an attachment. */
const QB_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
// PREFS_FRESH_MS, closeDateFor and payoutAccountOf come from ./cost-sync.ts (pure, tested there).

export const NEEDS_0230_RUN = "QuickBooks needs a database update first: run 0230_quickbooks_job_costs.sql in Supabase.";

const RECORD_COLUMNS =
  "record_type, record_id, bill_id, lead_id, qb_id, qb_hash, tried_hash, doubt, status, failed_op, reason, tries, next_try_at, sent_at";
const COST_COLUMNS = "id, lead_id, estimate_payment_id, vendor, vendor_id, description, amount_cents, spent_on, source, receipt_path, lender_fee";

type Connection = {
  realm_id: string | null;
  disconnected_at: string | null;
  send_costs: boolean;
  send_costs_from: string | null;
  lender_payouts_account_id: string | null;
  accounts: QbAccount[] | null;
  qb_prefs: unknown;
  qb_prefs_read_at: string | null;
};
type CostRow = {
  id: string;
  lead_id: string;
  estimate_payment_id: string | null;
  vendor: string | null;
  vendor_id: string | null;
  description: string | null;
  amount_cents: number;
  spent_on: string;
  source: string;
  receipt_path: string | null;
  lender_fee: boolean | null;
};
type LeadRow = { id: string; first_name: string | null; last_name: string | null; company_name: string | null; contact_type: ContactType };

class StopRun extends Error {}

/**
 * Every row of a query, page by page -- and a failed read stops the run.
 * Not data/select-all.ts: it answers a failed read with no rows, and here
 * "no rows" would read as "nothing was ever sent" (every fee sent twice) or
 * "every cost was deleted" (every expense deleted in QuickBooks).
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

const empty = (): CostSyncSummary => ({ sent: 0, changed: 0, removed: 0, waiting: 0, failed: 0, more: false });

export async function syncCompanyCosts(
  admin: Admin,
  companyId: string,
  opts: { writeCap?: number; budgetMs?: number; force?: boolean; fetchImpl?: typeof fetch } = {}
): Promise<CostSyncSummary> {
  const summary = empty();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const { data: conn, error: connError } = await admin
    .from("quickbooks_connections")
    .select("realm_id, disconnected_at, send_costs, send_costs_from, lender_payouts_account_id, accounts, qb_prefs, qb_prefs_read_at")
    .eq("company_id", companyId)
    .maybeSingle<Connection>();
  if (connError) return { ...summary, error: isMissingSchemaError(connError) ? NEEDS_0230_RUN : connError.message };
  if (!conn?.realm_id || conn.disconnected_at) return { ...summary, error: "Connect QuickBooks first." };
  if (!conn.send_costs || !conn.send_costs_from) return { ...summary, error: "Sending job costs to QuickBooks is off." };
  const realmId = conn.realm_id;
  const sendFrom = conn.send_costs_from;

  // One run at a time per company: a claim that runs out by itself if a run dies.
  const started = new Date();
  const { data: claimed, error: claimError } = await admin
    .from("quickbooks_connections")
    .update({ costs_claimed_until: new Date(started.getTime() + CLAIM_MINUTES * 60_000).toISOString() })
    .eq("company_id", companyId)
    .or(`costs_claimed_until.is.null,costs_claimed_until.lt."${started.toISOString()}"`)
    .select("company_id");
  if (claimError) return { ...summary, error: claimError.message };
  if (!claimed?.length) return { ...summary, busy: true };

  try {
    const got = await quickBooksAccess(admin, companyId, fetchImpl);
    if ("error" in got) return { ...summary, error: got.error };
    if (got.access.realmId !== realmId) return { ...summary, error: "QuickBooks needs you to connect again." };

    // QuickBooks' closing date: the invoices job's read when it's fresh (it runs first in the same pass), else
    // read now. A read that fails stops the run before anything is read or written: never "books open" by guess.
    const known = closeDateFor(conn, new Date());
    let closeDate: string | null;
    if (known !== "read") closeDate = known.closeDate;
    else {
      const prefs = await readPreferences(got.access, fetchImpl);
      if ("error" in prefs) {
        if (prefs.error.kind === "auth") {
          await admin.from("quickbooks_connections").update({ last_error: prefs.error.message, updated_at: new Date().toISOString() }).eq("company_id", companyId);
        }
        return { ...summary, error: prefs.error.message };
      }
      await admin
        .from("quickbooks_connections")
        .update({ qb_prefs: prefs.prefs, qb_prefs_read_at: new Date().toISOString() })
        .eq("company_id", companyId);
      closeDate = prefs.prefs.bookCloseDate;
    }
    // The accounts are kept as read from QuickBooks at connect (and on Refresh).
    const payoutAccount = payoutAccountOf(Array.isArray(conn.accounts) ? conn.accounts : [], conn.lender_payouts_account_id);
    await run(admin, companyId, realmId, sendFrom, payoutAccount, closeDate, got.access, fetchImpl, opts, summary);
    return summary;
  } finally {
    await admin
      .from("quickbooks_connections")
      .update({ costs_claimed_until: null, costs_checked_at: new Date().toISOString() })
      .eq("company_id", companyId);
  }
}

async function run(
  admin: Admin,
  companyId: string,
  realmId: string,
  sendFrom: string,
  payoutAccount: string | null,
  closeDate: string | null,
  access: QbAccess,
  baseFetch: typeof fetch,
  opts: { writeCap?: number; budgetMs?: number; force?: boolean },
  summary: CostSyncSummary
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
  // The order matters, and each read waits for the one before it. A cost gone with its customer is left in
  // QuickBooks; one deleted with ✎ Edit is deleted there. Deleting a customer adds its trash row, then deletes it
  // and its costs together; restoring puts the customer back, then its costs, and only then removes the trash
  // row. So: the trash before the costs (a restore under way), the costs, then the customers and the trash
  // again (a delete or restore that happened meanwhile). Read the other way round, a customer deleted while
  // this runs would look like costs deleted with ✎ Edit.

  // 1. What was sent: this job's records, and the customers and jobs the invoices job added (for the tags).
  const records = await readAll<SyncRecord>((f, t) =>
    admin
      .from("quickbooks_sync")
      .select(RECORD_COLUMNS)
      .eq("company_id", companyId)
      .eq("realm_id", realmId)
      .in("record_type", ["expense", "expense_receipt", "customer", "job"])
      .order("record_type")
      .order("record_id")
      .range(f, t)
  );
  const costRecords = records.filter(isCostRecord);
  const recordLeads = costRecords.map((r) => r.lead_id ?? "");

  // 2. Customers being deleted or restored, before the costs are read.
  const trashBefore = await inChunks<{ lead_id: string }>(recordLeads, (chunk) =>
    admin.from("lead_trash").select("lead_id").eq("company_id", companyId).in("lead_id", chunk)
  );

  // 3. The costs: "Already paid" ones dated from the start date, and any already sent (whatever their date now).
  const recent = await readAll<CostRow>((f, t) =>
    admin
      .from("job_expenses")
      .select(COST_COLUMNS)
      .eq("company_id", companyId)
      .eq("source", "manual")
      .gte("spent_on", sendFrom)
      .order("id")
      .range(f, t)
  );
  const have = new Set(recent.map((x) => x.id));
  const tracked = await inChunks<CostRow>(
    costRecords.map((r) => r.record_id).filter((id) => !have.has(id)),
    (chunk) => admin.from("job_expenses").select(COST_COLUMNS).eq("company_id", companyId).in("id", chunk)
  );
  const costRows = [...recent, ...tracked];
  // Only "Already paid" costs are this job's (a bill's cost is the bills job's).
  const billCosts = new Set(costRows.filter((x) => x.source !== "manual").map((x) => x.id));

  // 4. A cost paid through a bill payment is the bills job's too.
  const paidByBill = await inChunks<{ job_expense_id: string }>(
    costRows.map((x) => x.id),
    (chunk) => admin.from("vendor_bill_payments").select("job_expense_id").eq("company_id", companyId).in("job_expense_id", chunk)
  );
  for (const p of paidByBill) billCosts.add(p.job_expense_id);

  // 5. After the costs: their customers, the trash again, the vendors, and the account matched to "Financing fee".
  const [leads, trashAfter, vendors, feeMatch] = await Promise.all([
    inChunks<LeadRow>([...costRows.map((x) => x.lead_id), ...recordLeads], (chunk) =>
      admin.from("leads").select("id, first_name, last_name, company_name, contact_type").eq("company_id", companyId).in("id", chunk)
    ),
    inChunks<{ lead_id: string }>(recordLeads, (chunk) =>
      admin.from("lead_trash").select("lead_id").eq("company_id", companyId).in("lead_id", chunk)
    ),
    inChunks<{ id: string; name: string }>(
      costRows.map((x) => x.vendor_id ?? ""),
      (chunk) => admin.from("vendors").select("id, name").eq("company_id", companyId).in("id", chunk)
    ),
    // Never the default account (decision 4): a fee waits until "Financing fee" is matched.
    admin
      .from("quickbooks_expense_accounts")
      .select("category_key, qb_account_id")
      .eq("company_id", companyId)
      .eq("category_key", categoryKey("Financing fee"))
      .maybeSingle<{ category_key: string; qb_account_id: string }>(),
  ]);
  if (feeMatch.error) throw new Error(feeMatch.error.message);

  // 6-7. Each cost's job, as bills find theirs (DECISIONS #184), and its contract for the memo.
  const links = await billJobLinks(admin, companyId, costRows);
  const estimates = await inChunks<{ id: string; doc_number: string | null; title: string | null }>(
    [...links.values()].map((l) => l.contractId ?? ""),
    (chunk) => admin.from("estimates").select("id, doc_number, title").eq("company_id", companyId).in("id", chunk)
  );

  const vendorById = new Map(vendors.map((v) => [v.id, v]));
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const estimateById = new Map(estimates.map((e) => [e.id, e]));
  const recordOf = new Map(records.map((r) => [`${r.record_type}:${r.record_id}`, r]));
  const lastTagOf = (costId: string) => lastSentTag(recordOf.get(`expense:${costId}`)?.qb_hash);
  // Its job in QuickBooks, once step 3 has added it (DECISIONS #184); else its customer.
  const tagOf = (costId: string) => {
    const link = links.get(costId);
    if (!link) return null;
    const last = lastTagOf(costId);
    for (const r of [link.contractId ? recordOf.get(`job:${link.contractId}`) : undefined, recordOf.get(`customer:${link.leadId}`)]) {
      if (!r) continue;
      // Made inactive in QuickBooks (a finished job): expenses already on it stay on it; new ones go on the next one up.
      if (r.status === "gone" && r.qb_id && r.qb_id === last && inQuickBooks(recordOf.get(`expense:${costId}`))) return last;
      if (inQuickBooks(r)) return r.qb_id!;
    }
    return null;
  };
  // A cost whose customer wasn't there when the customers were read (deleted after the costs were): left
  // alone this run, as a bill's cost is, and next run reads it gone with its customer. Planned now, it
  // would go without its customer's name in the memo: a change sent for a deleted customer.
  const leftAlone = costRows.filter((x) => !leadById.has(x.lead_id)).map((x) => x.id);
  const costs: SyncCost[] = costRows
    .filter((x) => x.source === "manual" && !billCosts.has(x.id) && !leftAlone.includes(x.id))
    .map((x) => {
      const vendor = x.vendor_id ? vendorById.get(x.vendor_id) : undefined;
      const lead = leadById.get(x.lead_id);
      const link = links.get(x.id);
      // The job's contract (a fee is on no stage, so not the stage's).
      const est = link?.contractId ? estimateById.get(link.contractId) : undefined;
      return {
        id: x.id,
        leadId: x.lead_id,
        lenderFee: x.lender_fee === true,
        vendorName: vendor?.name ?? x.vendor,
        description: x.description,
        amountCents: Number(x.amount_cents),
        spentOn: x.spent_on,
        memo: billMemo({ docNumber: est?.doc_number ?? null, customer: lead ? leadDisplayName(lead) : null, title: est?.title ?? null }),
        receiptPath: x.receipt_path ?? null,
        tag: tagOf(x.id),
        contractId: link?.contractId ?? null,
      };
    });

  const steps = planCostSync({
    costs,
    billCosts: new Set([...billCosts, ...leftAlone]),
    liveLeads: new Set(leads.map((l) => l.id)),
    inTrash: new Set([...trashBefore, ...trashAfter].map((t) => t.lead_id)),
    records,
    sendFrom,
    now: new Date(),
    settings: { payoutAccount, feeAccount: feeMatch.data?.qb_account_id ?? null },
    closeDate,
    force: opts.force,
  });

  // ---------------------------------------------------------------- write
  // QuickBooks' id for each cost's expense, as it stands during this run.
  const expenseQb = new Map(records.filter((r) => r.record_type === "expense" && inQuickBooks(r)).map((r) => [r.record_id, r.qb_id!]));
  const vendorIds = new Map<string, string>();
  // Expenses whose receipt didn't come off this run (or whose delete is held): not deleted until it does.
  const held = new Set<string>();
  let writes = 0;
  let transient = 0;

  /** A cost's record; `bill_id` carries the cost's id (as bills'), `lead_id` its customer as last seen. */
  const save = async (type: RecordType, id: string, leadId: string | null, fields: Partial<SyncRecord>) => {
    const { error } = await admin.from("quickbooks_sync").upsert(
      {
        company_id: companyId,
        realm_id: realmId,
        record_type: type,
        record_id: id,
        bill_id: id,
        lead_id: leadId,
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
  const isTransient = (err: QbError) => err.kind === "transient" || err.kind === "stale";
  /** QuickBooks refused a version for good: say why, rest, try again later or when it changes. */
  const refusedAt = async (
    type: RecordType,
    id: string,
    leadId: string | null,
    record: SyncRecord | null,
    hash: string,
    err: QbError,
    op: "add" | "change"
  ) => {
    const tries = (record?.failed_op === op ? record.tries : 0) + 1;
    await save(type, id, leadId, {
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
  /** A vendor lookup QuickBooks didn't answer: a fee not sent yet says so meanwhile. */
  const vendorTrouble = async (id: string, leadId: string, record: SyncRecord | null, hash: string, err: QbError) => {
    await stopIf(err);
    if (isTransient(err)) {
      if (!inQuickBooks(record)) await save("expense", id, leadId, { status: "waiting", reason: err.message, tried_hash: hash, next_try_at: null });
      return countTransient(err);
    }
    return refusedAt("expense", id, leadId, record, hash, err, inQuickBooks(record) ? "change" : "add");
  };
  /** QuickBooks refused a delete (or it's held by closed books): say why, try again later. */
  const removalRefused = async (type: RecordType, r: SyncRecord, what: string, err: QbError) => {
    const tries = (r.failed_op === "remove" ? r.tries : 0) + 1;
    await save(type, r.record_id, r.lead_id ?? null, {
      status: "failed",
      failed_op: "remove",
      reason: `Couldn't ${what} it in QuickBooks. ${err.message}`,
      tries,
      next_try_at: nextTryAt(tries, new Date()),
    });
    summary.failed += 1;
  };
  /** Someone deleted the expense in QuickBooks: the CRM leaves it alone, and nothing more is done to it this run. */
  const expenseGone = async (id: string, leadId: string | null, hash: string | null) => {
    await save("expense", id, leadId, { status: "gone", reason: COST_WAIT.gone, tried_hash: hash, next_try_at: null });
    expenseQb.delete(id);
    summary.failed += 1;
  };
  /** Can't go yet for a reason found while sending (a vendor, closed books there): rests like a refusal. */
  const waitAt = async (type: RecordType, id: string, leadId: string, record: SyncRecord | null, hash: string, reason: string) => {
    const tries = (record?.tries ?? 0) + 1;
    await save(type, id, leadId, { status: "waiting", reason, tried_hash: hash, tries, next_try_at: nextTryAt(tries, new Date()) });
    summary.waiting += 1;
  };

  /** QuickBooks has it dated in a month its books have closed (the bookkeeper may have re-dated it there). */
  const closedThere = (txnDate: string | null) => !!closeDate && !!txnDate && txnDate <= closeDate;

  /** Takes off the attachment the CRM put on an expense. Only a read saying "not found" means it's already gone. */
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
    const body = (doubt.body ?? {}) as { note?: unknown; purchaseQbId?: unknown };
    if (!opts.force && r.next_try_at && new Date(r.next_try_at).getTime() > Date.now()) return;
    const found =
      typeof body.note === "string"
        ? await findAttachableByNote(
            access,
            { note: body.note, billQbId: typeof body.purchaseQbId === "string" ? body.purchaseQbId : null, entity: "Purchase" },
            fetchImpl
          )
        : ({ attachable: null } as const);
    const leadId = r.lead_id ?? null;
    if ("error" in found) {
      await stopIf(found.error);
      if (isTransient(found.error)) return countTransient(found.error);
      const tries = r.tries + 1;
      await save("expense_receipt", r.record_id, leadId, {
        status: "waiting",
        reason: `${LOOKUP_FAILED} ${found.error.message}`,
        tries,
        next_try_at: nextTryAt(tries, new Date()),
      });
      summary.waiting += 1;
      return;
    }
    if (found.attachable) {
      await save("expense_receipt", r.record_id, leadId, sentNow(found.attachable.id, doubt.hash));
      summary.sent += 1;
      return;
    }
    // Not there: sent again next run.
    await save("expense_receipt", r.record_id, leadId, {
      doubt: null,
      status: "waiting",
      reason: "Didn't reach QuickBooks. Sending it again in a few minutes.",
      tried_hash: null,
      tries: 0,
      next_try_at: null,
    });
  };

  /** The QuickBooks vendor for a name: found, else added. Looked up first, so one the bills job added is used. */
  const vendorFor = async (name: string | null): Promise<{ id: string } | { wait: string } | { error: QbError }> => {
    const clean = qbVendorName(name);
    if (!clean) return { wait: COST_WAIT.noVendor };
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
   * Adds an expense. The exact request is written down first; if no answer
   * comes, it stays written down and the next run repeats it (same request
   * id: QuickBooks answers a repeat without adding it again).
   */
  const add = async (id: string, leadId: string | null, record: SyncRecord | null, doubt: InDoubt) => {
    await save("expense", id, leadId, record ? { doubt } : { doubt, status: "waiting", reason: "Being sent to QuickBooks now." });
    writes += 1;
    const res = await createPurchase(access, doubt.body, doubt.requestId, fetchImpl);
    if (!("error" in res)) {
      await save("expense", id, leadId, sentNow(res.id, doubt.hash));
      expenseQb.set(id, res.id);
      summary.sent += 1;
      return;
    }
    await stopIf(res.error);
    if (isTransient(res.error)) {
      // No answer: it may be in QuickBooks. Kept in doubt, repeated next run.
      await save("expense", id, leadId, { status: "waiting", reason: res.error.message, tried_hash: doubt.hash, next_try_at: null });
      countTransient(res.error);
      return;
    }
    // Refused: QuickBooks didn't add it. The next try is a new request. (Closed books: the next run's
    // closing date makes it one to enter by hand.)
    await refusedAt("expense", id, leadId, record, doubt.hash, res.error, "add");
    return res.error;
  };

  /**
   * An expense refused as naming what isn't there (code 610: "made inactive",
   * or merged away): if it's the job or customer it's tagged with, that one
   * isn't used any more, and the expense goes without it (or on the customer)
   * next run. Only the status is written: the invoices job's own record stays
   * as it is otherwise.
   */
  const recheckTag = async (tag: string | null | undefined) => {
    if (!tag) return;
    const res = await customerStanding(access, tag, fetchImpl);
    if ("error" in res || res.standing === "active") return;
    const reason = res.standing === "inactive" ? "Made inactive in QuickBooks." : "No longer in QuickBooks (merged or deleted there).";
    for (const r of records) {
      if ((r.record_type !== "customer" && r.record_type !== "job") || r.qb_id !== tag || !inQuickBooks(r)) continue;
      const { error } = await admin
        .from("quickbooks_sync")
        .update({ status: "gone", reason, next_try_at: null, updated_at: new Date().toISOString() })
        .eq("company_id", companyId)
        .eq("realm_id", realmId)
        .eq("record_type", r.record_type)
        .eq("record_id", r.record_id);
      if (error) throw new Error(error.message);
    }
  };

  const doStep = async (step: CostStep) => {
    switch (step.op) {
      case "drop":
        await drop(step.recordType, step.recordId);
        return;
      case "note_lead": {
        // The cost moved to another customer: only that is written.
        const { error } = await admin
          .from("quickbooks_sync")
          .update({ lead_id: step.leadId })
          .eq("company_id", companyId)
          .eq("realm_id", realmId)
          .eq("record_type", step.recordType)
          .eq("record_id", step.recordId);
        if (error) throw new Error(error.message);
        return;
      }
      case "settle":
        await save(step.recordType, step.recordId, step.leadId, {
          status: "sent",
          failed_op: null,
          reason: step.noteReason ?? null,
          tried_hash: step.noted ?? null,
          tries: 0,
          next_try_at: null,
        });
        return;
      case "wait":
        // A receipt says nothing of its own until its expense is in QuickBooks.
        if (step.recordType === "expense_receipt" && !expenseQb.has(step.recordId)) return;
        await save(step.recordType, step.recordId, step.leadId, {
          status: "waiting",
          reason: step.reason,
          tried_hash: step.hash,
          next_try_at: null,
        });
        summary.waiting += 1;
        return;
      case "resolve": {
        const r = step.record;
        if (r.record_type === "expense_receipt") return resolveReceipt(r);
        await add(r.record_id, r.lead_id ?? null, r, r.doubt!);
        return;
      }
      case "create_expense": {
        const { cost, hash, record } = step;
        const vendor = await vendorFor(cost.vendorName);
        if ("wait" in vendor) return waitAt("expense", cost.id, cost.leadId, record, hash, vendor.wait);
        if ("error" in vendor) return vendorTrouble(cost.id, cost.leadId, record, hash, vendor.error);
        const body = purchaseBody(cost, { vendorId: vendor.id, payoutAccountId: step.payoutAccountId, feeAccountId: step.feeAccountId });
        const refused = await add(cost.id, cost.leadId, record, { requestId: newRequestId(), body, hash });
        if (refused?.kind === "notfound") await recheckTag(cost.tag);
        return;
      }
      case "update_expense": {
        const { cost, hash, record } = step;
        const vendor = await vendorFor(cost.vendorName);
        if ("wait" in vendor) return waitAt("expense", cost.id, cost.leadId, record, hash, vendor.wait);
        if ("error" in vendor) return vendorTrouble(cost.id, cost.leadId, record, hash, vendor.error);
        writes += 1;
        let result: Awaited<ReturnType<typeof updatePurchase>> | null = null;
        // Read it as QuickBooks has it now; if it changed there meanwhile, once more.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const current = await readPurchase(access, record.qb_id!, fetchImpl);
          if ("error" in current) {
            if (current.error.kind === "notfound") {
              // Deleted in QuickBooks by someone there: the CRM leaves it alone.
              await expenseGone(cost.id, cost.leadId, hash);
              return;
            }
            result = current;
            break;
          }
          if (closedThere(current.txnDate)) return waitAt("expense", cost.id, cost.leadId, record, hash, COST_WAIT.closedChange(closeDate!));
          const update = purchaseUpdateBody(cost, current, { vendorId: vendor.id, lastTag: lastTagOf(cost.id) });
          if ("wait" in update) return waitAt("expense", cost.id, cost.leadId, record, hash, update.wait);
          result = await updatePurchase(access, update.body, newRequestId(), fetchImpl);
          if (!("error" in result) || result.error.kind !== "stale") break;
        }
        if (result && !("error" in result)) {
          await save("expense", cost.id, cost.leadId, sentNow(result.id, hash));
          summary.changed += 1;
          return;
        }
        const err = result!.error;
        await stopIf(err);
        // No answer: QuickBooks keeps what it had; the change goes next run.
        if (isTransient(err)) return countTransient(err);
        await refusedAt("expense", cost.id, cost.leadId, record, hash, err, "change");
        if (err.kind === "notfound") await recheckTag(cost.tag);
        return;
      }
      case "retag_expense": {
        const { cost, hash, record } = step;
        // Closed books keep the job change out: noted (the hash keeps the tag really sent), as the planner does.
        const keptOut = () =>
          save("expense", cost.id, cost.leadId, { status: "sent", failed_op: null, reason: keptOutReason(closeDate), tried_hash: hash, tries: 0, next_try_at: null });
        writes += 1;
        let result: Awaited<ReturnType<typeof updatePurchase>> | null = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const current = await readPurchase(access, record.qb_id!, fetchImpl);
          if ("error" in current) {
            if (current.error.kind === "notfound") {
              await expenseGone(cost.id, cost.leadId, hash);
              return;
            }
            result = current;
            break;
          }
          const body = purchaseRetagBody(cost, current, lastTagOf(cost.id));
          // No line is the CRM's to move (the bookkeeper tagged them): noted as done.
          if (!body) {
            await save("expense", cost.id, cost.leadId, sentNow(current.id, hash));
            return;
          }
          if (closedThere(current.txnDate)) return keptOut();
          result = await updatePurchase(access, body, newRequestId(), fetchImpl);
          if (!("error" in result) || result.error.kind !== "stale") break;
        }
        if (result && !("error" in result)) {
          await save("expense", cost.id, cost.leadId, sentNow(result.id, hash));
          summary.changed += 1;
          return;
        }
        const err = result!.error;
        await stopIf(err);
        if (isTransient(err)) return countTransient(err);
        if (err.code === "6210" || /books are closed/.test(err.message)) return keptOut();
        await refusedAt("expense", cost.id, cost.leadId, record, hash, err, "change");
        if (err.kind === "notfound") await recheckTag(cost.tag);
        return;
      }
      case "remove_receipt": {
        const r = step.record;
        const id = r.record_id;
        // Its expense was found deleted in QuickBooks this run: left alone. (A receipt record with no
        // expense record at all -- shouldn't happen -- goes by its own QuickBooks id.)
        if (!expenseQb.has(id) && recordOf.has(`expense:${id}`)) return;
        writes += 1;
        if (step.forDelete) {
          // The expense goes too. Closed books hold the delete: checked first, so the receipt stays on it
          // rather than coming off an expense that then can't be deleted.
          const current = await readPurchase(access, expenseQb.get(id)!, fetchImpl);
          if ("error" in current) {
            // Not found: already deleted there, so its receipt comes off (if it's still there) and the delete is noted.
            if (current.error.kind !== "notfound") {
              held.add(id);
              await stopIf(current.error);
              if (isTransient(current.error)) return countTransient(current.error);
              return removalRefused("expense", step.forDelete, "delete", current.error);
            }
          } else if (closedThere(current.txnDate)) {
            held.add(id);
            return removalRefused("expense", step.forDelete, "delete", { kind: "validation", code: "6210", message: COST_WAIT.closedRemoval });
          }
        }
        const off = await takeOffReceipt(r);
        if ("error" in off) {
          held.add(id);
          await stopIf(off.error);
          if (isTransient(off.error)) return countTransient(off.error);
          return removalRefused("expense_receipt", r, "remove", off.error);
        }
        await save("expense_receipt", id, r.lead_id ?? null, {
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
      case "delete_expense": {
        const r = step.record;
        // Its receipt is still on it in QuickBooks, or closed books hold it: next run.
        if (held.has(r.record_id)) return;
        writes += 1;
        // Only a read saying "not found" means it's already gone.
        const current = await readPurchase(access, r.qb_id!, fetchImpl);
        let err: QbError | null = "error" in current && current.error.kind !== "notfound" ? current.error : null;
        if (!err && !("error" in current)) {
          if (closedThere(current.txnDate)) {
            return removalRefused("expense", r, "delete", { kind: "validation", code: "6210", message: COST_WAIT.closedRemoval });
          }
          const done = await deletePurchase(access, current, newRequestId(), fetchImpl);
          if ("error" in done) err = done.error;
        }
        if (err) {
          await stopIf(err);
          if (isTransient(err)) return countTransient(err);
          return removalRefused("expense", r, "delete", err);
        }
        await save("expense", r.record_id, r.lead_id ?? null, {
          status: "removed",
          qb_id: null,
          failed_op: null,
          reason: null,
          tried_hash: null,
          next_try_at: null,
          tries: 0,
        });
        expenseQb.delete(r.record_id);
        summary.removed += 1;
        return;
      }
      case "attach_receipt": {
        const { cost, hash, file, record } = step;
        // Its expense didn't go this run: the receipt follows it next run.
        const purchaseQbId = expenseQb.get(cost.id);
        if (!purchaseQbId) return;
        writes += 1;
        // Its first row is written before the download.
        if (!record) await save("expense_receipt", cost.id, cost.leadId, { status: "waiting", reason: "Being sent to QuickBooks now." });
        const got = await receiptBytes(cost.receiptPath!);
        if ("missing" in got) return waitAt("expense_receipt", cost.id, cost.leadId, record, hash, "The receipt file couldn't be found. Attach it again.");
        if ("unreadable" in got) {
          await save("expense_receipt", cost.id, cost.leadId, {
            status: "waiting",
            reason: "The receipt file couldn't be read just now. Trying again in a few minutes.",
            tried_hash: hash,
            next_try_at: null,
          });
          summary.waiting += 1;
          return;
        }
        if (got.blob.size > QB_MAX_UPLOAD_BYTES) {
          return waitAt("expense_receipt", cost.id, cost.leadId, record, hash, "This receipt is too big for QuickBooks (over 100 MB). Attach a smaller copy.");
        }
        // Replaced in the CRM: the one it attached before comes off first (the bookkeeper's own files stay).
        const replacing = inQuickBooks(record);
        if (replacing) {
          const off = await takeOffReceipt(record!);
          if ("error" in off) {
            await stopIf(off.error);
            if (isTransient(off.error)) return countTransient(off.error);
            return refusedAt("expense_receipt", cost.id, cost.leadId, record, hash, off.error, "change");
          }
        }
        // Written down first, with a note unique to this try: a lost answer
        // is settled next run by looking for the note, never by uploading twice.
        const requestId = newRequestId();
        const note = `From the CRM, ref ${requestId}`;
        const doubt: InDoubt = { requestId, body: { note, purchaseQbId }, hash };
        await save("expense_receipt", cost.id, cost.leadId, {
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
          { billQbId: purchaseQbId, entity: "Purchase", fileName: file.fileName, contentType: file.contentType, note, bytes: got.blob },
          fetchImpl
        );
        if (!("error" in res)) {
          await save("expense_receipt", cost.id, cost.leadId, sentNow(res.id, hash));
          if (replacing) summary.changed += 1;
          else summary.sent += 1;
          return;
        }
        await stopIf(res.error);
        if (isTransient(res.error)) {
          // No answer: it may be in QuickBooks. Looked for by its note next run.
          await save("expense_receipt", cost.id, cost.leadId, { status: "waiting", reason: res.error.message, tried_hash: hash, next_try_at: null });
          return countTransient(res.error);
        }
        // Refused. Its expense deleted in QuickBooks meanwhile? Then both are left alone.
        const expenseNow = await readPurchase(access, purchaseQbId, fetchImpl);
        if ("error" in expenseNow && expenseNow.error.kind === "notfound") {
          await drop("expense_receipt", cost.id);
          return expenseGone(cost.id, cost.leadId, null);
        }
        // Else not attached: the next try is a new upload.
        return refusedAt("expense_receipt", cost.id, cost.leadId, record, hash, res.error, "add");
      }
    }
  };

  for (const step of steps) {
    const writesQuickBooks = step.op !== "drop" && step.op !== "wait" && step.op !== "settle" && step.op !== "note_lead";
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

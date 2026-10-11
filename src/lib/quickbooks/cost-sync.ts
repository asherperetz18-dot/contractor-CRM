import { createHash } from "node:crypto";
import type { QbPurchaseBody } from "./api.ts";
import { inQuickBooks, type RecordType, type SyncRecord } from "./bill-status.ts";
import type { QbAccount } from "./accounts.ts";
import {
  JOB_HASH,
  WAIT,
  dollars,
  jobTag,
  keptOutReason,
  lineTags,
  onlyJobDiffers,
  qbText,
  qbVendorName,
  receiptFile,
  receiptHash,
} from "./bill-sync.ts";
import { CHANGED_SINCE, COST_WAIT, baseCostReason, isCostRecord, toldHandCost, toldUndoCost } from "./cost-status.ts";

/**
 * QuickBooks, step 4 (DECISIONS #199): which job costs go to QuickBooks as
 * expenses, which change there, which come out, which wait, and which are
 * to be entered by hand. Pure: the runner (cost-sync-run.ts) reads the
 * rows, asks this what to do, then does it.
 *
 * - Only lender fees go (job_expenses.lender_fee, set by Funded), once
 *   dated on or after the company's job-costs start date: each as its own
 *   Expense, paid out of the bank account lenders pay into ("Lender payouts
 *   land in"), to the lender, in the account matched to "Financing fee"
 *   (never the default account), on its job, not billable. Once sent it
 *   follows its changes even if its date moves earlier.
 * - A fee waits, saying why, until it has a vendor, a payout account and a
 *   Financing fee match; then it goes on its own.
 * - Other "Already paid" costs from the start date, costs below zero and
 *   costs dated in QuickBooks' closed books are to be entered by hand, and
 *   stay so: never sent, dropped or called done later; a change in the CRM
 *   only adds "It changed in the CRM since" (step 3's rule).
 * - A change QuickBooks would show (vendor, amount, date, What for, memo,
 *   the job) is sent as a change to the same expense: what the bookkeeper
 *   set on it there (the line's account, a class, a customer) stays. A
 *   replaced receipt swaps only the one the CRM attached.
 * - A cost deleted with ✎ Edit is deleted in QuickBooks, its receipt
 *   first. A cost gone with its customer (deleted, or being deleted or
 *   restored) is left alone there, and a restore sends nothing twice.
 * - Never twice: before adding an expense the runner writes down the exact
 *   request, with a new request id; if the answer never comes, the next
 *   run repeats that request (same id) before anything else is done to it.
 */

export type SyncCost = {
  id: string;
  leadId: string;
  /** job_expenses.lender_fee: only these go (DECISIONS #199); any other cost is entered by hand. */
  lenderFee: boolean;
  /** vendors.name for vendor_id, else the typed vendor; null when neither. */
  vendorName: string | null;
  /** "What for": the line's description. */
  description: string | null;
  amountCents: number;
  /** spent_on: the payout day for a fee. */
  spentOn: string;
  /** billMemo() of its job: "EST-1058 · James Carter · Basement finish". */
  memo: string;
  /** job_expenses.receipt_path: "receipts/…" in storage, or "drive:<id>". */
  receiptPath: string | null;
  /** The QuickBooks job (or customer) id to tag its line with, once step 3 has added it; null = untagged. */
  tag: string | null;
  /** The CRM's own link (billJobLinks): for the by-hand "changed since" check only. */
  contractId: string | null;
};

/** A Purchase as QuickBooks has it now (readPurchase): what a change must name and keep. */
export type QbPurchaseNow = {
  id: string;
  syncToken: string;
  lines: Record<string, unknown>[];
  entityRef?: unknown;
  accountRef?: unknown;
  paymentType?: string | null;
};

// ---------------------------------------------------------------- hashes

const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

/** What QuickBooks would show of the expense: a change here is sent again. Accounts are left out on purpose
 *  (a new match or payout account isn't applied to what's already sent, like bills, DECISIONS #173). */
export function costHash(c: SyncCost): string {
  const base = sha(["expense", qbVendorName(c.vendorName), c.amountCents, c.spentOn, qbText(c.description, 4000), qbText(c.memo, 4000)]);
  return c.tag ? `${base}${JOB_HASH}${c.tag}` : base;
}

/** What the CRM has, for a cost told to be entered by hand: QuickBooks ids and the tag are left out, so adding
 *  its job in QuickBooks later doesn't read as "changed since". */
export function costCrmHash(c: SyncCost): string {
  return sha(["expense-crm", qbVendorName(c.vendorName), c.amountCents, c.spentOn, qbText(c.description, 4000), c.leadId, c.contractId]);
}

// ---------------------------------------------------------------- what is sent

/** A new expense: paid out of the bank account lenders pay into, to the lender, on its job, not billable. */
export function purchaseBody(c: SyncCost, ref: { vendorId: string; payoutAccountId: string; feeAccountId: string }): QbPurchaseBody {
  const description = qbText(c.description, 4000);
  return {
    // How QuickBooks stores its "Expense" form paid from a bank account (not "Check", which prints as a check).
    PaymentType: "Cash",
    AccountRef: { value: ref.payoutAccountId },
    EntityRef: { value: ref.vendorId, type: "Vendor" },
    TxnDate: c.spentOn,
    PrivateNote: qbText(c.memo, 4000),
    Line: [
      {
        DetailType: "AccountBasedExpenseLineDetail",
        Amount: dollars(c.amountCents),
        ...(description ? { Description: description } : {}),
        AccountBasedExpenseLineDetail: { AccountRef: { value: ref.feeAccountId }, ...jobTag(c.tag) },
      },
    ],
  };
}

/** What QuickBooks has in an expense's header that a change sends back as it is (a bookkeeper's fix stays). */
const keptHeader = (current: QbPurchaseNow) => ({
  ...(current.paymentType ? { PaymentType: current.paymentType } : {}),
  ...(current.accountRef ? { AccountRef: current.accountRef } : {}),
});

/**
 * A change to an expense already in QuickBooks, sparse. The payee, date and memo are the CRM's; the payment
 * type and paid-from account are sent back as QuickBooks has them (a bookkeeper's fix stays). `Line` is ALWAYS
 * sent: the lines as QuickBooks has them (with their Ids), with only the CRM's amount, description and tag
 * changes -- so the lines survive whether QuickBooks reads the body as sparse or as a full update (Q1). The
 * line's account, class and any customer the bookkeeper set are kept. Split into several lines with a
 * different total: waits (WAIT.split).
 */
export function purchaseUpdateBody(
  c: SyncCost,
  current: QbPurchaseNow,
  ref: { vendorId: string; lastTag: string | null }
): { body: Record<string, unknown> } | { wait: string } {
  const header = {
    Id: current.id,
    SyncToken: current.syncToken,
    sparse: true,
    ...keptHeader(current),
    EntityRef: { value: ref.vendorId, type: "Vendor" },
    TxnDate: c.spentOn,
    PrivateNote: qbText(c.memo, 4000),
  };
  // Unlike billUpdateBody, every branch carries the lines, even when nothing on them changed.
  const { tagged } = lineTags(c, ref.lastTag);
  const amount = dollars(c.amountCents);
  const description = qbText(c.description, 4000);
  const near = (a: unknown, b: number) => Math.abs((Number(a) || 0) - b) < 0.005;
  const lines = current.lines;
  if (lines.length === 1 && lines[0].DetailType === "AccountBasedExpenseLineDetail") {
    const line = tagged(lines[0]);
    if (near(lines[0].Amount, amount) && String(lines[0].Description ?? "") === description) return { body: { ...header, Line: [line] } };
    const next: Record<string, unknown> = { ...line, Amount: amount };
    if (description) next.Description = description;
    else delete next.Description;
    return { body: { ...header, Line: [next] } };
  }
  const total = lines.reduce((t, l) => t + (Number(l.Amount) || 0), 0);
  if (near(total, amount)) return { body: { ...header, Line: lines.map(tagged) } };
  return { wait: WAIT.split };
}

/** Only the job changed: just the lines (plus what a full update would need, as QuickBooks has it). Null when no
 *  line is the CRM's to move. */
export function purchaseRetagBody(c: SyncCost, current: QbPurchaseNow, lastTag: string | null): Record<string, unknown> | null {
  const { retag, tagged } = lineTags(c, lastTag);
  if (!current.lines.some(retag)) return null;
  return {
    Id: current.id,
    SyncToken: current.syncToken,
    sparse: true,
    ...keptHeader(current),
    ...(current.entityRef ? { EntityRef: current.entityRef } : {}),
    Line: current.lines.map(tagged),
  };
}

/** The receipt as QuickBooks will hold it: "Receipt · Service Finance · Oct 8.pdf". */
export const costReceiptFile = (c: SyncCost, path: string) =>
  receiptFile(path, c.vendorName, c.spentOn, { label: "Expense", drive: COST_WAIT.receiptInDrive });

// ---------------------------------------------------------------- runner helpers (pure, so they're tested here)

/** QuickBooks' settings the invoices job read this recently are used as they are (it runs first in the same pass). */
export const PREFS_FRESH_MS = 10 * 60_000;

/**
 * The closing date to use, from what's saved on the connection: { closeDate } when `qb_prefs` is an object read
 * under PREFS_FRESH_MS ago (its bookCloseDate, or null for none); "read" when it must be read from QuickBooks now
 * (never read, too old, not an object, or a read_at that doesn't parse). Never guesses "books open".
 */
export function closeDateFor(conn: { qb_prefs: unknown; qb_prefs_read_at: string | null }, now: Date): { closeDate: string | null } | "read" {
  const prefs = conn.qb_prefs;
  if (typeof prefs !== "object" || prefs === null || Array.isArray(prefs)) return "read";
  const readAt = conn.qb_prefs_read_at ? Date.parse(conn.qb_prefs_read_at) : NaN;
  if (!Number.isFinite(readAt)) return "read";
  // Too old -- or ahead of this clock by more than a minute, which isn't "fresh forever".
  if (now.getTime() - readAt >= PREFS_FRESH_MS || readAt > now.getTime() + 60_000) return "read";
  const close = (prefs as { bookCloseDate?: unknown }).bookCloseDate;
  return { closeDate: typeof close === "string" ? close : null };
}

/** "Lender payouts land in": the picked id only while QuickBooks still lists it as a Bank account (decision 3). */
export function payoutAccountOf(accounts: QbAccount[] | null | undefined, id: string | null | undefined): string | null {
  return id && accounts?.some((a) => a.id === id && a.type === "Bank") ? id : null;
}

// ---------------------------------------------------------------- the plan

export type CostStep =
  | { op: "resolve"; record: SyncRecord }
  /** `forDelete`: the expense record being deleted with it. The runner then checks QuickBooks' closing date on the
   *  expense BEFORE touching the receipt, so a delete held by closed books leaves both as they are. */
  | { op: "remove_receipt"; recordId: string; record: SyncRecord; forDelete?: SyncRecord }
  | { op: "delete_expense"; recordId: string; record: SyncRecord }
  | { op: "drop"; recordType: RecordType; recordId: string }
  /** A record's customer changed (the cost moved): only lead_id is written. */
  | { op: "note_lead"; recordType: RecordType; recordId: string; leadId: string }
  | { op: "settle"; recordType: RecordType; recordId: string; leadId: string; noted?: string; noteReason?: string }
  | { op: "wait"; recordType: RecordType; recordId: string; leadId: string; reason: string; hash: string }
  | { op: "create_expense"; cost: SyncCost; hash: string; record: SyncRecord | null; payoutAccountId: string; feeAccountId: string }
  | { op: "update_expense"; cost: SyncCost; hash: string; record: SyncRecord }
  | { op: "retag_expense"; cost: SyncCost; hash: string; record: SyncRecord }
  | { op: "attach_receipt"; cost: SyncCost; hash: string; file: { fileName: string; contentType: string }; record: SyncRecord | null };

export function planCostSync(p: {
  costs: SyncCost[];
  /** Ids of 'manual' costs that are a bill payment's cost: not ours; their records (if any) are left alone. */
  billCosts: Set<string>;
  /** Customers still in the CRM, among the costs' and the records' lead_id. Read AFTER the costs, so a customer deleted
   *  meanwhile reads as gone (its costs went with it), never as costs deleted with ✎ Edit. */
  liveLeads: Set<string>;
  /** Of the records' lead_ids, those with a lead_trash row, read both before and after the costs: a customer
   *  being deleted or being restored. Treated as not live, so nothing is deleted in QuickBooks for them. */
  inTrash: Set<string>;
  /** This company's records for the connected QuickBooks company (other types ignored). */
  records: SyncRecord[];
  sendFrom: string;
  now: Date;
  /** The bank account lender payouts land in (a QuickBooks Bank account), and the account matched to
   *  "Financing fee". Never the default account (decision 4). */
  settings: { payoutAccount: string | null; feeAccount: string | null };
  /** QuickBooks' closing date, read this run (or within 10 minutes); null = none. */
  closeDate: string | null;
  /** Send now: refusals and rests are tried again. By-hand notes still stand. */
  force?: boolean;
}): CostStep[] {
  const force = !!p.force;
  const now = p.now.getTime();
  const k = (t: RecordType, id: string) => `${t}:${id}`;
  // Only step 4's own records: bills' and invoices' are their jobs'.
  const records = p.records.filter(isCostRecord);
  const recordOf = new Map(records.map((r) => [k(r.record_type, r.record_id), r]));
  const rec = (t: RecordType, id: string) => recordOf.get(k(t, id)) ?? null;
  const costById = new Map(p.costs.map((c) => [c.id, c]));

  const resolves: CostStep[] = [];
  const removals: CostStep[] = [];
  const deletes: CostStep[] = [];
  const drops: CostStep[] = [];
  const notes: CostStep[] = [];
  const work: CostStep[] = [];

  // Anything whose add got no answer: repeated first, nothing else done to it this run.
  const busy = new Set<string>();
  for (const r of records) {
    if (!r.doubt) continue;
    busy.add(k(r.record_type, r.record_id));
    resolves.push({ op: "resolve", record: r });
  }
  const isBusy = (r: SyncRecord | null) => !!r && busy.has(k(r.record_type, r.record_id));
  /** Refused (or waiting) at this version, and not due another try yet. */
  const resting = (r: SyncRecord | null, hash: string) =>
    !force && !!r && (r.status === "failed" || r.status === "waiting") && r.tried_hash === hash && !!r.next_try_at && new Date(r.next_try_at).getTime() > now;
  // A removal QuickBooks refused (a closed month, say) waits its turn too.
  const removalResting = (r: SyncRecord | null) =>
    !force && !!r && r.status === "failed" && r.failed_op === "remove" && !!r.next_try_at && new Date(r.next_try_at).getTime() > now;
  /** Forget a record that never got to QuickBooks. A by-hand note is never forgotten: it may be there that way. */
  const drop = (r: SyncRecord | null) => {
    if (r && !isBusy(r) && !inQuickBooks(r) && r.status !== "removed" && r.status !== "gone" && !toldHandCost(r) && !toldUndoCost(r)) {
      drops.push({ op: "drop", recordType: r.record_type, recordId: r.record_id });
    }
  };
  const wait = (recordType: RecordType, recordId: string, leadId: string, reason: string, hash: string) => {
    const r = rec(recordType, recordId);
    // Already noted, the same way: nothing to write.
    if (r && r.status === "waiting" && r.reason === reason) return;
    work.push({ op: "wait", recordType, recordId, leadId, reason, hash });
  };
  const closed = (d: string) => !!p.closeDate && d <= p.closeDate;
  /** The customer is in the CRM, and not being deleted or restored. Unknown (null) counts as not. */
  const leadLive = (leadId: string | null | undefined) => !!leadId && p.liveLeads.has(leadId) && !p.inTrash.has(leadId);

  // Costs gone from the CRM. Deleted with ✎ Edit (its customer is still there): deleted in QuickBooks too.
  // Gone with its customer (deleted, or being deleted or restored): left as it is there, and a restore
  // brings the same id back, so nothing is sent twice.
  for (const r of records) {
    if (r.record_type !== "expense" || costById.has(r.record_id) || p.billCosts.has(r.record_id) || isBusy(r)) continue;
    const rr = rec("expense_receipt", r.record_id);
    if (!leadLive(r.lead_id)) {
      if (inQuickBooks(r) || toldHandCost(r) || toldUndoCost(r) || r.status === "removed" || r.status === "gone") continue;
      drop(r);
      if (!inQuickBooks(rr)) drop(rr);
      continue;
    }
    if (inQuickBooks(r)) {
      // A delete QuickBooks refused (closed books, say) waits as a whole: its receipt stays on it too.
      if (removalResting(r)) continue;
      // Its receipt first, unless that can't happen this run (in doubt, or its removal refused).
      let blocked = false;
      if (inQuickBooks(rr)) {
        if (isBusy(rr) || removalResting(rr)) blocked = true;
        else removals.push({ op: "remove_receipt", recordId: r.record_id, record: rr!, forDelete: r });
      } else if (isBusy(rr)) blocked = true;
      else drop(rr);
      if (!blocked) deletes.push({ op: "delete_expense", recordId: r.record_id, record: r });
      continue;
    }
    // Told to be entered by hand: say to take it out there, if it went in.
    if (toldHandCost(r)) {
      wait("expense", r.record_id, r.lead_id!, COST_WAIT.deletedByHand, r.tried_hash ?? "");
      continue;
    }
    if (toldUndoCost(r) || r.status === "removed" || r.status === "gone") continue;
    drop(r);
    if (!inQuickBooks(rr)) drop(rr);
  }

  // A receipt record with no expense record and no cost (shouldn't happen): the same rule, on its own customer.
  for (const rr of records) {
    if (rr.record_type !== "expense_receipt" || costById.has(rr.record_id) || p.billCosts.has(rr.record_id) || isBusy(rr)) continue;
    if (rec("expense", rr.record_id)) continue;
    if (!inQuickBooks(rr)) drop(rr);
    else if (leadLive(rr.lead_id) && !removalResting(rr)) removals.push({ op: "remove_receipt", recordId: rr.record_id, record: rr });
  }

  for (const c of p.costs) {
    // A bill payment's cost is the bills job's.
    if (p.billCosts.has(c.id)) continue;
    const r = rec("expense", c.id);
    const rr = rec("expense_receipt", c.id);
    // Moved to another customer: the records say so (only that is written, so it's done even while in doubt).
    for (const x of [r, rr]) {
      if (x && x.lead_id !== c.leadId) notes.push({ op: "note_lead", recordType: x.record_type, recordId: c.id, leadId: c.leadId });
    }
    if (isBusy(r)) continue;

    if (r?.status === "gone") {
      // Deleted in QuickBooks by someone there: left alone, and so is its receipt. One that never got
      // there is forgotten; one still there is left as it is, with nothing pending.
      if (inQuickBooks(rr) && !isBusy(rr) && rr!.status !== "sent") {
        work.push({ op: "settle", recordType: "expense_receipt", recordId: c.id, leadId: c.leadId });
      } else drop(rr);
      continue;
    }

    const hash = costHash(c);
    const crm = costCrmHash(c);
    const tracked = inQuickBooks(r);

    // Told to be entered by hand: so it stays. Send now doesn't change that.
    if (toldHandCost(r) || toldUndoCost(r)) {
      // Back after it was said to take it out (restored, say): by hand again.
      if (toldUndoCost(r)) wait("expense", c.id, c.leadId, COST_WAIT.handAgain, crm);
      // Changed in the CRM since it was told: make the same change there. Written as is (the words stay the same).
      else if (r!.tried_hash && r!.tried_hash !== crm) {
        work.push({ op: "wait", recordType: "expense", recordId: c.id, leadId: c.leadId, reason: baseCostReason(r!.reason!) + CHANGED_SINCE, hash: crm });
      }
      continue;
    }

    // Will the expense be in QuickBooks, as of this run, for its receipt?
    let goes = tracked;
    if (!tracked) {
      if (c.spentOn < p.sendFrom) {
        // Before the start date, and never went: it stays out (the chip says "Before …").
        drop(r);
        drop(rr);
        continue;
      }
      // Entered by hand: the CRM never recorded what paid for an old cost (decision 6); below zero
      // and closed books have no expense to send (decision 7). The old-cost check comes first.
      if (!c.lenderFee) {
        wait("expense", c.id, c.leadId, COST_WAIT.oldCost, crm);
        continue;
      }
      if (c.amountCents < 0) {
        wait("expense", c.id, c.leadId, COST_WAIT.negative, crm);
        continue;
      }
      if (closed(c.spentOn)) {
        wait("expense", c.id, c.leadId, COST_WAIT.closedByHand(p.closeDate!), crm);
        continue;
      }
      // Waits until it can go, then goes on its own.
      if (!qbVendorName(c.vendorName)) {
        wait("expense", c.id, c.leadId, COST_WAIT.noVendor, hash);
        continue;
      }
      if (!p.settings.payoutAccount) {
        wait("expense", c.id, c.leadId, COST_WAIT.noPayout, hash);
        continue;
      }
      if (!p.settings.feeAccount) {
        wait("expense", c.id, c.leadId, COST_WAIT.noFeeAccount, hash);
        continue;
      }
      if (resting(r, hash)) continue;
      work.push({ op: "create_expense", cost: c, hash, record: r, payoutAccountId: p.settings.payoutAccount, feeAccountId: p.settings.feeAccount });
      goes = true;
    } else if (r!.qb_hash !== hash) {
      // Changed since it went (or its last change didn't go). It stays in QuickBooks whatever happens.
      if (c.amountCents < 0) wait("expense", c.id, c.leadId, COST_WAIT.negativeChange, hash);
      else if (!qbVendorName(c.vendorName)) wait("expense", c.id, c.leadId, COST_WAIT.noVendor, hash);
      else if (onlyJobDiffers(r!.qb_hash, hash)) {
        // Only its job changed. In a month QuickBooks has closed: left as it is there. Else just its lines go.
        // Kept out by closed books before, with this version and this closing date: left so (Send now tries again).
        const why = keptOutReason(p.closeDate);
        const noted = r!.tried_hash === hash && r!.status === "sent" && r!.reason === why;
        if (closed(c.spentOn)) {
          if (!noted) work.push({ op: "settle", recordType: "expense", recordId: c.id, leadId: c.leadId, noted: hash, noteReason: why });
        } else if ((!noted || force) && !resting(r, hash)) work.push({ op: "retag_expense", cost: c, hash, record: r! });
      } else if (closed(c.spentOn)) wait("expense", c.id, c.leadId, COST_WAIT.closedChange(p.closeDate!), hash);
      else if (!resting(r, hash)) work.push({ op: "update_expense", cost: c, hash, record: r! });
    } else if (r!.status !== "sent") {
      // Put back the way QuickBooks has it: nothing to send any more.
      work.push({ op: "settle", recordType: "expense", recordId: c.id, leadId: c.leadId });
    }

    // Its receipt, once the expense is (or is about to be) in QuickBooks.
    if (isBusy(rr)) continue;
    if (!c.receiptPath) {
      // No receipt any more: the one the CRM attached comes out.
      if (inQuickBooks(rr)) {
        if (!removalResting(rr)) work.push({ op: "remove_receipt", recordId: c.id, record: rr! });
      } else drop(rr);
      continue;
    }
    const rHash = receiptHash(c.receiptPath);
    if (inQuickBooks(rr) && rr!.qb_hash === rHash) {
      if (rr!.status !== "sent") work.push({ op: "settle", recordType: "expense_receipt", recordId: c.id, leadId: c.leadId });
      continue;
    }
    if (inQuickBooks(rr) && !c.receiptPath.startsWith("receipts/")) {
      // Moved to Google Drive after it was attached (job-cost receipts move there right after they're saved):
      // QuickBooks keeps the file the CRM attached, and nothing is taken off. Noted once.
      if (!(rr!.status === "sent" && rr!.tried_hash === rHash)) {
        work.push({ op: "settle", recordType: "expense_receipt", recordId: c.id, leadId: c.leadId, noted: rHash });
      }
      continue;
    }
    if (!goes) continue;
    const file = costReceiptFile(c, c.receiptPath);
    if ("wait" in file) wait("expense_receipt", c.id, c.leadId, file.wait, rHash);
    else if (!resting(rr, rHash)) work.push({ op: "attach_receipt", cost: c, hash: rHash, file: file.file, record: rr });
  }

  return [...resolves, ...removals, ...deletes, ...drops, ...notes, ...work];
}

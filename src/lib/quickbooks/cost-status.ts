import { inQuickBooks, type ChipRecord, type QbChip, type RecordType, type SyncRecord } from "./bill-status.ts";

/**
 * Where a job cost stands with QuickBooks (DECISIONS #199): every step-4
 * wording, which notes mean "enter it by hand", the chips Bills to Pay
 * shows on a "Paid on entry" cost, the ✎ Edit window's line, and what
 * Settings counts and lists. One copy, so the planner (cost-sync.ts), the
 * runner, Settings and Bills to Pay all say the same thing. Kept apart
 * from cost-sync.ts, which hashes with node:crypto, so the page's browser
 * code can use it. Pure.
 */

/** Step 4's record types (DECISIONS #199): a job cost's expense, and its receipt, each keyed by the cost's id. */
export const COST_RECORD_TYPES: readonly RecordType[] = ["expense", "expense_receipt"];
export const isCostRecord = (r: { record_type: RecordType }) => COST_RECORD_TYPES.includes(r.record_type);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Oct 31, 2026", as step 3 writes dates in its notes. */
const longDay = (d: string) => {
  const [y, m, dd] = d.split("-").map(Number);
  return m && dd ? `${MONTHS[m - 1]} ${dd}, ${y}` : d;
};

/** Added to a by-hand note when the cost changes afterwards (same words as step 3's, pinned by a test). */
export const CHANGED_SINCE = " It changed in the CRM since: make the same change there by hand.";

export const COST_WAIT = {
  // ---- by hand: sticky (decisions 6 and 7)
  oldCost: "The CRM doesn't know what paid for this cost, so it isn't sent. Enter it in QuickBooks by hand if it isn't there yet.",
  negative: "This cost is below zero (a refund from the vendor, say), so it isn't sent. Enter it in QuickBooks by hand, as a vendor credit.",
  closedByHand: (date: string) =>
    `QuickBooks' books are closed through ${longDay(date)}, so this isn't sent. Ask whoever keeps the books to enter it there by hand.`,
  handAgain: "This was to be entered in QuickBooks by hand before, so it still is: enter it there by hand if it isn't there yet.",
  // ---- "take it out" note: sticky too
  deletedByHand: "This cost was deleted in the CRM after it was to be entered in QuickBooks by hand. If it was entered there, take it out there too.",
  // ---- plain waits: go by themselves once fixed
  noVendor: "This cost has no vendor. Pick one with ✎ Edit on Bills to Pay.",
  noPayout: 'No bank account picked for lender payouts yet. Pick one under "Lender payouts land in" in Settings › QuickBooks.',
  noFeeAccount: '"Financing fee" isn\'t matched to a QuickBooks account yet. Match it under "Where job costs go" in Settings › QuickBooks.',
  receiptInDrive:
    "This receipt is kept in Google Drive, so the CRM can't attach it in QuickBooks. Attach it to the expense there by hand if it's needed.",
  // ---- a change to one already in QuickBooks: waits, not by hand
  negativeChange:
    "This cost was changed to below zero after it went to QuickBooks, so the change isn't sent. Fix the amount, or make the change there by hand.",
  closedChange: (date: string) =>
    `QuickBooks' books are closed through ${longDay(date)}, so this change can't go there. Make it in QuickBooks by hand if it's needed, or ask whoever keeps the books to reopen that month.`,
  /** A delete held by closed books (used as the QuickBooks error's message, after "Couldn't delete it in QuickBooks."). */
  closedRemoval: "QuickBooks' books are closed for its date. Take it out there by hand if it's needed, or ask whoever keeps the books to reopen that month.",
  gone: "Deleted in QuickBooks, so the CRM doesn't send it again.",
};

// Told to be entered in QuickBooks by hand: once a record says so, it stays so -- it may be there that way, so the
// CRM never sends it, drops it or calls it done later (step 3's rule, DECISIONS #184). By the record's own words.
const opening = (f: (x: string) => string) => f("\u0000").split("\u0000")[0];
const HAND_EXACT = new Set([COST_WAIT.oldCost, COST_WAIT.negative, COST_WAIT.handAgain]);
const HAND_OPENINGS = [opening(COST_WAIT.closedByHand)];

/** A by-hand note without "It changed in the CRM since" on the end. */
export const baseCostReason = (reason: string) => (reason.endsWith(CHANGED_SINCE) ? reason.slice(0, -CHANGED_SINCE.length) : reason);

/** Told to be entered in QuickBooks by hand: it stays so (it may be there that way). */
export function toldHandCost(r: Pick<SyncRecord, "status" | "qb_id" | "reason"> | null | undefined): boolean {
  if (!r || r.status !== "waiting" || inQuickBooks(r) || !r.reason) return false;
  return HAND_EXACT.has(baseCostReason(r.reason)) || HAND_OPENINGS.some((o) => r.reason!.startsWith(o));
}
/** Told to take it out of QuickBooks if it went in by hand: that stays too. */
export const toldUndoCost = (r: Pick<SyncRecord, "status" | "qb_id" | "reason"> | null | undefined) =>
  !!r && r.status === "waiting" && !inQuickBooks(r) && r.reason === COST_WAIT.deletedByHand;

/** "Enter in QuickBooks by hand: The CRM doesn't know what paid for this cost." (the first clause only, as the mockup). */
export function costHandChip(reason: string): string {
  const base = baseCostReason(reason);
  const first = base.split(", so ")[0].replace(/\.$/, "");
  return `Enter in QuickBooks by hand: ${first}.${reason.endsWith(CHANGED_SINCE) ? " It changed in the CRM since: make the same change there." : ""}`;
}

/** The ✎ Edit window's line for a cost in QuickBooks (DECISIONS #199). "paused": in QuickBooks, sending job costs is off now. */
export const COST_EDIT_NOTE = {
  on: "In QuickBooks. Save changes it there too, and Delete takes it out of QuickBooks.",
  paused: "In QuickBooks. Once sending job costs is on again, Save changes it there too, and Delete takes it out of QuickBooks.",
} as const;
export type CostQbState = keyof typeof COST_EDIT_NOTE | null;

const OFF = "sending to QuickBooks is off";

/** Where one "Paid on entry" cost stands with QuickBooks (Bills to Pay). */
export function costQbChips(p: {
  /** Sending job costs is on, and QuickBooks is connected. */
  sending: boolean;
  sendFrom: string | null;
  /** lenderFee: job_expenses.lender_fee as the page read it apart; null when it couldn't be read. */
  cost: { spentOn: string; source: string; lenderFee: boolean | null };
  record: ChipRecord | null;
  receipt: { has: boolean; record: ChipRecord | null };
  day: (iso: string) => string;
}): { chips: QbChip[]; qbId: string | null } {
  // Only "Already paid" costs the CRM keeps itself; one QuickBooks sent over is already there.
  if (p.cost.source !== "manual") return { chips: [], qbId: null };
  const r = p.record;
  const why = (x: ChipRecord) => (x.reason ? `: ${x.reason}` : "");
  if (r?.status === "gone") return { chips: [{ tone: "off", text: "Deleted in QuickBooks, so the CRM doesn't send it again" }], qbId: null };
  // A standing note: shown whether or not sending is on.
  if (toldHandCost(r)) return { chips: [{ tone: "wait", text: costHandChip(r!.reason!) }], qbId: null };
  if (!r || !inQuickBooks(r)) {
    if (!p.sending) return { chips: r && r.status !== "removed" ? [{ tone: "off", text: `Not sent: ${OFF}` }] : [], qbId: null };
    if (r?.status === "waiting") return { chips: [{ tone: "wait", text: `Waiting${why(r)}` }], qbId: null };
    if (r?.status === "failed") return { chips: [{ tone: "bad", text: `Didn't go to QuickBooks${why(r)}` }], qbId: null };
    if (!p.sendFrom) return { chips: [], qbId: null };
    if (p.cost.spentOn < p.sendFrom) return { chips: [{ tone: "off", text: `Before ${p.day(p.sendFrom)}: not sent` }], qbId: null };
    // Not looked at yet (or taken out before and back now): what the next run will do with it.
    if (p.cost.lenderFee === true) return { chips: [{ tone: "off", text: "Goes to QuickBooks in a few minutes" }], qbId: null };
    // The old-cost check comes first in the run, so this is exactly the note it writes.
    if (p.cost.lenderFee === false) return { chips: [{ tone: "wait", text: costHandChip(COST_WAIT.oldCost) }], qbId: null };
    // Couldn't tell whether it's a lender fee: nothing rather than something untrue.
    return { chips: [], qbId: null };
  }
  const qbId = r.qb_id;
  // In QuickBooks. Did its last change go?
  if (r.status === "failed") return { chips: [{ tone: "bad", text: `In QuickBooks, but the last change didn't go${why(r)}` }], qbId };
  if (r.status === "waiting") return { chips: [{ tone: "wait", text: `In QuickBooks; the last change waits${why(r)}` }], qbId };
  // Its receipt too?
  const rr = p.receipt.has ? p.receipt.record : null;
  const receiptOpen = p.receipt.has && (!inQuickBooks(rr) || rr!.status === "failed" || rr!.status === "waiting");
  if (receiptOpen) {
    const pending: QbChip = !p.sending
      ? { tone: "off", text: `Receipt not sent: ${OFF}` }
      : rr?.status === "failed"
        ? { tone: "bad", text: `Receipt didn't go${why(rr)}` }
        : rr?.status === "waiting"
          ? { tone: "wait", text: `Receipt waiting${why(rr)}` }
          : { tone: "off", text: "Receipt goes in a few minutes" };
    return { chips: [{ tone: "good", text: "✓ Expense in QuickBooks" }, pending], qbId };
  }
  const what = p.receipt.has ? "Expense and receipt" : "Expense";
  return { chips: [{ tone: "good", text: `✓ In QuickBooks · ${what}${r.sent_at ? ` · ${p.day(r.sent_at)}` : ""}` }], qbId };
}

/** The ✎ Edit state for a cost's expense record (Bills to Pay and jobCostInQuickBooks share it). */
export const costQbState = (record: Pick<SyncRecord, "qb_id" | "status"> | null | undefined, sending: boolean): CostQbState =>
  inQuickBooks(record) ? (sending ? "on" : "paused") : null;

// ---------------------------------------------------------------- Settings

export type CostTroubleRow = Pick<SyncRecord, "record_type" | "record_id" | "status" | "reason"> & { lead_id: string | null; updated_at: string };

/** How many of the others (not "take it out" notes) Needs a look lists. */
const ATTENTION_MAX = 20;

/**
 * What Settings counts as Waiting and Didn't go, and lists under Needs a look, from a company's waiting/failed/gone
 * step-4 records. A record whose customer was deleted (lead gone, or in the trash) is left as it is in QuickBooks, so it's
 * neither counted nor listed: nobody can act on it, and restoring the customer brings it back as it was. `goneLeads` is
 * null when that couldn't be read: then nothing is left out.
 * The "take it out" notes (deletedByHand) come first with no age limit; then the 20 most recently changed others.
 * Didn't go = failed + gone (as bills).
 */
export function costTrouble(rows: CostTroubleRow[], goneLeads: Set<string> | null): { waiting: number; failed: number; attention: CostTroubleRow[] } {
  // A record saved before its cost was read has no customer: unknown, so left out once the customers were read.
  const kept = goneLeads ? rows.filter((r) => !(r.lead_id === null || goneLeads.has(r.lead_id))) : rows;
  const newest = (a: CostTroubleRow, b: CostTroubleRow) => b.updated_at.localeCompare(a.updated_at);
  const takeOut = (r: CostTroubleRow) => r.status === "waiting" && r.reason === COST_WAIT.deletedByHand;
  return {
    waiting: kept.filter((r) => r.status === "waiting").length,
    failed: kept.filter((r) => r.status === "failed" || r.status === "gone").length,
    attention: [
      ...kept.filter(takeOut).sort(newest),
      ...kept
        .filter((r) => !takeOut(r))
        .sort(newest)
        .slice(0, ATTENTION_MAX),
    ],
  };
}

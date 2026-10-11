import { test } from "node:test";
import assert from "node:assert/strict";
import { qbWebUrl, type SyncRecord } from "./bill-status.ts";
import {
  CHANGED_SINCE,
  COST_EDIT_NOTE,
  COST_RECORD_TYPES,
  COST_WAIT,
  costHandChip,
  costQbChips,
  costQbState,
  costTrouble,
  isCostRecord,
  toldHandCost,
  toldUndoCost,
  type CostTroubleRow,
} from "./cost-status.ts";

/**
 * Step 4 (DECISIONS #199): where a "Paid on entry" job cost stands with
 * QuickBooks, as Bills to Pay and its ✎ Edit window say it, and what
 * Settings counts and lists. A lender fee goes as an expense; any other
 * cost from the start date says to enter it by hand, and keeps saying so.
 */

const FROM = "2026-10-01";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Oct 8", as the page writes a day. */
const day = (iso: string) => {
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
};

const record = (over: Partial<SyncRecord> = {}): SyncRecord => ({
  record_type: "expense",
  record_id: "c1",
  bill_id: "c1",
  lead_id: "L1",
  qb_id: "77",
  qb_hash: "h",
  tried_hash: null,
  doubt: null,
  status: "sent",
  failed_op: null,
  reason: null,
  tries: 0,
  next_try_at: null,
  sent_at: "2026-10-08T15:00:00Z",
  ...over,
});
/** Not in QuickBooks, waiting with this reason. */
const waiting = (reason: string, over: Partial<SyncRecord> = {}) =>
  record({ qb_id: null, qb_hash: null, status: "waiting", reason, sent_at: null, ...over });
const receiptRecord = (over: Partial<SyncRecord> = {}) => record({ record_type: "expense_receipt", qb_id: "900", ...over });

type ChipInput = Parameters<typeof costQbChips>[0];
const chips = (p: Partial<Omit<ChipInput, "cost">> & { cost?: Partial<ChipInput["cost"]> } = {}) =>
  costQbChips({
    sending: true,
    sendFrom: FROM,
    record: null,
    receipt: { has: false, record: null },
    day,
    ...p,
    cost: { spentOn: "2026-10-08", source: "manual", lenderFee: true, ...p.cost },
  }).chips.map((c) => `${c.tone}|${c.text}`);
const qbIdOf = (r: SyncRecord | null) =>
  costQbChips({ sending: true, sendFrom: FROM, cost: { spentOn: "2026-10-08", source: "manual", lenderFee: true }, record: r, receipt: { has: false, record: null }, day }).qbId;

const HAND_OLD = "wait|Enter in QuickBooks by hand: The CRM doesn't know what paid for this cost.";

test("a cost QuickBooks itself sent to the CRM says nothing", () => {
  assert.deepEqual(chips({ cost: { source: "quickbooks" } }), []);
  assert.deepEqual(chips({ cost: { source: "quickbooks" }, record: record() }), []);
});

test("with sending off, a cost not in QuickBooks says it isn't sent, or nothing", () => {
  assert.deepEqual(chips({ sending: false }), []);
  assert.deepEqual(chips({ sending: false, record: waiting(COST_WAIT.noPayout) }), ["off|Not sent: sending to QuickBooks is off"]);
  assert.deepEqual(chips({ sending: false, record: record({ qb_id: null, status: "removed" }) }), []);
});

test("a cost the job hasn't looked at yet says what the job will do with it", () => {
  assert.deepEqual(chips({ cost: { spentOn: "2026-09-20" } }), ["off|Before Oct 1: not sent"]);
  assert.deepEqual(chips({ cost: { spentOn: "2026-10-01" } }), ["off|Goes to QuickBooks in a few minutes"]);
  // Not a lender fee: the run will say to enter it by hand (the mockup's Home Depot row).
  assert.deepEqual(chips({ cost: { lenderFee: false } }), [HAND_OLD]);
  assert.deepEqual(chips({ cost: { lenderFee: false, spentOn: "2026-09-20" } }), ["off|Before Oct 1: not sent"]);
  // Which costs are lender fees couldn't be read: nothing rather than something untrue.
  assert.deepEqual(chips({ cost: { lenderFee: null } }), []);
  assert.deepEqual(chips({ sendFrom: null }), []);
  // Taken out of QuickBooks before, and back in the CRM: as if it had no record.
  assert.deepEqual(chips({ record: record({ qb_id: null, status: "removed" }) }), ["off|Goes to QuickBooks in a few minutes"]);
});

test("a cost that waits or was refused says why", () => {
  assert.deepEqual(chips({ record: waiting(COST_WAIT.noPayout) }), [
    'wait|Waiting: No bank account picked for lender payouts yet. Pick one under "Lender payouts land in" in Settings › QuickBooks.',
  ]);
  assert.deepEqual(chips({ record: waiting("QuickBooks said: no", { status: "failed", failed_op: "add" }) }), [
    "bad|Didn't go to QuickBooks: QuickBooks said: no",
  ]);
  assert.deepEqual(chips({ record: waiting("") }), ["wait|Waiting"]);
});

test("a cost to be entered by hand says so, whether or not sending is on", () => {
  assert.deepEqual(chips({ record: waiting(COST_WAIT.oldCost) }), [HAND_OLD]);
  assert.deepEqual(chips({ sending: false, record: waiting(COST_WAIT.oldCost) }), [HAND_OLD]);
  assert.deepEqual(chips({ record: waiting(COST_WAIT.oldCost + CHANGED_SINCE) }), [
    "wait|Enter in QuickBooks by hand: The CRM doesn't know what paid for this cost. It changed in the CRM since: make the same change there.",
  ]);
  assert.deepEqual(chips({ record: waiting(COST_WAIT.closedByHand("2026-10-31")) }), [
    "wait|Enter in QuickBooks by hand: QuickBooks' books are closed through Oct 31, 2026.",
  ]);
  assert.deepEqual(chips({ record: waiting(COST_WAIT.negative) }), [
    "wait|Enter in QuickBooks by hand: This cost is below zero (a refund from the vendor, say).",
  ]);
  assert.equal(costHandChip(COST_WAIT.oldCost), HAND_OLD.slice("wait|".length));
});

test("a cost in QuickBooks says so, with its receipt", () => {
  assert.deepEqual(chips({ record: record() }), ["good|✓ In QuickBooks · Expense · Oct 8"]);
  assert.deepEqual(chips({ record: record({ sent_at: null }) }), ["good|✓ In QuickBooks · Expense"]);
  assert.deepEqual(chips({ record: record(), receipt: { has: true, record: receiptRecord() } }), ["good|✓ In QuickBooks · Expense and receipt · Oct 8"]);
  assert.deepEqual(
    chips({ record: record(), receipt: { has: true, record: receiptRecord({ qb_id: null, status: "waiting", reason: COST_WAIT.receiptInDrive }) } }),
    ["good|✓ Expense in QuickBooks", `wait|Receipt waiting: ${COST_WAIT.receiptInDrive}`]
  );
  assert.deepEqual(chips({ record: record(), receipt: { has: true, record: null } }), ["good|✓ Expense in QuickBooks", "off|Receipt goes in a few minutes"]);
  assert.deepEqual(chips({ record: record(), receipt: { has: true, record: receiptRecord({ status: "failed", reason: "no" }) } }), [
    "good|✓ Expense in QuickBooks",
    "bad|Receipt didn't go: no",
  ]);
  // Turned off later: what went still says so; what's pending says it won't go.
  assert.deepEqual(chips({ sending: false, record: record() }), ["good|✓ In QuickBooks · Expense · Oct 8"]);
  assert.deepEqual(chips({ sending: false, record: record(), receipt: { has: true, record: null } }), [
    "good|✓ Expense in QuickBooks",
    "off|Receipt not sent: sending to QuickBooks is off",
  ]);
});

test("a cost in QuickBooks whose last change didn't go says so; one deleted there says that", () => {
  assert.deepEqual(chips({ record: record({ status: "failed", failed_op: "change", reason: "QuickBooks said: no" }) }), [
    "bad|In QuickBooks, but the last change didn't go: QuickBooks said: no",
  ]);
  assert.deepEqual(chips({ record: record({ status: "waiting", reason: COST_WAIT.negativeChange }) }), [
    `wait|In QuickBooks; the last change waits: ${COST_WAIT.negativeChange}`,
  ]);
  assert.deepEqual(chips({ record: record({ status: "gone", reason: COST_WAIT.gone }) }), ["off|Deleted in QuickBooks, so the CRM doesn't send it again"]);
});

test("Open in QuickBooks links only to an expense that's there", () => {
  assert.equal(qbIdOf(record()), "77");
  assert.equal(qbIdOf(record({ status: "failed", failed_op: "change" })), "77");
  assert.equal(qbIdOf(record({ status: "gone" })), null);
  assert.equal(qbIdOf(record({ qb_id: null, status: "removed" })), null);
  assert.equal(qbIdOf(waiting(COST_WAIT.oldCost)), null);
  assert.equal(qbIdOf(waiting(COST_WAIT.noPayout)), null);
  assert.equal(qbIdOf(null), null);
});

test("by hand is read from the record's own words, and only for what isn't in QuickBooks", () => {
  assert.equal(toldHandCost(waiting(COST_WAIT.oldCost)), true);
  assert.equal(toldHandCost(waiting(COST_WAIT.oldCost + CHANGED_SINCE)), true);
  assert.equal(toldHandCost(waiting(COST_WAIT.negative)), true);
  assert.equal(toldHandCost(waiting(COST_WAIT.handAgain)), true);
  assert.equal(toldHandCost(waiting(COST_WAIT.closedByHand("2026-10-31"))), true);
  assert.equal(toldHandCost(waiting(COST_WAIT.closedByHand("2026-10-31") + CHANGED_SINCE)), true);
  // The same words on an expense already in QuickBooks: not by hand.
  assert.equal(toldHandCost(record({ status: "waiting", reason: COST_WAIT.oldCost })), false);
  // Plain waits, refusals and nothing at all aren't.
  assert.equal(toldHandCost(waiting(COST_WAIT.noPayout)), false);
  assert.equal(toldHandCost(waiting(COST_WAIT.oldCost, { status: "failed" })), false);
  assert.equal(toldHandCost(waiting(COST_WAIT.deletedByHand)), false);
  assert.equal(toldHandCost(null), false);
  // The "take it out" note is its own kind.
  assert.equal(toldUndoCost(waiting(COST_WAIT.deletedByHand)), true);
  assert.equal(toldUndoCost(waiting(COST_WAIT.oldCost)), false);
  assert.equal(toldUndoCost(record({ status: "waiting", reason: COST_WAIT.deletedByHand })), false);
});

test("a job cost's records carry their customer, and Open in QuickBooks names an expense", () => {
  assert.equal(record().lead_id, "L1");
  // The address format only: Intuit's real expense page is still to be tried (open question 1).
  assert.equal(qbWebUrl("sandbox", "expense", "77", "9341"), "https://app.sandbox.qbo.intuit.com/app/expense?txnId=77&companyId=9341");
  assert.equal(qbWebUrl("production", "expense", "77", "9341"), "https://app.qbo.intuit.com/app/expense?txnId=77&companyId=9341");
});

test("the ✎ Edit window says when Save and Delete reach QuickBooks", () => {
  assert.equal(costQbState(record(), true), "on");
  assert.equal(costQbState(record(), false), "paused");
  // A change that didn't go: still in QuickBooks.
  assert.equal(costQbState(record({ status: "failed", failed_op: "change" }), true), "on");
  assert.equal(costQbState(record({ status: "waiting", reason: COST_WAIT.negativeChange }), false), "paused");
  assert.equal(costQbState(waiting(COST_WAIT.noPayout), true), null);
  assert.equal(costQbState(waiting(COST_WAIT.oldCost), true), null);
  assert.equal(costQbState(record({ qb_id: null, status: "removed" }), true), null);
  assert.equal(costQbState(record({ status: "gone" }), true), null);
  assert.equal(costQbState(null, true), null);
  assert.equal(costQbState(undefined, true), null);
  // The mockup's words.
  assert.equal(COST_EDIT_NOTE.on, "In QuickBooks. Save changes it there too, and Delete takes it out of QuickBooks.");
  assert.equal(
    COST_EDIT_NOTE.paused,
    "In QuickBooks. Once sending job costs is on again, Save changes it there too, and Delete takes it out of QuickBooks."
  );
});

// ---------------------------------------------------------------- Settings' counts and Needs a look

const DAY_MS = 86_400_000;
const NOW = Date.parse("2026-10-10T15:00:00Z");
const row = (over: Partial<CostTroubleRow> = {}): CostTroubleRow => ({
  record_type: "expense",
  record_id: "c1",
  status: "waiting",
  reason: COST_WAIT.noPayout,
  lead_id: "L1",
  updated_at: new Date(NOW).toISOString(),
  ...over,
});
const ago = (days: number) => new Date(NOW - days * DAY_MS).toISOString();

test("Needs a look lists the take-it-out notes first, whatever their age, then the 20 newest others", () => {
  const old = row({ record_id: "gone1", reason: COST_WAIT.deletedByHand, updated_at: ago(40) });
  const others = Array.from({ length: 25 }, (_, i) => row({ record_id: `c${i}`, updated_at: ago(i) }));
  const { attention } = costTrouble([...others.slice().reverse(), old], new Set());
  assert.equal(attention.length, 21);
  assert.equal(attention[0].record_id, "gone1");
  assert.deepEqual(
    attention.slice(1).map((r) => r.record_id),
    others.slice(0, 20).map((r) => r.record_id)
  );
});

test("Settings counts waiting, and Didn't go as refused plus deleted in QuickBooks; receipts count too", () => {
  const rows = [
    row({ record_id: "a" }),
    row({ record_id: "a", record_type: "expense_receipt", reason: COST_WAIT.receiptInDrive }),
    row({ record_id: "b", status: "failed", reason: "QuickBooks said: no" }),
    row({ record_id: "c", status: "gone", reason: COST_WAIT.gone }),
    row({ record_id: "d", record_type: "expense_receipt", status: "failed", reason: "no" }),
  ];
  const t = costTrouble(rows, new Set());
  assert.equal(t.waiting, 2);
  assert.equal(t.failed, 3);
  assert.equal(t.attention.length, 5);
});

test("a deleted customer's records are neither counted nor listed, unless the customers couldn't be read", () => {
  const rows = [
    row({ record_id: "a" }),
    row({ record_id: "b", status: "failed", reason: "no", lead_id: "L9" }),
    row({ record_id: "c", lead_id: null }),
  ];
  const t = costTrouble(rows, new Set(["L9"]));
  assert.equal(t.waiting, 1);
  assert.equal(t.failed, 0);
  assert.deepEqual(
    t.attention.map((r) => r.record_id),
    ["a"]
  );
  // Couldn't tell which customers are gone: nothing is left out.
  const all = costTrouble(rows, null);
  assert.equal(all.waiting, 2);
  assert.equal(all.failed, 1);
  assert.equal(all.attention.length, 3);
});

test("step 4's record types are an expense and its receipt", () => {
  assert.deepEqual([...COST_RECORD_TYPES], ["expense", "expense_receipt"]);
  assert.equal(isCostRecord({ record_type: "expense" }), true);
  assert.equal(isCostRecord({ record_type: "expense_receipt" }), true);
  assert.equal(isCostRecord({ record_type: "receipt" }), false);
  assert.equal(isCostRecord({ record_type: "bill" }), false);
  assert.equal(isCostRecord({ record_type: "job" }), false);
});

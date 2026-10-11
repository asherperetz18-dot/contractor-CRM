import { test } from "node:test";
import assert from "node:assert/strict";
import { WAIT, keptOutReason, onlyJobDiffers, receiptFile, receiptHash, type SyncRecord } from "./bill-sync.ts";
import { CHANGED_SINCE as SALES_CHANGED_SINCE, SALES_WAIT } from "./invoice-sync.ts";
import { CHANGED_SINCE, COST_WAIT, toldHandCost } from "./cost-status.ts";
import {
  PREFS_FRESH_MS,
  closeDateFor,
  costCrmHash,
  costHash,
  costReceiptFile,
  payoutAccountOf,
  planCostSync,
  purchaseBody,
  purchaseRetagBody,
  purchaseUpdateBody,
  type CostStep,
  type QbPurchaseNow,
  type SyncCost,
} from "./cost-sync.ts";

/**
 * QuickBooks, step 4 (DECISIONS #199): once a company turns on sending job
 * costs, each lender fee dated from its start date goes to QuickBooks as an
 * Expense on its job, paid out of the bank account lenders pay into, in the
 * account matched to "Financing fee". Changes follow; a fee deleted with
 * ✎ Edit is deleted there; a customer deleted leaves it alone. Other costs
 * from the start date, costs below zero and costs in closed books are
 * entered by hand, and stay so.
 */

const NOW = new Date("2026-10-10T15:00:00Z");
const FROM = "2026-10-01";
const LATER = "2026-10-10T16:00:00Z";

const cost = (over: Partial<SyncCost> = {}): SyncCost => ({
  id: "c1",
  leadId: "L1",
  lenderFee: true,
  vendorName: "Service Finance",
  description: "Service Finance dealer fee on EST-1058",
  amountCents: 192000,
  spentOn: "2026-10-08",
  memo: "EST-1058 · James Carter · Basement finish",
  receiptPath: null,
  tag: null,
  contractId: "K1",
  ...over,
});
const settings = { payoutAccount: "35", feeAccount: "62" };

/** The fee's expense, in QuickBooks as the CRM has it. */
const sent = (over: Partial<SyncRecord> = {}): SyncRecord => ({
  record_type: "expense",
  record_id: "c1",
  bill_id: "c1",
  lead_id: "L1",
  qb_id: "77",
  qb_hash: costHash(cost()),
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
/** Not in QuickBooks, waiting with this reason (a plain wait carries costHash; a by-hand one costCrmHash). */
const waiting = (reason: string, over: Partial<SyncRecord> = {}) =>
  sent({ qb_id: null, qb_hash: null, status: "waiting", reason, tried_hash: costHash(cost()), sent_at: null, ...over });
const byHand = (reason: string, c: SyncCost = cost({ lenderFee: false }), over: Partial<SyncRecord> = {}) =>
  waiting(reason, { tried_hash: costCrmHash(c), ...over });

const R = "receipts/L1/1728400000000-fee.pdf";
const receiptSent = (over: Partial<SyncRecord> = {}) =>
  sent({ record_type: "expense_receipt", qb_id: "900", qb_hash: receiptHash(R), ...over });
const receiptWaiting = (reason: string, over: Partial<SyncRecord> = {}) =>
  receiptSent({ qb_id: null, qb_hash: null, status: "waiting", reason, sent_at: null, ...over });
const doubt = { requestId: "crm-1", body: {}, hash: "h" };

const plan = (p: Partial<Parameters<typeof planCostSync>[0]> = {}) =>
  planCostSync({
    costs: [cost()],
    billCosts: new Set(),
    liveLeads: new Set(["L1"]),
    inTrash: new Set(),
    records: [],
    sendFrom: FROM,
    now: NOW,
    settings,
    closeDate: null,
    ...p,
  });
const where = (s: CostStep): string => {
  switch (s.op) {
    case "resolve":
      return `${s.record.record_type}:${s.record.record_id}`;
    case "remove_receipt":
      return `expense_receipt:${s.recordId}`;
    case "delete_expense":
      return `expense:${s.recordId}`;
    case "create_expense":
    case "update_expense":
    case "retag_expense":
      return `expense:${s.cost.id}`;
    case "attach_receipt":
      return `expense_receipt:${s.cost.id}`;
    default:
      return `${s.recordType}:${s.recordId}`;
  }
};
const ops = (steps: CostStep[]) => steps.map((s) => `${s.op}:${where(s)}`);
const only = <T extends CostStep["op"]>(steps: CostStep[], op: T) => {
  assert.equal(steps.length, 1, `one step: ${ops(steps).join(", ")}`);
  assert.equal(steps[0].op, op);
  return steps[0] as Extract<CostStep, { op: T }>;
};

// ---------------------------------------------------------------- new costs

test("a lender fee dated from the start date goes, paid out of the payout account, in the Financing fee account", () => {
  const step = only(plan(), "create_expense");
  assert.equal(step.payoutAccountId, "35");
  assert.equal(step.feeAccountId, "62");
  assert.equal(step.hash, costHash(cost()));
  assert.equal(step.record, null);
  assert.equal(step.cost.id, "c1");
});

test("a fee dated before the start date stays out; a stale wait for it is forgotten", () => {
  assert.deepEqual(plan({ costs: [cost({ spentOn: "2026-09-20" })] }), []);
  assert.deepEqual(
    ops(
      plan({
        costs: [cost({ spentOn: "2026-09-20", receiptPath: "drive:abc" })],
        records: [waiting(COST_WAIT.noPayout), receiptWaiting(COST_WAIT.receiptInDrive)],
      })
    ),
    ["drop:expense:c1", "drop:expense_receipt:c1"]
  );
});

test("a fee waits until a payout account is picked, then goes", () => {
  const w = only(plan({ settings: { payoutAccount: null, feeAccount: "62" } }), "wait");
  assert.equal(w.recordType, "expense");
  assert.equal(w.reason, COST_WAIT.noPayout);
  assert.equal(w.hash, costHash(cost()));
  assert.equal(w.leadId, "L1");
  // Waiting the same way: nothing to write.
  assert.deepEqual(plan({ settings: { payoutAccount: null, feeAccount: "62" }, records: [waiting(COST_WAIT.noPayout)] }), []);
  // Picked: a planner's wait isn't a rest, so it goes at once.
  assert.deepEqual(ops(plan({ records: [waiting(COST_WAIT.noPayout)] })), ["create_expense:expense:c1"]);
});

test("a fee waits until Financing fee is matched: never the default account", () => {
  assert.equal(only(plan({ settings: { payoutAccount: "35", feeAccount: null } }), "wait").reason, COST_WAIT.noFeeAccount);
  // There's no default account to hand the planner at all (decision 4).
  // @ts-expect-error -- the planner takes no default account
  const steps = plan({ settings: { payoutAccount: "35", feeAccount: null, fallback: "61" } });
  assert.equal(only(steps, "wait").reason, COST_WAIT.noFeeAccount);
});

test("a fee with no vendor waits for one", () => {
  assert.equal(only(plan({ costs: [cost({ vendorName: null })] }), "wait").reason, COST_WAIT.noVendor);
  assert.equal(only(plan({ costs: [cost({ vendorName: "🔨" })] }), "wait").reason, COST_WAIT.noVendor);
});

test("a cost below zero is entered by hand; made positive later it still is, noted once", () => {
  const negative = cost({ amountCents: -5000 });
  const w = only(plan({ costs: [negative] }), "wait");
  assert.equal(w.reason, COST_WAIT.negative);
  assert.equal(w.hash, costCrmHash(negative));
  const positive = cost({ amountCents: 5000 });
  const again = only(plan({ costs: [positive], records: [byHand(COST_WAIT.negative, negative)] }), "wait");
  assert.equal(again.reason, COST_WAIT.negative + CHANGED_SINCE);
  assert.equal(again.hash, costCrmHash(positive));
  assert.deepEqual(plan({ costs: [positive], records: [byHand(COST_WAIT.negative + CHANGED_SINCE, positive)] }), []);
});

test("a cost dated in closed books is entered by hand, and stays so when the books reopen", () => {
  const w = only(plan({ closeDate: "2026-10-08" }), "wait");
  assert.equal(
    w.reason,
    "QuickBooks' books are closed through Oct 8, 2026, so this isn't sent. Ask whoever keeps the books to enter it there by hand."
  );
  assert.equal(w.hash, costCrmHash(cost()));
  const told = byHand(COST_WAIT.closedByHand("2026-10-08"), cost());
  assert.deepEqual(plan({ records: [told] }), []);
  assert.deepEqual(plan({ records: [told], force: true }), []);
  // The day after the closing date goes.
  assert.deepEqual(ops(plan({ closeDate: "2026-10-07" })), ["create_expense:expense:c1"]);
});

test("an old cost (not a lender fee) from the start date is entered by hand; one from before says nothing", () => {
  const old = cost({ lenderFee: false, vendorName: "Home Depot", amountCents: 41237, spentOn: "2026-10-02" });
  const w = only(plan({ costs: [old] }), "wait");
  assert.equal(w.reason, COST_WAIT.oldCost);
  assert.equal(w.hash, costCrmHash(old));
  assert.deepEqual(plan({ costs: [cost({ lenderFee: false, spentOn: "2026-09-20" })] }), []);
  // In closed books too: the old-cost check comes first (by hand either way).
  assert.equal(only(plan({ costs: [old], closeDate: "2026-10-31" }), "wait").reason, COST_WAIT.oldCost);
  // Even with no payout account or match: it never goes.
  assert.equal(only(plan({ costs: [old], settings: { payoutAccount: null, feeAccount: null } }), "wait").reason, COST_WAIT.oldCost);
});

test("by hand is sticky: Send now doesn't send it, a move before the start date doesn't drop it, a change is noted once", () => {
  const old = cost({ lenderFee: false });
  const told = byHand(COST_WAIT.oldCost, old);
  assert.deepEqual(plan({ costs: [old], records: [told] }), []);
  assert.deepEqual(plan({ costs: [old], records: [told], force: true }), []);
  const moved = cost({ lenderFee: false, spentOn: "2026-09-01" });
  const w = only(plan({ costs: [moved], records: [told] }), "wait");
  assert.equal(w.reason, COST_WAIT.oldCost + CHANGED_SINCE);
  assert.equal(w.hash, costCrmHash(moved));
  // Already noted as changed, and changed again: noted again with the new version, the words once.
  const again = cost({ lenderFee: false, spentOn: "2026-09-01", amountCents: 1 });
  const w2 = only(plan({ costs: [again], records: [byHand(COST_WAIT.oldCost + CHANGED_SINCE, moved)] }), "wait");
  assert.equal(w2.reason, COST_WAIT.oldCost + CHANGED_SINCE);
  assert.equal(w2.hash, costCrmHash(again));
  // Marked a lender fee later, with everything it needs: still by hand, never sent.
  assert.deepEqual(plan({ costs: [cost()], records: [byHand(COST_WAIT.oldCost, cost())] }), []);
});

test("a by-hand note is never forgotten, whichever record carries it", () => {
  // Receipts never get one today; the rule holds anyway (it may be in QuickBooks that way).
  assert.deepEqual(plan({ costs: [], records: [receiptWaiting(COST_WAIT.oldCost)] }), []);
  assert.deepEqual(plan({ costs: [], records: [receiptWaiting(COST_WAIT.deletedByHand)] }), []);
});

test("adding its job in QuickBooks later doesn't read as a change to a cost told by hand", () => {
  const old = cost({ lenderFee: false });
  assert.deepEqual(plan({ costs: [cost({ lenderFee: false, tag: "J1" })], records: [byHand(COST_WAIT.oldCost, old)] }), []);
  // Nor does a new memo (the job's title changed).
  assert.deepEqual(plan({ costs: [cost({ lenderFee: false, memo: "EST-1058 · James Carter · Basement" })], records: [byHand(COST_WAIT.oldCost, old)] }), []);
});

test("a refusal rests until its next try; Send now or a change tries again", () => {
  const refused = sent({ qb_id: null, qb_hash: null, status: "failed", failed_op: "add", reason: "no", tried_hash: costHash(cost()), next_try_at: LATER, sent_at: null });
  assert.deepEqual(plan({ records: [refused] }), []);
  assert.deepEqual(ops(plan({ records: [refused], force: true })), ["create_expense:expense:c1"]);
  assert.deepEqual(ops(plan({ costs: [cost({ amountCents: 200000 })], records: [refused] })), ["create_expense:expense:c1"]);
  // Its time has come.
  assert.deepEqual(ops(plan({ records: [refused], now: new Date("2026-10-10T17:00:00Z") })), ["create_expense:expense:c1"]);
});

test("a fee whose add got no answer is only repeated, with nothing else done to it or its receipt", () => {
  const unsure = waiting("Being sent to QuickBooks now.", { doubt });
  assert.deepEqual(ops(plan({ costs: [cost({ receiptPath: R })], records: [unsure] })), ["resolve:expense:c1"]);
  // Its customer moved meanwhile: that's noted (it touches only the customer).
  assert.deepEqual(ops(plan({ costs: [cost({ leadId: "L2", receiptPath: R })], records: [unsure] })), ["resolve:expense:c1", "note_lead:expense:c1"]);
});

// ---------------------------------------------------------------- sent costs

test("a sent fee as it was: nothing; back the way QuickBooks has it: settled", () => {
  assert.deepEqual(plan({ records: [sent()] }), []);
  assert.deepEqual(ops(plan({ records: [sent({ status: "waiting", reason: COST_WAIT.negativeChange })] })), ["settle:expense:c1"]);
  assert.deepEqual(ops(plan({ records: [sent({ status: "failed", failed_op: "change", reason: "no" })] })), ["settle:expense:c1"]);
});

test("a change to a sent fee follows it: amount, date, vendor, What for", () => {
  for (const changed of [
    cost({ amountCents: 200000 }),
    cost({ spentOn: "2026-10-09" }),
    cost({ vendorName: "GreenSky" }),
    cost({ description: "Dealer fee" }),
    cost({ memo: "EST-1058 · James Carter · Basement" }),
  ]) {
    const step = only(plan({ costs: [changed], records: [sent()] }), "update_expense");
    assert.equal(step.hash, costHash(changed));
    assert.equal(step.record.qb_id, "77");
  }
  // Its change refused and resting at this version: not again until its time (or Send now).
  const changed = cost({ amountCents: 200000 });
  const refused = sent({ status: "failed", failed_op: "change", reason: "no", tried_hash: costHash(changed), next_try_at: LATER });
  assert.deepEqual(plan({ costs: [changed], records: [refused] }), []);
  assert.deepEqual(ops(plan({ costs: [changed], records: [refused], force: true })), ["update_expense:expense:c1"]);
});

test("only its job changed: just the lines move, unless QuickBooks' books are closed for it", () => {
  const tagged = cost({ tag: "J1" });
  assert.equal(onlyJobDiffers(costHash(cost()), costHash(tagged)), true);
  assert.deepEqual(ops(plan({ costs: [tagged], records: [sent()] })), ["retag_expense:expense:c1"]);
  const kept = only(plan({ costs: [tagged], records: [sent()], closeDate: "2026-10-08" }), "settle");
  assert.equal(kept.recordType, "expense");
  assert.equal(kept.noted, costHash(tagged));
  assert.equal(kept.noteReason, keptOutReason("2026-10-08"));
  // Noted so already: nothing.
  const noted = sent({ tried_hash: costHash(tagged), reason: keptOutReason("2026-10-08") });
  assert.deepEqual(plan({ costs: [tagged], records: [noted], closeDate: "2026-10-08" }), []);
  // Kept out when QuickBooks refused it with no closing date known: left so, but Send now tries again.
  const refusedThere = sent({ tried_hash: costHash(tagged), reason: keptOutReason(null) });
  assert.deepEqual(plan({ costs: [tagged], records: [refusedThere] }), []);
  assert.deepEqual(ops(plan({ costs: [tagged], records: [refusedThere], force: true })), ["retag_expense:expense:c1"]);
});

test("a sent fee changed to below zero waits in QuickBooks (not deleted, not by hand); back as it was, settled", () => {
  const negative = cost({ amountCents: -5000 });
  const w = only(plan({ costs: [negative], records: [sent()] }), "wait");
  assert.equal(w.reason, COST_WAIT.negativeChange);
  assert.equal(w.hash, costHash(negative));
  const after = sent({ status: "waiting", reason: COST_WAIT.negativeChange, tried_hash: costHash(negative) });
  assert.equal(toldHandCost(after), false);
  assert.deepEqual(plan({ costs: [negative], records: [after] }), []);
  assert.deepEqual(ops(plan({ records: [after] })), ["settle:expense:c1"]);
  // Fixed to another amount: the change goes.
  assert.deepEqual(ops(plan({ costs: [cost({ amountCents: 1000 })], records: [after] })), ["update_expense:expense:c1"]);
});

test("a sent fee changed with its date in closed books waits, saying to change it there by hand", () => {
  const w = only(plan({ costs: [cost({ amountCents: 200000 })], records: [sent()], closeDate: "2026-10-31" }), "wait");
  assert.equal(w.reason, COST_WAIT.closedChange("2026-10-31"));
  assert.equal(toldHandCost(sent({ status: "waiting", reason: w.reason })), false);
});

test("a sent fee whose vendor was cleared waits for one; it isn't deleted", () => {
  assert.equal(only(plan({ costs: [cost({ vendorName: null })], records: [sent()] }), "wait").reason, COST_WAIT.noVendor);
});

test("a sent fee moved before the start date still follows", () => {
  assert.deepEqual(ops(plan({ costs: [cost({ spentOn: "2026-09-20" })], records: [sent()] })), ["update_expense:expense:c1"]);
});

test("a fee deleted in QuickBooks by someone there is left alone, and so is its receipt", () => {
  const gone = sent({ status: "gone", reason: COST_WAIT.gone });
  assert.deepEqual(plan({ costs: [cost({ amountCents: 1 })], records: [gone] }), []);
  assert.deepEqual(ops(plan({ costs: [cost({ receiptPath: R })], records: [gone, receiptWaiting("x")] })), ["drop:expense_receipt:c1"]);
  // A receipt still there is left as it is, with nothing pending.
  assert.deepEqual(ops(plan({ costs: [cost({ receiptPath: R })], records: [gone, receiptSent({ status: "failed", reason: "no" })] })), [
    "settle:expense_receipt:c1",
  ]);
  assert.deepEqual(plan({ costs: [cost({ receiptPath: R })], records: [gone, receiptSent()] }), []);
});

// ---------------------------------------------------------------- deletes and customers

test("a fee deleted with ✎ Edit is deleted in QuickBooks, its receipt first, held together", () => {
  const steps = plan({ costs: [], records: [sent(), receiptSent()] });
  assert.deepEqual(ops(steps), ["remove_receipt:expense_receipt:c1", "delete_expense:expense:c1"]);
  const removal = steps[0] as Extract<CostStep, { op: "remove_receipt" }>;
  assert.deepEqual(removal.forDelete, sent());
  assert.deepEqual(removal.record, receiptSent());
  // No receipt: just the expense.
  assert.deepEqual(ops(plan({ costs: [], records: [sent()] })), ["delete_expense:expense:c1"]);
  // A receipt taken off on its own (the cost is still there) isn't part of a delete.
  const own = only(plan({ costs: [cost()], records: [sent(), receiptSent()] }), "remove_receipt");
  assert.equal(own.forDelete, undefined);
});

test("a delete waits while its receipt's upload has no answer", () => {
  assert.deepEqual(ops(plan({ costs: [], records: [sent(), receiptSent({ doubt })] })), ["resolve:expense_receipt:c1"]);
});

test("a delete refused (closed books, say) rests as a whole: neither the receipt nor the expense is touched", () => {
  const held = sent({ status: "failed", failed_op: "remove", reason: "Couldn't delete it in QuickBooks. " + COST_WAIT.closedRemoval, next_try_at: LATER });
  assert.deepEqual(plan({ costs: [], records: [held, receiptSent()] }), []);
  assert.deepEqual(ops(plan({ costs: [], records: [held, receiptSent()], force: true })), [
    "remove_receipt:expense_receipt:c1",
    "delete_expense:expense:c1",
  ]);
  // The receipt's own removal refused and resting: the expense waits for it.
  const stuck = receiptSent({ status: "failed", failed_op: "remove", reason: "no", next_try_at: LATER });
  assert.deepEqual(plan({ costs: [], records: [sent(), stuck] }), []);
});

test("a fee deleted with ✎ Edit before it went is forgotten, with its receipt", () => {
  assert.deepEqual(ops(plan({ costs: [], records: [waiting(COST_WAIT.noPayout), receiptWaiting("x")] })), [
    "drop:expense:c1",
    "drop:expense_receipt:c1",
  ]);
});

test("a by-hand cost deleted with ✎ Edit says to take it out if it went in by hand, and that stays", () => {
  const old = cost({ lenderFee: false });
  const told = byHand(COST_WAIT.oldCost, old);
  const w = only(plan({ costs: [], records: [told] }), "wait");
  assert.equal(w.reason, COST_WAIT.deletedByHand);
  assert.equal(w.hash, costCrmHash(old));
  assert.equal(w.leadId, "L1");
  const undo = byHand(COST_WAIT.deletedByHand, old);
  assert.deepEqual(plan({ costs: [], records: [undo] }), []);
  assert.deepEqual(plan({ costs: [], records: [undo], force: true }), []);
  // Back again (restored, say): still by hand.
  assert.equal(only(plan({ costs: [old], records: [undo] }), "wait").reason, COST_WAIT.handAgain);
  assert.deepEqual(plan({ costs: [old], records: [byHand(COST_WAIT.handAgain, old)] }), []);
});

test("a deleted customer's expenses are left alone in QuickBooks", () => {
  const gone = { costs: [], liveLeads: new Set<string>() };
  assert.deepEqual(plan({ ...gone, records: [sent(), receiptSent()] }), []);
  // No step at all for it: not even for a receipt that was still waiting to go on it.
  assert.deepEqual(plan({ ...gone, records: [sent(), receiptWaiting(COST_WAIT.receiptInDrive)] }), []);
  assert.deepEqual(plan({ ...gone, records: [byHand(COST_WAIT.oldCost)] }), []);
  assert.deepEqual(plan({ ...gone, records: [sent({ status: "failed", failed_op: "change", reason: "no" })] }), []);
  // A plain wait for it is forgotten.
  assert.deepEqual(ops(plan({ ...gone, records: [waiting(COST_WAIT.noPayout), receiptWaiting("x")] })), [
    "drop:expense:c1",
    "drop:expense_receipt:c1",
  ]);
});

test("a customer being restored (or being deleted) is left alone too", () => {
  for (const liveLeads of [new Set(["L1"]), new Set<string>()]) {
    const restoring = { costs: [], liveLeads, inTrash: new Set(["L1"]) };
    assert.deepEqual(plan({ ...restoring, records: [sent(), receiptSent()] }), []);
    assert.deepEqual(plan({ ...restoring, records: [byHand(COST_WAIT.oldCost)] }), []);
    assert.deepEqual(plan({ ...restoring, records: [sent({ status: "failed", failed_op: "change", reason: "no" })] }), []);
    assert.deepEqual(plan({ ...restoring, records: [byHand(COST_WAIT.deletedByHand)] }), []);
  }
  // Its costs already back while its trash row is still there: planned as usual.
  assert.deepEqual(plan({ inTrash: new Set(["L1"]), records: [sent(), receiptSent()], costs: [cost({ receiptPath: R })] }), []);
  assert.deepEqual(ops(plan({ inTrash: new Set(["L1"]), costs: [cost({ amountCents: 1 })], records: [sent()] })), ["update_expense:expense:c1"]);
});

test("a restored customer's costs come back as they were: nothing is sent twice", () => {
  assert.deepEqual(plan({ costs: [cost({ receiptPath: R })], records: [sent(), receiptSent()] }), []);
  const old = cost({ lenderFee: false });
  assert.deepEqual(plan({ costs: [old], records: [byHand(COST_WAIT.oldCost, old)] }), []);
});

test("an expense whose customer isn't known is never deleted in QuickBooks", () => {
  assert.deepEqual(plan({ costs: [], records: [sent({ lead_id: null })] }), []);
  assert.deepEqual(plan({ costs: [], records: [sent({ lead_id: undefined })] }), []);
});

test("a cost moved to another customer has its records follow, though nothing else changes", () => {
  const moved = cost({ leadId: "L2", receiptPath: R });
  const steps = plan({ costs: [moved], records: [sent(), receiptSent()], liveLeads: new Set(["L1", "L2"]) });
  assert.deepEqual(ops(steps), ["note_lead:expense:c1", "note_lead:expense_receipt:c1"]);
  for (const s of steps) assert.equal((s as Extract<CostStep, { op: "note_lead" }>).leadId, "L2");
  assert.deepEqual(plan({ costs: [cost({ receiptPath: R })], records: [sent(), receiptSent()] }), []);
});

test("a bill payment's cost isn't the job's: no step, and its record is left alone", () => {
  const billCosts = new Set(["c1"]);
  assert.deepEqual(plan({ billCosts }), []);
  assert.deepEqual(plan({ billCosts, records: [waiting(COST_WAIT.noPayout)] }), []);
  assert.deepEqual(plan({ billCosts, costs: [], records: [sent(), receiptSent()] }), []);
  assert.deepEqual(plan({ billCosts, costs: [cost({ leadId: "L2" })], records: [sent()] }), []);
});

// ---------------------------------------------------------------- receipts

test("a fee's receipt goes with it, in the same run, named for its lender", () => {
  const steps = plan({ costs: [cost({ receiptPath: R })] });
  assert.deepEqual(ops(steps), ["create_expense:expense:c1", "attach_receipt:expense_receipt:c1"]);
  const attach = steps[1] as Extract<CostStep, { op: "attach_receipt" }>;
  assert.deepEqual(attach.file, { fileName: "Receipt · Service Finance · Oct 8.pdf", contentType: "application/pdf" });
  assert.equal(attach.hash, receiptHash(R));
  assert.equal(attach.record, null);
  // Already in QuickBooks without it: it follows now.
  assert.deepEqual(ops(plan({ costs: [cost({ receiptPath: R })], records: [sent()] })), ["attach_receipt:expense_receipt:c1"]);
});

test("a receipt waits with its expense: nothing for it while the expense doesn't go", () => {
  const withReceipt = cost({ receiptPath: R });
  assert.deepEqual(ops(plan({ costs: [withReceipt], settings: { payoutAccount: null, feeAccount: "62" } })), ["wait:expense:c1"]);
  const refused = waiting("no", { status: "failed", failed_op: "add", next_try_at: LATER });
  assert.deepEqual(plan({ costs: [withReceipt], records: [refused] }), []);
  const old = cost({ lenderFee: false, receiptPath: R });
  assert.deepEqual(ops(plan({ costs: [old] })), ["wait:expense:c1"]);
  assert.deepEqual(plan({ costs: [old], records: [byHand(COST_WAIT.oldCost, old)] }), []);
});

test("a receipt kept in Google Drive waits, saying to attach it by hand", () => {
  const w = only(plan({ costs: [cost({ receiptPath: "drive:abc" })], records: [sent()] }), "wait");
  assert.equal(w.recordType, "expense_receipt");
  assert.equal(w.reason, COST_WAIT.receiptInDrive);
  assert.equal(w.hash, receiptHash("drive:abc"));
});

test("a receipt moved to Google Drive after it was attached stays attached: noted, nothing taken off", () => {
  const moved = cost({ receiptPath: "drive:abc" });
  const settle = only(plan({ costs: [moved], records: [sent(), receiptSent()] }), "settle");
  assert.equal(settle.recordType, "expense_receipt");
  assert.equal(settle.noted, receiptHash("drive:abc"));
  assert.deepEqual(plan({ costs: [moved], records: [sent(), receiptSent({ tried_hash: receiptHash("drive:abc") })] }), []);
});

test("a receipt replaced in the CRM replaces the one the CRM attached", () => {
  const replaced = cost({ receiptPath: "receipts/L1/1728500000000-new.pdf" });
  const attach = only(plan({ costs: [replaced], records: [sent(), receiptSent()] }), "attach_receipt");
  assert.deepEqual(attach.record, receiptSent());
  assert.equal(attach.hash, receiptHash("receipts/L1/1728500000000-new.pdf"));
});

test("a receipt taken off in the CRM comes off in QuickBooks; a refused removal rests", () => {
  assert.deepEqual(ops(plan({ records: [sent(), receiptSent()] })), ["remove_receipt:expense_receipt:c1"]);
  const resting = receiptSent({ status: "failed", failed_op: "remove", reason: "no", next_try_at: LATER });
  assert.deepEqual(plan({ records: [sent(), resting] }), []);
  // One that never went is forgotten.
  assert.deepEqual(ops(plan({ records: [sent(), receiptWaiting(COST_WAIT.receiptInDrive)] })), ["drop:expense_receipt:c1"]);
  // Back as QuickBooks has it: settled.
  assert.deepEqual(ops(plan({ costs: [cost({ receiptPath: R })], records: [sent(), receiptSent({ status: "waiting", reason: "x" })] })), [
    "settle:expense_receipt:c1",
  ]);
});

test("a kind of photo QuickBooks doesn't take waits, saying why", () => {
  const w = only(plan({ costs: [cost({ receiptPath: "receipts/L1/1-IMG_2231.heic" })], records: [sent()] }), "wait");
  assert.equal(w.reason, "QuickBooks doesn't take .heic photos. Attach it again as a JPG, PNG or PDF.");
});

test("steps come in order: repeats, receipts off, deletes, forgotten, customers noted, then the rest", () => {
  const c = (id: string, over: Partial<SyncCost> = {}) => cost({ id, ...over });
  const r = (id: string, over: Partial<SyncRecord> = {}) => sent({ record_id: id, bill_id: id, ...over });
  const steps = plan({
    costs: [c("new"), c("moved", { leadId: "L2" }), c("early", { spentOn: "2026-09-20" }), c("unsure")],
    liveLeads: new Set(["L1", "L2"]),
    records: [
      r("unsure", { qb_id: null, status: "waiting", reason: "Being sent to QuickBooks now.", doubt }),
      r("moved"),
      r("early", { qb_id: null, qb_hash: null, status: "waiting", reason: COST_WAIT.noPayout }),
      r("deleted"),
      r("deleted", { record_type: "expense_receipt", qb_id: "901" }),
    ],
  });
  assert.deepEqual(ops(steps), [
    "resolve:expense:unsure",
    "remove_receipt:expense_receipt:deleted",
    "delete_expense:expense:deleted",
    "drop:expense:early",
    "note_lead:expense:moved",
    "create_expense:expense:new",
  ]);
});

test("a stray receipt record (no expense record, no cost) comes off only while its customer is in the CRM", () => {
  const stray = receiptSent();
  const step = only(plan({ costs: [], records: [stray] }), "remove_receipt");
  assert.equal(step.forDelete, undefined);
  assert.deepEqual(plan({ costs: [], records: [stray], inTrash: new Set(["L1"]) }), []);
  assert.deepEqual(plan({ costs: [], records: [stray], liveLeads: new Set() }), []);
  assert.deepEqual(ops(plan({ costs: [], records: [receiptWaiting("x")], liveLeads: new Set() })), ["drop:expense_receipt:c1"]);
});

// ---------------------------------------------------------------- bodies, hashes, wording

test("a new expense is paid out of the payout account, to the lender, on its job, not billable", () => {
  const ref = { vendorId: "V1", payoutAccountId: "35", feeAccountId: "62" };
  assert.deepEqual(purchaseBody(cost(), ref), {
    PaymentType: "Cash",
    AccountRef: { value: "35" },
    EntityRef: { value: "V1", type: "Vendor" },
    TxnDate: "2026-10-08",
    PrivateNote: "EST-1058 · James Carter · Basement finish",
    Line: [
      {
        DetailType: "AccountBasedExpenseLineDetail",
        Amount: 1920,
        Description: "Service Finance dealer fee on EST-1058",
        AccountBasedExpenseLineDetail: { AccountRef: { value: "62" } },
      },
    ],
  });
  assert.deepEqual(purchaseBody(cost({ tag: "J1" }), ref).Line[0].AccountBasedExpenseLineDetail, {
    AccountRef: { value: "62" },
    CustomerRef: { value: "J1" },
    BillableStatus: "NotBillable",
  });
  assert.equal("Description" in purchaseBody(cost({ description: "" }), ref).Line[0], false);
  assert.equal("Description" in purchaseBody(cost({ description: null }), ref).Line[0], false);
  assert.equal(purchaseBody(cost({ amountCents: 12345 }), ref).Line[0].Amount, 123.45);
});

test("what's hashed: what QuickBooks would show, accounts left out; by hand, what the CRM has", () => {
  // The accounts aren't in it: a new match or payout account isn't applied to what went.
  const a = plan({ settings: { payoutAccount: "35", feeAccount: "62" } })[0] as Extract<CostStep, { op: "create_expense" }>;
  const b = plan({ settings: { payoutAccount: "36", feeAccount: "63" } })[0] as Extract<CostStep, { op: "create_expense" }>;
  assert.equal(a.hash, b.hash);
  assert.equal(costHash(cost({ tag: "J1" })), `${costHash(cost())}:job:J1`);
  assert.equal(onlyJobDiffers(costHash(cost()), costHash(cost({ tag: "J1" }))), true);
  assert.equal(onlyJobDiffers(costHash(cost()), costHash(cost({ tag: "J1", amountCents: 1 }))), false);
  for (const changed of [cost({ amountCents: 1 }), cost({ spentOn: "2026-10-09" }), cost({ vendorName: "X" }), cost({ description: "x" }), cost({ memo: "x" })]) {
    assert.notEqual(costHash(changed), costHash(cost()));
  }
  assert.equal(costHash(cost({ leadId: "L2", contractId: null, lenderFee: false })), costHash(cost()));
  // By hand: the customer and contract count; the tag and the memo don't.
  assert.notEqual(costCrmHash(cost({ leadId: "L2" })), costCrmHash(cost()));
  assert.notEqual(costCrmHash(cost({ contractId: "K2" })), costCrmHash(cost()));
  assert.notEqual(costCrmHash(cost({ amountCents: 1 })), costCrmHash(cost()));
  assert.equal(costCrmHash(cost({ tag: "J1" })), costCrmHash(cost()));
  assert.equal(costCrmHash(cost({ memo: "x" })), costCrmHash(cost()));
  assert.notEqual(costCrmHash(cost()), costHash(cost()));
});

const line = (over: Record<string, unknown> = {}) => ({
  Id: "1",
  DetailType: "AccountBasedExpenseLineDetail",
  Amount: 1920,
  Description: "Service Finance dealer fee on EST-1058",
  AccountBasedExpenseLineDetail: { AccountRef: { value: "70" }, ClassRef: { value: "C1" } },
  ...over,
});
const now = (over: Partial<QbPurchaseNow> = {}): QbPurchaseNow => ({
  id: "77",
  syncToken: "3",
  lines: [line()],
  entityRef: { value: "V1", name: "Service Finance" },
  accountRef: { value: "35", name: "Chase Checking" },
  paymentType: "Cash",
  ...over,
});
const bodyOf = (r: ReturnType<typeof purchaseUpdateBody>) => {
  assert.ok("body" in r, "a body, not a wait");
  assert.ok("Line" in r.body, "every change carries its lines");
  return r.body;
};

test("a change to an expense in QuickBooks always carries its lines, keeping what the bookkeeper set", () => {
  const ref = { vendorId: "V9", lastTag: null };
  // Nothing on the line changed: the line as QuickBooks has it (its Id too).
  const same = bodyOf(purchaseUpdateBody(cost({ spentOn: "2026-10-09" }), now(), ref));
  assert.deepEqual(same, {
    Id: "77",
    SyncToken: "3",
    sparse: true,
    PaymentType: "Cash",
    AccountRef: { value: "35", name: "Chase Checking" },
    EntityRef: { value: "V9", type: "Vendor" },
    TxnDate: "2026-10-09",
    PrivateNote: "EST-1058 · James Carter · Basement finish",
    Line: [line()],
  });
  // The amount changed: the line keeps its Id, account and class.
  assert.deepEqual(bodyOf(purchaseUpdateBody(cost({ amountCents: 200000 }), now(), ref)).Line, [line({ Amount: 2000 })]);
  // What for cleared: it comes off the line.
  const cleared = bodyOf(purchaseUpdateBody(cost({ description: "" }), now(), ref)).Line as Record<string, unknown>[];
  assert.equal("Description" in cleared[0], false);
  assert.equal(cleared[0].Id, "1");
  // What QuickBooks doesn't say isn't made up.
  const bare = bodyOf(purchaseUpdateBody(cost(), now({ paymentType: null, accountRef: undefined }), ref));
  assert.equal("PaymentType" in bare, false);
  assert.equal("AccountRef" in bare, false);
  // Split into lines with the same total: all of them back, the CRM's job on the untagged ones.
  const split = now({ lines: [line({ Amount: 1000 }), line({ Id: "2", Amount: 920 })] });
  assert.deepEqual(bodyOf(purchaseUpdateBody(cost({ tag: "J1" }), split, ref)).Line, [
    line({ Amount: 1000, AccountBasedExpenseLineDetail: { AccountRef: { value: "70" }, ClassRef: { value: "C1" }, CustomerRef: { value: "J1" }, BillableStatus: "NotBillable" } }),
    line({ Id: "2", Amount: 920, AccountBasedExpenseLineDetail: { AccountRef: { value: "70" }, ClassRef: { value: "C1" }, CustomerRef: { value: "J1" }, BillableStatus: "NotBillable" } }),
  ]);
  assert.deepEqual(bodyOf(purchaseUpdateBody(cost({ memo: "x" }), split, ref)).Line, split.lines);
  // Split, and the CRM's total is another: it waits.
  assert.deepEqual(purchaseUpdateBody(cost({ amountCents: 200000 }), split, ref), { wait: WAIT.split });
  // A customer the bookkeeper put on the line stays.
  const theirs = line({ AccountBasedExpenseLineDetail: { AccountRef: { value: "70" }, CustomerRef: { value: "B7" } } });
  const kept = bodyOf(purchaseUpdateBody(cost({ tag: "J1", amountCents: 200000 }), now({ lines: [theirs] }), ref)).Line as Record<string, unknown>[];
  assert.deepEqual(kept[0].AccountBasedExpenseLineDetail, { AccountRef: { value: "70" }, CustomerRef: { value: "B7" } });
  // The CRM's own last tag moves.
  const ours = line({ AccountBasedExpenseLineDetail: { AccountRef: { value: "70" }, CustomerRef: { value: "J0" }, BillableStatus: "NotBillable" } });
  const moved = bodyOf(purchaseUpdateBody(cost({ tag: "J1" }), now({ lines: [ours] }), { vendorId: "V9", lastTag: "J0" })).Line as Record<string, unknown>[];
  assert.deepEqual(moved[0].AccountBasedExpenseLineDetail, { AccountRef: { value: "70" }, CustomerRef: { value: "J1" }, BillableStatus: "NotBillable" });
});

test("only the job changed: just the lines, with what QuickBooks has in the header", () => {
  const body = purchaseRetagBody(cost({ tag: "J1" }), now(), null);
  assert.deepEqual(body, {
    Id: "77",
    SyncToken: "3",
    sparse: true,
    PaymentType: "Cash",
    AccountRef: { value: "35", name: "Chase Checking" },
    EntityRef: { value: "V1", name: "Service Finance" },
    Line: [line({ AccountBasedExpenseLineDetail: { AccountRef: { value: "70" }, ClassRef: { value: "C1" }, CustomerRef: { value: "J1" }, BillableStatus: "NotBillable" } })],
  });
  const ours = line({ AccountBasedExpenseLineDetail: { AccountRef: { value: "70" }, CustomerRef: { value: "J0" }, BillableStatus: "NotBillable" } });
  assert.deepEqual((purchaseRetagBody(cost({ tag: "J1" }), now({ lines: [ours] }), "J0")!.Line as Record<string, unknown>[])[0].AccountBasedExpenseLineDetail, {
    AccountRef: { value: "70" },
    CustomerRef: { value: "J1" },
    BillableStatus: "NotBillable",
  });
  // Leaving the job: the CRM's tag comes off.
  assert.deepEqual((purchaseRetagBody(cost({ tag: null }), now({ lines: [ours] }), "J0")!.Line as Record<string, unknown>[])[0].AccountBasedExpenseLineDetail, {
    AccountRef: { value: "70" },
  });
  // Every line carries the bookkeeper's customer: nothing is the CRM's to move.
  const theirs = line({ AccountBasedExpenseLineDetail: { AccountRef: { value: "70" }, CustomerRef: { value: "B7" } } });
  assert.equal(purchaseRetagBody(cost({ tag: "J1" }), now({ lines: [theirs] }), "J0"), null);
  const bare = purchaseRetagBody(cost({ tag: "J1" }), now({ paymentType: null, accountRef: undefined, entityRef: undefined }), null)!;
  assert.deepEqual(Object.keys(bare), ["Id", "SyncToken", "sparse", "Line"]);
});

test("a fee's receipt is named for its lender; bills' receipts are named as before", () => {
  assert.deepEqual(costReceiptFile(cost(), R), { file: { fileName: "Receipt · Service Finance · Oct 8.pdf", contentType: "application/pdf" } });
  assert.deepEqual(costReceiptFile(cost({ vendorName: null }), R), { file: { fileName: "Receipt · Expense · Oct 8.pdf", contentType: "application/pdf" } });
  assert.deepEqual(costReceiptFile(cost(), "drive:abc"), { wait: COST_WAIT.receiptInDrive });
  assert.deepEqual(receiptFile("drive:abc", "V", "2026-10-08"), {
    wait: "This receipt is kept in Google Drive, so it can't be attached in QuickBooks. Attach the file to the bill instead.",
  });
  assert.deepEqual(receiptFile(R, null, "2026-10-08"), { file: { fileName: "Receipt · Bill · Oct 8.pdf", contentType: "application/pdf" } });
});

test("the words step 4 shares with step 3 are step 3's, exactly", () => {
  assert.equal(COST_WAIT.closedByHand("2026-10-31"), SALES_WAIT.closedByHand("2026-10-31"));
  assert.equal(COST_WAIT.closedChange("2026-10-31"), SALES_WAIT.closedChange("2026-10-31"));
  assert.equal(COST_WAIT.handAgain, SALES_WAIT.handAgain);
  assert.equal(CHANGED_SINCE, SALES_CHANGED_SINCE);
  const ending = "by hand if it isn't there yet.";
  assert.ok(SALES_WAIT.beforeStart("2026-10-01").endsWith(ending));
  assert.ok(COST_WAIT.oldCost.endsWith(ending));
});

// ---------------------------------------------------------------- runner helpers

test("QuickBooks' closing date is reused only when the invoices job read it under 10 minutes ago", () => {
  const at = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
  assert.equal(PREFS_FRESH_MS, 10 * 60_000);
  assert.deepEqual(closeDateFor({ qb_prefs: { bookCloseDate: "2026-09-30" }, qb_prefs_read_at: at(2 * 60_000) }, NOW), { closeDate: "2026-09-30" });
  assert.deepEqual(closeDateFor({ qb_prefs: { bookCloseDate: null }, qb_prefs_read_at: at(2 * 60_000) }, NOW), { closeDate: null });
  assert.deepEqual(closeDateFor({ qb_prefs: {}, qb_prefs_read_at: at(2 * 60_000) }, NOW), { closeDate: null });
  assert.equal(closeDateFor({ qb_prefs: { bookCloseDate: "2026-09-30" }, qb_prefs_read_at: at(20 * 60_000) }, NOW), "read");
  assert.equal(closeDateFor({ qb_prefs: { bookCloseDate: "2026-09-30" }, qb_prefs_read_at: at(PREFS_FRESH_MS) }, NOW), "read");
  for (const qb_prefs of [null, "2026-09-30", ["2026-09-30"], 7]) {
    assert.equal(closeDateFor({ qb_prefs, qb_prefs_read_at: at(60_000) }, NOW), "read");
  }
  assert.equal(closeDateFor({ qb_prefs: { bookCloseDate: "2026-09-30" }, qb_prefs_read_at: null }, NOW), "read");
  assert.equal(closeDateFor({ qb_prefs: { bookCloseDate: "2026-09-30" }, qb_prefs_read_at: "yesterday-ish" }, NOW), "read");
  // A clock ahead isn't fresh forever.
  assert.equal(closeDateFor({ qb_prefs: { bookCloseDate: "2026-09-30" }, qb_prefs_read_at: at(-5 * 60_000) }, NOW), "read");
});

test("Lender payouts land in counts only while QuickBooks lists it as a bank account", () => {
  const accounts = [
    { id: "35", name: "Chase Checking", type: "Bank" },
    { id: "41", name: "Amex", type: "Credit Card" },
    { id: "50", name: "Undeposited Funds", type: "Other Current Asset" },
  ];
  assert.equal(payoutAccountOf(accounts, "35"), "35");
  assert.equal(payoutAccountOf(accounts, "41"), null);
  assert.equal(payoutAccountOf(accounts, "50"), null);
  assert.equal(payoutAccountOf(accounts, "99"), null);
  assert.equal(payoutAccountOf(accounts, null), null);
  assert.equal(payoutAccountOf(null, "35"), null);
  assert.equal(payoutAccountOf(undefined, "35"), null);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BACKOFF_MINUTES,
  billBody,
  billDay,
  billHash,
  billMemo,
  billPaymentBody,
  billQbChips,
  billUpdateBody,
  nextTryAt,
  paymentHash,
  paymentQbNote,
  newRequestId,
  planBillSync,
  qbText,
  qbVendorName,
  qbWebUrl,
  receiptFile,
  receiptHash,
  type SyncBill,
  type SyncPayment,
  type SyncRecord,
} from "./bill-sync.ts";
import {
  attachableBillQuery,
  attachableNoteQuery,
  classifyQbError,
  createBillPayment,
  deleteAttachable,
  findAttachableByNote,
  uploadReceipt,
  findVendor,
  vendorQuery,
  voidBillPayment,
  type QbAccess,
} from "./api.ts";

/**
 * QuickBooks, step 2 (DECISIONS #173): once a company turns it on, every
 * bill dated from its start date goes to QuickBooks as a Bill, and every
 * payment on it as a Bill Payment from the account it was paid from. A
 * change in the CRM is sent too; a bill voided in the CRM is deleted in
 * QuickBooks (QuickBooks can't void a bill), a payment deleted in the CRM
 * is voided there. Only what the CRM sent is ever changed. Anything that
 * can't go waits, with the reason on its row.
 */

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const NOW = new Date("2026-10-08T15:00:00Z");
const FROM = "2026-10-08";

const bill = (over: Partial<SyncBill> = {}): SyncBill => ({
  id: "b1",
  vendorName: "ABC Lumber",
  vendorCategory: null,
  reference: "Framing lumber",
  amountCents: 324000,
  billDate: "2026-10-08",
  dueDate: "2026-10-20",
  createdAt: "2026-10-08T16:00:00Z",
  voided: false,
  memo: "EST-1047 · Maria Lopez · Kitchen remodel",
  receiptPath: null,
  ...over,
});

const card = { id: "pa1", name: "Amex", kind: "credit_card", qbAccountId: "41", qbType: "Credit Card" };
const bank = { id: "pa2", name: "Chase Checking", kind: "bank", qbAccountId: "35", qbType: "Bank" };

const payment = (over: Partial<SyncPayment> = {}): SyncPayment => ({
  id: "p1",
  billId: "b1",
  amountCents: 324000,
  paidOn: "2026-10-08",
  method: "card",
  reference: "4471",
  note: null,
  createdAt: "2026-10-08T16:05:00Z",
  account: card,
  ...over,
});

const sent = (over: Partial<SyncRecord> = {}): SyncRecord => ({
  record_type: "bill",
  record_id: "b1",
  bill_id: "b1",
  qb_id: "108",
  qb_hash: billHash(bill()),
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

const accounts = { byCategory: new Map([["materials", "60"]]), fallback: "61" };
const plan = (p: Partial<Parameters<typeof planBillSync>[0]> = {}) =>
  planBillSync({ bills: [bill()], payments: [], records: [], sendFrom: FROM, now: NOW, accounts, ...p });
const ops = (steps: ReturnType<typeof planBillSync>) => steps.map((s) => `${s.op}:${"recordId" in s ? s.recordId : ""}`);

// ---------------------------------------------------------------- text

test("text sent to QuickBooks fits its rules: no colons in names, plain characters, within its lengths", () => {
  assert.equal(qbVendorName("  Stucco: Humberto\t& Sons \n"), "Stucco - Humberto & Sons");
  assert.equal(qbVendorName("José’s Tile"), "José's Tile");
  assert.equal(qbVendorName("🔨"), "");
  assert.equal(qbVendorName(null), "");
  assert.equal(qbVendorName("x".repeat(600)).length, 500);
  assert.equal(qbText("“Drywall” – mud…", 4000), '"Drywall" - mud...');
  assert.equal(qbText("a".repeat(30), 21), "a".repeat(21));
});

test("the memo names the contract, the customer and the job; a bill with no job says so", () => {
  assert.equal(billMemo({ docNumber: "EST-1047", customer: "Maria Lopez", title: "Kitchen remodel" }), "EST-1047 · Maria Lopez · Kitchen remodel");
  assert.equal(billMemo({ docNumber: null, customer: "Maria Lopez", title: null }), "Maria Lopez");
  assert.equal(billMemo({ docNumber: null, customer: null, title: null }), "No job (overhead)");
});

test("a bill with no bill date counts from the day it was entered", () => {
  assert.equal(billDay(bill()), "2026-10-08");
  assert.equal(billDay(bill({ billDate: null, createdAt: "2026-10-07T23:00:00Z" })), "2026-10-07");
});

// ---------------------------------------------------------------- what is sent

test("a bill goes as one line to the matched expense account, with the job in the memo", () => {
  const body = billBody(bill(), { vendorId: "56", accountId: "60" });
  assert.deepEqual(body, {
    VendorRef: { value: "56" },
    TxnDate: "2026-10-08",
    DueDate: "2026-10-20",
    PrivateNote: "EST-1047 · Maria Lopez · Kitchen remodel",
    Line: [
      {
        DetailType: "AccountBasedExpenseLineDetail",
        Amount: 3240,
        Description: "Framing lumber",
        AccountBasedExpenseLineDetail: { AccountRef: { value: "60" } },
      },
    ],
  });
  // No due date in the CRM: due on its bill date.
  assert.equal(billBody(bill({ dueDate: null }), { vendorId: "56", accountId: "60" }).DueDate, "2026-10-08");
  assert.equal(billBody(bill({ amountCents: 61248 }), { vendorId: "56", accountId: "60" }).Line[0].Amount, 612.48);
});

test("a card payment goes as a credit card bill payment; bank and cash as a check-type one", () => {
  const cardBody = billPaymentBody(payment(), { vendorId: "56", billQbId: "108" });
  assert.equal(cardBody.PayType, "CreditCard");
  assert.deepEqual(cardBody.CreditCardPayment, { CCAccountRef: { value: "41" } });
  assert.equal("CheckPayment" in cardBody, false);
  assert.equal(cardBody.TotalAmt, 3240);
  assert.deepEqual(cardBody.Line, [{ Amount: 3240, LinkedTxn: [{ TxnId: "108", TxnType: "Bill" }] }]);
  assert.deepEqual(cardBody.VendorRef, { value: "56" });
  assert.equal(cardBody.TxnDate, "2026-10-08");
  assert.equal(cardBody.PrivateNote, "Card · ref 4471");

  const check = billPaymentBody(payment({ method: "check", reference: "10442", account: bank }), { vendorId: "56", billQbId: "108" });
  assert.equal(check.PayType, "Check");
  // Already paid: kept out of QuickBooks' print-checks queue.
  assert.deepEqual(check.CheckPayment, { BankAccountRef: { value: "35" }, PrintStatus: "PrintComplete" });
  assert.equal(check.DocNumber, "10442");

  const zelle = billPaymentBody(payment({ method: "zelle", account: { ...bank, kind: "cash", qbType: null } }), { vendorId: "56", billQbId: "108" });
  assert.equal(zelle.PayType, "Check");
  assert.deepEqual(zelle.CheckPayment, { BankAccountRef: { value: "35" }, PrintStatus: "NotSet" });
  assert.equal("DocNumber" in zelle, false);
  // The matched QuickBooks account decides, whatever the CRM account is called.
  assert.equal(billPaymentBody(payment({ account: { ...card, qbType: "Bank" } }), { vendorId: "56", billQbId: "108" }).PayType, "Check");
  assert.equal(billPaymentBody(payment({ account: { ...bank, qbType: "Credit Card" } }), { vendorId: "56", billQbId: "108" }).PayType, "CreditCard");
  // QuickBooks' document numbers are at most 21 characters.
  assert.equal(
    billPaymentBody(payment({ method: "check", reference: "1".repeat(30), account: bank }), { vendorId: "56", billQbId: "108" }).DocNumber,
    "1".repeat(21)
  );
});

// ---------------------------------------------------------------- the plan

test("bills dated from the start date go; earlier ones stay out", () => {
  assert.deepEqual(ops(plan()), ["create_bill:b1"]);
  assert.deepEqual(ops(plan({ bills: [bill({ billDate: "2026-10-07" })] })), []);
  assert.deepEqual(ops(plan({ bills: [bill({ billDate: null, createdAt: "2026-10-08T01:00:00Z" })] })), ["create_bill:b1"]);
});

test("a bill's cost lands in its vendor's category account, else the default; none matched means it waits", () => {
  const [a] = plan({ bills: [bill({ vendorCategory: " Materials " })] });
  assert.equal(a.op === "create_bill" && a.accountId, "60");
  const [b] = plan();
  assert.equal(b.op === "create_bill" && b.accountId, "61");
  const [c] = plan({ accounts: { byCategory: new Map(), fallback: null } });
  assert.equal(c.op, "wait");
  assert.match(c.op === "wait" ? c.reason : "", /Match a QuickBooks account for job costs in Settings › QuickBooks/);
  const [d] = plan({ bills: [bill({ vendorName: "  " })] });
  assert.equal(d.op === "wait" && d.reason, "This bill has no vendor.");
});

test("a sent bill is sent again only when something QuickBooks shows changed", () => {
  assert.deepEqual(ops(plan({ records: [sent()] })), []);
  assert.deepEqual(ops(plan({ bills: [bill({ amountCents: 330000 })], records: [sent()] })), ["update_bill:b1"]);
  assert.deepEqual(ops(plan({ bills: [bill({ vendorName: "XYZ Supply" })], records: [sent()] })), ["update_bill:b1"]);
  // Already in QuickBooks: a bill moved before the start date still follows its changes.
  assert.deepEqual(ops(plan({ bills: [bill({ billDate: "2026-09-01" })], records: [sent()] })), ["update_bill:b1"]);
  // The planned pay date isn't in QuickBooks, so it isn't in the hash.
  assert.equal(billHash(bill()), billHash({ ...bill() }));
  assert.notEqual(billHash(bill()), billHash(bill({ memo: "EST-1048 · Maria Lopez · Bath" })));
});

test("payments follow their bill, in the order they were paid", () => {
  const steps = plan({ payments: [payment({ id: "p2", paidOn: "2026-10-09", amountCents: 100000 }), payment({ amountCents: 200000 })] });
  assert.deepEqual(ops(steps), ["create_bill:b1", "create_payment:p1", "create_payment:p2"]);
  // The bill and its first payment are already there: only the new payment goes.
  assert.deepEqual(
    ops(
      plan({
        payments: [payment({ id: "p0", amountCents: 100000 }), payment({ amountCents: 100000, paidOn: "2026-10-09" })],
        records: [sent(), sent({ record_type: "bill_payment", record_id: "p0", qb_id: "200" })],
      })
    ),
    ["create_payment:p1"]
  );
});

test("a payment waits for its paid-from account, its match, and its bill", () => {
  const reason = (steps: ReturnType<typeof planBillSync>, id: string) => {
    const s = steps.find((x) => "recordId" in x && x.recordId === id);
    return s?.op === "wait" ? s.reason : s?.op;
  };
  assert.equal(reason(plan({ records: [sent()], payments: [payment({ account: null })] }), "p1"), 'No "Paid from" account on this payment. Delete it and record it again with one.');
  assert.equal(
    reason(plan({ records: [sent()], payments: [payment({ account: { ...card, name: "Home Depot card", qbAccountId: null, qbType: null } })] }), "p1"),
    '"Home Depot card" isn\'t matched to a QuickBooks account yet. Match it in Settings › QuickBooks.'
  );
  // Its bill can't go yet, so neither can the payment.
  assert.equal(reason(plan({ bills: [bill({ vendorName: "" })], payments: [payment()] }), "p1"), "Waits for its bill to go to QuickBooks first.");
  // More paid than the bill: the payment that goes over waits.
  const over = plan({ records: [sent()], payments: [payment({ amountCents: 300000 }), payment({ id: "p2", paidOn: "2026-10-09", amountCents: 50000 })] });
  assert.equal(reason(over, "p1"), "create_payment");
  assert.equal(reason(over, "p2"), "This payment is more than what's left on the bill.");
  // What QuickBooks already has paid counts first, whatever the dates: a back-dated one that goes over waits.
  const back = plan({
    records: [sent(), sent({ record_type: "bill_payment", record_id: "p2", qb_id: "201" })],
    payments: [payment({ id: "p2", paidOn: "2026-10-15", amountCents: 200000 }), payment({ id: "p1", paidOn: "2026-10-10", amountCents: 200000 })],
  });
  assert.equal(reason(back, "p1"), "This payment is more than what's left on the bill.");
});

test("voiding a bill deletes it in QuickBooks, after voiding its payments there", () => {
  const steps = plan({
    bills: [bill({ voided: true })],
    payments: [],
    records: [sent(), sent({ record_type: "bill_payment", record_id: "p1", qb_id: "200" })],
  });
  assert.deepEqual(ops(steps), ["void_payment:p1", "delete_bill:b1"]);
  // Never sent: nothing to undo, the waiting note just goes.
  assert.deepEqual(ops(plan({ bills: [bill({ voided: true })], records: [sent({ qb_id: null, status: "waiting", reason: "x" })] })), ["drop:b1"]);
  // Already removed: nothing more.
  assert.deepEqual(ops(plan({ bills: [bill({ voided: true })], records: [sent({ qb_id: null, status: "removed" })] })), []);
  // Un-voided after it was removed: it goes again.
  assert.deepEqual(ops(plan({ records: [sent({ qb_id: null, status: "removed" })] })), ["create_bill:b1"]);
});

test("a payment deleted in the CRM is voided in QuickBooks; one never sent just goes", () => {
  const records = [sent(), sent({ record_type: "bill_payment", record_id: "p9", qb_id: "201" })];
  assert.deepEqual(ops(plan({ records })), ["void_payment:p9"]);
  assert.deepEqual(ops(plan({ records: [sent(), sent({ record_type: "bill_payment", record_id: "p9", qb_id: null, status: "waiting" })] })), ["drop:p9"]);
  // Voided already: kept as the record of what was done.
  assert.deepEqual(ops(plan({ records: [sent(), sent({ record_type: "bill_payment", record_id: "p9", qb_id: "201", status: "removed" })] })), []);
});

test("a bill deleted outright in the CRM is removed from QuickBooks too", () => {
  assert.deepEqual(ops(plan({ bills: [], records: [sent({ record_id: "gone", bill_id: "gone" })] })), ["delete_bill:gone"]);
});

test("something QuickBooks refused is tried again later, or at once when it changes", () => {
  const failed = sent({ qb_id: null, qb_hash: null, tried_hash: billHash(bill()), status: "failed", reason: "QuickBooks said: no", tries: 1, next_try_at: "2026-10-08T16:00:00Z" });
  assert.deepEqual(ops(plan({ records: [failed] })), []);
  assert.deepEqual(ops(plan({ records: [failed], now: new Date("2026-10-08T16:01:00Z") })), ["create_bill:b1"]);
  assert.deepEqual(ops(plan({ records: [failed], bills: [bill({ amountCents: 1 })] })), ["create_bill:b1"]);
  // Send now tries everything.
  assert.deepEqual(ops(plan({ records: [failed], force: true })), ["create_bill:b1"]);
  // ...and its payments wait meanwhile, without asking QuickBooks.
  const s = plan({ records: [failed], payments: [payment()] });
  assert.deepEqual(ops(s), ["wait:p1"]);
});

test("a change QuickBooks refused on a bill already there is tried again later, on Send now, or not at all if put back", () => {
  const edited = bill({ amountCents: 330000 });
  const refusedChange = sent({ status: "failed", failed_op: "change", reason: "QuickBooks said: closed", tried_hash: billHash(edited), tries: 1, next_try_at: "2026-10-08T16:00:00Z" });
  assert.deepEqual(ops(plan({ bills: [edited], records: [refusedChange] })), [], "resting");
  assert.deepEqual(ops(plan({ bills: [edited], records: [refusedChange], now: new Date("2026-10-08T16:01:00Z") })), ["update_bill:b1"]);
  assert.deepEqual(ops(plan({ bills: [edited], records: [refusedChange], force: true })), ["update_bill:b1"]);
  // Changed back to what QuickBooks has: nothing to send, the note goes.
  assert.deepEqual(ops(plan({ bills: [bill()], records: [refusedChange] })), ["settle:b1"]);
  // A vendor wait on a change, the same.
  const vendorWait = sent({ status: "waiting", reason: "inactive", tried_hash: billHash(edited), tries: 1, next_try_at: "2026-10-08T16:00:00Z" });
  assert.deepEqual(ops(plan({ bills: [edited], records: [vendorWait], force: true })), ["update_bill:b1"]);
  // Its payments still go: the bill is in QuickBooks.
  assert.deepEqual(ops(plan({ bills: [edited], records: [refusedChange], payments: [payment()] })), ["create_payment:p1"]);
});

test("an add whose answer never came is repeated exactly, first, and nothing else happens to it that run", () => {
  const doubt = { requestId: "crm-x", body: { TotalAmt: 1 }, hash: "h0" };
  const inDoubt = sent({ qb_id: null, qb_hash: null, status: "waiting", doubt });
  // Edited, voided, or moved before the start date meanwhile: still repeated first, then dealt with next run.
  for (const b of [bill({ amountCents: 1 }), bill({ voided: true }), bill({ billDate: "2026-01-01" })]) {
    const steps = plan({ bills: [b], records: [inDoubt], payments: [payment()] });
    assert.deepEqual(ops(steps), ["resolve:b1"]);
  }
  // A payment in doubt that was deleted in the CRM: repeated first, voided next run.
  const payDoubt = sent({ record_type: "bill_payment", record_id: "p9", qb_id: null, status: "waiting", doubt });
  assert.deepEqual(ops(plan({ records: [sent(), payDoubt] })), ["resolve:p9"]);
  // A bill isn't deleted while one of its payments is still unsettled in QuickBooks.
  assert.deepEqual(ops(plan({ bills: [bill({ voided: true })], records: [sent(), payDoubt] })), ["resolve:p9"]);
});

test("a bill someone deleted in QuickBooks is left alone, and so are its payments", () => {
  const gone = sent({ status: "gone", reason: "Deleted in QuickBooks" });
  const steps = plan({ bills: [bill({ amountCents: 1 })], records: [gone], payments: [payment()] });
  assert.deepEqual(ops(steps), ["wait:p1"]);
  assert.equal(steps[0].op === "wait" && steps[0].reason, "Its bill was deleted in QuickBooks, so the CRM doesn't send its payments.");
  assert.deepEqual(ops(plan({ bills: [bill({ voided: true })], records: [gone] })), []);
});

test("a voided bill waits to be deleted while a payment void QuickBooks refused is resting", () => {
  const resting = sent({ record_type: "bill_payment", record_id: "p9", qb_id: "201", status: "failed", failed_op: "remove", next_try_at: "2026-10-08T16:00:00Z" });
  assert.deepEqual(ops(plan({ bills: [bill({ voided: true })], records: [sent(), resting] })), []);
  assert.deepEqual(ops(plan({ bills: [bill({ voided: true })], records: [sent(), resting], force: true })), ["void_payment:p9", "delete_bill:b1"]);
  // A refused change isn't a refused removal: voiding the bill goes ahead at once.
  const refusedChange = sent({ status: "failed", failed_op: "change", tried_hash: "x", tries: 5, next_try_at: "2026-10-09T15:00:00Z" });
  assert.deepEqual(ops(plan({ bills: [bill({ voided: true })], records: [refusedChange] })), ["delete_bill:b1"]);
});

test("a change keeps what the bookkeeper set on the bill in QuickBooks", () => {
  const line = {
    Id: "1",
    DetailType: "AccountBasedExpenseLineDetail",
    Amount: 3240,
    Description: "Framing lumber",
    AccountBasedExpenseLineDetail: { AccountRef: { value: "77" }, ClassRef: { value: "9" }, CustomerRef: { value: "5" }, BillableStatus: "Billable" },
  };
  const current = { id: "108", syncToken: "3", lines: [line] };
  // Only the memo or dates changed: the line isn't sent at all.
  const a = billUpdateBody(bill({ memo: "EST-1048 · Maria Lopez · Bath" }), current, { vendorId: "56" });
  assert.ok("body" in a);
  assert.deepEqual(a.body, {
    Id: "108",
    SyncToken: "3",
    sparse: true,
    VendorRef: { value: "56" },
    TxnDate: "2026-10-08",
    DueDate: "2026-10-20",
    PrivateNote: "EST-1048 · Maria Lopez · Bath",
  });
  // The amount changed: the same line, amount changed, its account, class and customer kept.
  const b = billUpdateBody(bill({ amountCents: 330000 }), current, { vendorId: "56" });
  assert.ok("body" in b);
  assert.deepEqual(b.body.Line, [{ ...line, Amount: 3300 }]);
  // A due date cleared in the CRM: due on its bill date.
  const c = billUpdateBody(bill({ dueDate: null }), current, { vendorId: "56" });
  assert.ok("body" in c && c.body.DueDate === "2026-10-08");
  // Split into two lines in QuickBooks: its lines stay; a new total waits for the bookkeeper.
  const split = { ...current, lines: [{ ...line, Amount: 3000 }, { ...line, Id: "2", Amount: 240 }] };
  const d = billUpdateBody(bill({ memo: "x" }), split, { vendorId: "56" });
  assert.ok("body" in d && !("Line" in d.body));
  const e = billUpdateBody(bill({ amountCents: 1 }), split, { vendorId: "56" });
  assert.ok("wait" in e && /split into several lines/.test(e.wait));
});

test("tries back off: 15 minutes, then an hour, four, twelve, a day", () => {
  assert.deepEqual(BACKOFF_MINUTES, [15, 60, 240, 720, 1440]);
  assert.equal(nextTryAt(1, NOW), "2026-10-08T15:15:00.000Z");
  assert.equal(nextTryAt(2, NOW), "2026-10-08T16:00:00.000Z");
  assert.equal(nextTryAt(9, NOW), "2026-10-09T15:00:00.000Z");
});

test("a wait already noted isn't written again every run", () => {
  const waiting = sent({ qb_id: null, status: "waiting", reason: "This bill has no vendor.", qb_hash: null, tried_hash: billHash(bill({ vendorName: "" })) });
  assert.deepEqual(ops(plan({ bills: [bill({ vendorName: "" })], records: [waiting] })), []);
});

test("every new try gets its own request id (QuickBooks answers a repeated one with its first answer)", () => {
  const a = newRequestId();
  assert.ok(a.length <= 50);
  assert.match(a, /^crm-[0-9a-f]{32}$/);
  assert.notEqual(a, newRequestId());
  assert.notEqual(paymentHash(payment()), paymentHash(payment({ amountCents: 1 })));
});

test("Open in QuickBooks goes to the right company, practice or real", () => {
  assert.equal(qbWebUrl("sandbox", "bill", "108", "9341"), "https://app.sandbox.qbo.intuit.com/app/bill?txnId=108&companyId=9341");
  assert.equal(qbWebUrl("production", "bill", "108", "9341"), "https://app.qbo.intuit.com/app/bill?txnId=108&companyId=9341");
});

// ---------------------------------------------------------------- Bills to Pay

const day = (iso: string) => iso.slice(5, 10);
const chips = (p: Partial<Parameters<typeof billQbChips>[0]> = {}) =>
  billQbChips({ sending: true, sendFrom: FROM, bill: bill(), billRecord: null, payments: [], day, ...p }).chips.map((c) => `${c.tone}|${c.text}`);

test("each bill says where it stands with QuickBooks", () => {
  assert.deepEqual(chips({ billRecord: sent() }), ["good|✓ In QuickBooks · Bill · 10-08"]);
  assert.deepEqual(chips({ billRecord: sent(), payments: [{ id: "p1", record: sent({ record_type: "bill_payment", record_id: "p1" }) }] }), [
    "good|✓ In QuickBooks · Bill and payment · 10-08",
  ]);
  assert.deepEqual(
    chips({
      billRecord: sent(),
      payments: [
        { id: "p1", record: sent({ record_type: "bill_payment", record_id: "p1" }) },
        { id: "p2", record: sent({ record_type: "bill_payment", record_id: "p2", qb_id: null, status: "waiting", reason: 'Match "Home Depot card"' }) },
      ],
    }),
    ["good|✓ Bill in QuickBooks", 'wait|Payment waiting: Match "Home Depot card"']
  );
  assert.deepEqual(chips({ billRecord: sent(), payments: [{ id: "p1", record: null }] }), ["good|✓ Bill in QuickBooks", "off|Payment goes in a few minutes"]);
  assert.deepEqual(chips({ billRecord: sent({ qb_id: null, status: "waiting", reason: "This bill has no vendor." }) }), ["wait|Waiting: This bill has no vendor."]);
  assert.deepEqual(chips({ billRecord: sent({ qb_id: null, status: "failed", reason: "QuickBooks said: no" }) }), ["bad|Didn't go to QuickBooks: QuickBooks said: no"]);
  assert.deepEqual(chips({ billRecord: sent({ status: "failed", reason: "QuickBooks said: no" }) }), [
    "bad|In QuickBooks, but the last change didn't go: QuickBooks said: no",
  ]);
  assert.deepEqual(chips(), ["off|Goes to QuickBooks in a few minutes"]);
  assert.deepEqual(chips({ bill: bill({ billDate: "2026-09-30" }) }), ["off|Before 10-08: not sent"]);
  assert.deepEqual(chips({ sending: false }), []);
  // Turned off later: what went still says so.
  assert.deepEqual(chips({ sending: false, billRecord: sent() }), ["good|✓ In QuickBooks · Bill · 10-08"]);
  assert.deepEqual(chips({ bill: bill({ voided: true }), billRecord: sent({ qb_id: null, status: "removed" }) }), ["off|Removed from QuickBooks"]);
  assert.deepEqual(chips({ bill: bill({ voided: true }), billRecord: sent() }), ["off|Being removed from QuickBooks"]);
  assert.deepEqual(chips({ bill: bill({ voided: true }), billRecord: sent({ status: "failed", failed_op: "remove", reason: "closed" }) }), [
    "bad|Couldn't remove from QuickBooks: closed",
  ]);
  // Its last change was refused, then it was voided: being removed, not "couldn't remove".
  assert.deepEqual(chips({ bill: bill({ voided: true }), billRecord: sent({ status: "failed", failed_op: "change", reason: "closed" }) }), [
    "off|Being removed from QuickBooks",
  ]);
  assert.deepEqual(chips({ bill: bill({ voided: true }) }), []);
  // Turned off with things pending: it says they won't go, not that they will.
  assert.deepEqual(chips({ sending: false, billRecord: sent(), payments: [{ id: "p1", record: null }] }), [
    "good|✓ Bill in QuickBooks",
    "off|Payment not sent: sending to QuickBooks is off",
  ]);
  assert.deepEqual(chips({ sending: false, bill: bill({ voided: true }), billRecord: sent() }), ["wait|Still in QuickBooks: sending to QuickBooks is off"]);
  assert.deepEqual(chips({ sending: false, billRecord: sent({ qb_id: null, status: "waiting", reason: "x" }) }), ["off|Not sent: sending to QuickBooks is off"]);
  // Deleted in QuickBooks by someone there: no link to a bill that isn't there.
  assert.deepEqual(chips({ billRecord: sent({ status: "gone" }) }), ["off|Deleted in QuickBooks, so the CRM doesn't send it again"]);
  assert.equal(billQbChips({ sending: true, sendFrom: FROM, bill: bill(), billRecord: sent({ status: "gone" }), payments: [], day }).qbId, null);
  assert.deepEqual(chips({ billRecord: sent({ status: "waiting", reason: "inactive" }) }), ["wait|In QuickBooks; the last change waits: inactive"]);
  assert.equal(billQbChips({ sending: true, sendFrom: FROM, bill: bill(), billRecord: sent(), payments: [], day }).qbId, "108");
  assert.equal(billQbChips({ sending: true, sendFrom: FROM, bill: bill(), billRecord: sent({ status: "removed", qb_id: null }), payments: [], day }).qbId, null);
});

test("each payment row says whether it went", () => {
  assert.equal(paymentQbNote(sent({ record_type: "bill_payment" })), "in QuickBooks");
  assert.equal(paymentQbNote(sent({ record_type: "bill_payment", qb_id: null, status: "waiting", reason: "x" })), "waiting for QuickBooks: x");
  assert.equal(paymentQbNote(sent({ record_type: "bill_payment", qb_id: null, status: "failed", reason: "y" })), "didn't go to QuickBooks: y");
  assert.equal(paymentQbNote(null), null);
});

// ---------------------------------------------------------------- talking to QuickBooks

const access: QbAccess = { realmId: "9341", accessToken: "AT", apiBase: "https://sandbox-quickbooks.api.intuit.com" };
type Seen = { url: string; init: RequestInit };

test("QuickBooks' errors are read for what to do next", () => {
  const fault = (code: string, detail = "d") => ({ Fault: { Error: [{ Message: "m", Detail: detail, code }], type: "ValidationFault" } });
  assert.equal(classifyQbError(401, null).kind, "auth");
  assert.equal(classifyQbError(429, null).kind, "throttle");
  assert.equal(classifyQbError(503, null).kind, "transient");
  assert.equal(classifyQbError(400, fault("5010")).kind, "stale");
  assert.equal(classifyQbError(400, fault("610")).kind, "notfound");
  assert.equal(classifyQbError(400, fault("6240")).kind, "duplicate");
  const v = classifyQbError(400, fault("6000", "Business Validation Error: The account period has closed."));
  assert.equal(v.kind, "validation");
  assert.equal(v.message, "QuickBooks said: Business Validation Error: The account period has closed.");
});

test("a vendor is looked up by its exact name, apostrophes escaped, inactive ones too", async () => {
  assert.equal(vendorQuery("Bob's Supply"), "select * from Vendor where DisplayName = 'Bob\\'s Supply' and Active in (true, false)");
  let seen: Seen | null = null;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify({ QueryResponse: { Vendor: [{ Id: "56", DisplayName: "Bob's Supply", Active: false }] } }), { status: 200 });
  }) as unknown as typeof fetch;
  const res = await findVendor(access, "Bob's Supply", fetchImpl);
  assert.deepEqual(res, { vendor: { id: "56", active: false } });
  const url = new URL(seen!.url);
  assert.equal(url.pathname, "/v3/company/9341/query");
  assert.equal(url.searchParams.get("query"), vendorQuery("Bob's Supply"));
  assert.equal(url.searchParams.get("minorversion"), "75");
  assert.equal((seen!.init.headers as Record<string, string>).Authorization, "Bearer AT");
  assert.ok(seen!.init.signal, "every call has a time limit");
});

test("an answer that's cut off is no answer, never a refusal; an answer about another record isn't taken", async () => {
  const cut = (async () => new Response("{\"Bill\":{\"Id\"", { status: 200 })) as unknown as typeof fetch;
  const made = await createBillPayment(access, {} as never, "crm-a", cut);
  assert.ok("error" in made && made.error.kind === "transient");
  const other = (async () => new Response(JSON.stringify({ BillPayment: { Id: "999", SyncToken: "4" } }), { status: 200 })) as unknown as typeof fetch;
  const v = await voidBillPayment(access, { id: "200", syncToken: "3" }, "crm-b", other);
  assert.ok("error" in v && /different record/.test(v.error.message));
});

test("writes post JSON with the request id; a payment is voided, not deleted", async () => {
  const calls: Seen[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ BillPayment: { Id: "200", SyncToken: "1" } }), { status: 200 });
  }) as unknown as typeof fetch;
  const made = await createBillPayment(access, { TotalAmt: 1 } as never, "crm-abc", fetchImpl);
  assert.deepEqual(made, { id: "200", syncToken: "1" });
  const u = new URL(calls[0].url);
  assert.equal(u.pathname, "/v3/company/9341/billpayment");
  assert.equal(u.searchParams.get("requestid"), "crm-abc");
  assert.equal(u.searchParams.get("include"), "allowduplicatedocnum");
  assert.equal(calls[0].init.method, "POST");
  assert.equal((calls[0].init.headers as Record<string, string>)["Content-Type"], "application/json");

  await voidBillPayment(access, { id: "200", syncToken: "3" }, "crm-def", fetchImpl);
  const v = new URL(calls[1].url);
  assert.equal(v.pathname, "/v3/company/9341/billpayment");
  assert.equal(v.searchParams.get("operation"), "update");
  assert.equal(v.searchParams.get("include"), "void");
  assert.deepEqual(JSON.parse(String(calls[1].init.body)), { Id: "200", SyncToken: "3", sparse: true });
});

// ---------------------------------------------------------------- wiring

test("0222 keeps what was sent, per QuickBooks company, readable only by the cost roles", () => {
  const sql = source("../../../supabase/migrations/0222_quickbooks_bills.sql");
  assert.match(sql, /create table if not exists public\.quickbooks_sync/);
  assert.match(sql, /primary key \(company_id, realm_id, record_type, record_id\)/);
  // Not a foreign key: the record outlives a deleted payment, so its void still goes.
  assert.doesNotMatch(sql, /record_id uuid not null references/);
  assert.match(sql, /alter table public\.quickbooks_sync enable row level security;/);
  assert.match(sql, /can_manage_costs_in_company\(company_id\)/);
  assert.match(sql, /add column if not exists send_bills boolean not null default false/);
  assert.match(sql, /add column if not exists send_bills_from date/);
  assert.match(sql, /add column if not exists bills_claimed_until timestamptz/);
  assert.match(sql, /tried_hash text/);
  assert.match(sql, /doubt jsonb/);
  assert.match(sql, /'sent', 'waiting', 'failed', 'removed', 'gone'/);
  assert.match(sql, /failed_op text check \(failed_op in \('add', 'change', 'remove'\)\)/);
  assert.match(sql, /select public\.apply_billing_lock_policies\(\);/);
  assert.match(sql, /perform cron\.schedule\('crm-quickbooks-sync', '\*\/5 \* \* \* \*', \$job\$select crm_jobs\.run\('\/api\/cron\/quickbooks-sync'\)\$job\$\);/);
  assert.match(source("../backup-scope.ts"), /"quickbooks_sync"/);
  assert.match(source("../schema-drift.ts"), /0222_quickbooks_bills\.sql/);
});

test("the job runs company by company, one run at a time per company, only on its own QuickBooks company", () => {
  const route = source("../../app/api/cron/quickbooks-sync/route.ts");
  assert.match(route, /runForEachCompany\(/);
  assert.match(route, /\.eq\("send_bills", true\)/);
  const run = source("./bill-sync-run.ts");
  assert.match(run, /bills_claimed_until/);
  assert.match(run, /\.eq\("realm_id", realmId\)/);
  assert.match(run, /planBillSync\(/);
  assert.match(run, /quickBooksAccess\(/);
  // The exact request is written down before an add goes, and repeated if no answer came.
  assert.match(run, /await save\(type, id, billId, record \? \{ doubt \}/);
  assert.match(run, /case "resolve":/);
  // Every new try gets a new request id; only a lost add repeats its own.
  assert.doesNotMatch(run, /qbRequestId\(/);
  assert.match(run, /requestId: newRequestId\(\)/);
  // A failed read stops the run: never read as "nothing sent" or "everything deleted".
  assert.doesNotMatch(run, /selectAll\s*[<(]/);
  // A different QuickBooks company: sending stops until the owner picks the start date for it.
  assert.match(source("../../app/api/oauth/quickbooks/callback/route.ts"), /send_bills: false/);
  const actions = source("../actions/quickbooks.ts");
  assert.match(actions, /isCompanyLocked\(/);
  assert.match(actions, /syncCompanyBills\(/);
  assert.doesNotMatch(source("../../app/(app)/settings/quickbooks/quickbooks-view.tsx"), /token/i);
  // Bills to Pay reads the statuses as the person viewing, through row-level security.
  assert.match(source("../../app/(app)/bills/page.tsx"), /from\("quickbooks_sync"\)/);
});

// ---------------------------------------------------------------- receipts (DECISIONS #174)

const R = "receipts/lead-1/1728400000000-lumber.jpg";
const withReceipt = (over: Partial<SyncBill> = {}) => bill({ receiptPath: R, ...over });
const receiptSent = (over: Partial<SyncRecord> = {}) =>
  sent({ record_type: "receipt", record_id: "b1", bill_id: "b1", qb_id: "900", qb_hash: receiptHash(R), ...over });

test("a receipt goes as the file it is, named for its bill; kinds QuickBooks doesn't take wait, saying why", () => {
  assert.deepEqual(receiptFile(R, "Contractor Warehouse", "2026-10-07"), {
    file: { fileName: "Receipt · Contractor Warehouse · Oct 7.jpg", contentType: "image/jpeg" },
  });
  assert.deepEqual(receiptFile("receipts/x/1-scan.PDF", "ABC: Lumber", "2026-10-08"), {
    file: { fileName: "Receipt · ABC - Lumber · Oct 8.pdf", contentType: "application/pdf" },
  });
  assert.equal("file" in receiptFile("receipts/x/1-a.png", "V", "2026-10-08"), true);
  assert.equal("file" in receiptFile("receipts/x/1-a.tiff", "V", "2026-10-08"), true);
  assert.deepEqual(receiptFile("receipts/x/1-IMG_2231.heic", "V", "2026-10-08"), {
    wait: "QuickBooks doesn't take .heic photos. Attach it again as a JPG, PNG or PDF.",
  });
  assert.deepEqual(receiptFile("receipts/x/1-quote.docx", "V", "2026-10-08"), {
    wait: "QuickBooks doesn't take .docx files. Attach it again as a JPG, PNG or PDF.",
  });
  assert.deepEqual(receiptFile("receipts/x/1-noext", "V", "2026-10-08"), {
    wait: "QuickBooks doesn't take this kind of file. Attach it again as a JPG, PNG or PDF.",
  });
  assert.deepEqual(receiptFile("drive:abc", "V", "2026-10-08"), {
    wait: "This receipt is kept in Google Drive, so it can't be attached in QuickBooks. Attach the file to the bill instead.",
  });
  assert.notEqual(receiptHash(R), receiptHash("receipts/lead-1/2-new.jpg"));
});

test("a bill's receipt follows it: with a new bill, to one already there, and again when replaced", () => {
  // A new bill and its receipt, in that order.
  assert.deepEqual(ops(plan({ bills: [withReceipt()] })), ["create_bill:b1", "attach_receipt:b1"]);
  // Already in QuickBooks without it (sent before receipts went): it follows now.
  assert.deepEqual(ops(plan({ bills: [withReceipt()], records: [sent()] })), ["attach_receipt:b1"]);
  // There already: nothing.
  assert.deepEqual(ops(plan({ bills: [withReceipt()], records: [sent(), receiptSent()] })), []);
  // Replaced in the CRM: the new one goes, in place of the one the CRM attached.
  const steps = plan({ bills: [withReceipt({ receiptPath: "receipts/lead-1/2-new.jpg" })], records: [sent(), receiptSent()] });
  assert.deepEqual(ops(steps), ["attach_receipt:b1"]);
  assert.equal(steps[0].op === "attach_receipt" && steps[0].record?.qb_id, "900");
  // No receipt: nothing.
  assert.deepEqual(ops(plan({ records: [sent()] })), []);
});

test("a receipt waits for its bill, and a kind QuickBooks doesn't take waits with the reason", () => {
  // The bill can't go yet: its receipt says nothing of its own.
  assert.deepEqual(ops(plan({ bills: [withReceipt({ vendorName: "" })] })), ["wait:b1"]);
  const heic = plan({ bills: [withReceipt({ receiptPath: "receipts/x/1-IMG.heic" })], records: [sent()] });
  assert.deepEqual(ops(heic), ["wait:b1"]);
  assert.equal(heic[0].op === "wait" && heic[0].recordType, "receipt");
  // Refused by QuickBooks: rests like anything else, Send now tries it.
  const refused = receiptSent({ qb_id: null, status: "failed", failed_op: "add", tried_hash: receiptHash(R), next_try_at: "2026-10-08T16:00:00Z" });
  assert.deepEqual(ops(plan({ bills: [withReceipt()], records: [sent(), refused] })), []);
  assert.deepEqual(ops(plan({ bills: [withReceipt()], records: [sent(), refused], force: true })), ["attach_receipt:b1"]);
});

test("a voided bill's receipt comes out of QuickBooks before the bill does", () => {
  assert.deepEqual(ops(plan({ bills: [withReceipt({ voided: true })], records: [sent(), receiptSent()] })), [
    "remove_receipt:b1",
    "delete_bill:b1",
  ]);
  // Its removal refused and resting: the bill waits too.
  const resting = receiptSent({ status: "failed", failed_op: "remove", next_try_at: "2026-10-08T16:00:00Z" });
  assert.deepEqual(ops(plan({ bills: [withReceipt({ voided: true })], records: [sent(), resting] })), []);
  // A bill gone from the CRM altogether: the same.
  assert.deepEqual(ops(plan({ bills: [], records: [sent(), receiptSent()] })), ["remove_receipt:b1", "delete_bill:b1"]);
  // A receipt whose upload got no answer is settled first; nothing else happens to the bill that run.
  const doubt = receiptSent({ qb_id: null, status: "waiting", doubt: { requestId: "crm-x", body: {}, hash: "h" } });
  assert.deepEqual(ops(plan({ bills: [withReceipt({ voided: true })], records: [sent(), doubt] })), ["resolve:b1"]);
  // A bill deleted in QuickBooks by someone there: its receipt is left alone too.
  assert.deepEqual(ops(plan({ bills: [withReceipt()], records: [sent({ status: "gone" })] })), []);
  assert.deepEqual(ops(plan({ bills: [withReceipt()], records: [sent({ status: "gone" }), receiptSent()] })), []);
  // ...and one that never got there is forgotten, not left "didn't go" for good.
  const stuck = receiptSent({ qb_id: null, status: "failed", failed_op: "add", reason: "QuickBooks said: Bill not found" });
  assert.deepEqual(ops(plan({ bills: [withReceipt()], records: [sent({ status: "gone" }), stuck] })), ["drop:b1"]);
  // ...and one still there but with a change pending is left as QuickBooks has it, nothing pending.
  const pending = receiptSent({ status: "waiting", reason: "QuickBooks doesn't take .heic photos. Attach it again as a JPG, PNG or PDF." });
  assert.deepEqual(ops(plan({ bills: [withReceipt({ receiptPath: "receipts/x/2-new.jpg" })], records: [sent({ status: "gone" }), pending] })), ["settle:b1"]);
});

test("Bills to Pay says whether the receipt went too", () => {
  const receipt = (record: SyncRecord | null) => ({ has: true, record });
  const c = (p: Partial<Parameters<typeof billQbChips>[0]>) =>
    billQbChips({ sending: true, sendFrom: FROM, bill: bill(), billRecord: sent(), payments: [], day, ...p }).chips.map((x) => `${x.tone}|${x.text}`);
  assert.deepEqual(c({ receipt: receipt(receiptSent()) }), ["good|✓ In QuickBooks · Bill and receipt · 10-08"]);
  assert.deepEqual(c({ receipt: receipt(receiptSent()), payments: [{ id: "p1", record: sent({ record_type: "bill_payment", record_id: "p1" }) }] }), [
    "good|✓ In QuickBooks · Bill, payment and receipt · 10-08",
  ]);
  assert.deepEqual(
    c({
      receipt: receipt(receiptSent()),
      payments: [
        { id: "p1", record: sent({ record_type: "bill_payment", record_id: "p1" }) },
        { id: "p2", record: sent({ record_type: "bill_payment", record_id: "p2" }) },
      ],
    }),
    ["good|✓ In QuickBooks · Bill, 2 payments and receipt · 10-08"]
  );
  assert.deepEqual(c({ receipt: receipt(null) }), ["good|✓ Bill in QuickBooks", "off|Receipt goes in a few minutes"]);
  assert.deepEqual(c({ receipt: receipt(receiptSent({ qb_id: null, status: "waiting", reason: "QuickBooks doesn't take .heic files." })) }), [
    "good|✓ Bill in QuickBooks",
    "wait|Receipt waiting: QuickBooks doesn't take .heic files.",
  ]);
  assert.deepEqual(c({ receipt: receipt(receiptSent({ status: "failed", failed_op: "add", reason: "no" })) }), [
    "good|✓ Bill in QuickBooks",
    "bad|Receipt didn't go: no",
  ]);
  assert.deepEqual(c({ sending: false, receipt: receipt(null) }), ["good|✓ Bill in QuickBooks", "off|Receipt not sent: sending to QuickBooks is off"]);
  // No receipt on the bill: as before.
  assert.deepEqual(c({ receipt: { has: false, record: null } }), ["good|✓ In QuickBooks · Bill · 10-08"]);
  // Voided, but QuickBooks won't let its receipt (or a payment's void) go first: it says so, not "being removed".
  const voided = bill({ voided: true });
  const stuckReceipt = receiptSent({ status: "failed", failed_op: "remove", reason: "Couldn't remove it in QuickBooks. QuickBooks said: Closed period" });
  assert.deepEqual(c({ bill: voided, related: [stuckReceipt] }), [
    "bad|Couldn't remove from QuickBooks: its receipt can't be taken off first. QuickBooks said: Closed period",
  ]);
  const stuckPay = sent({ record_type: "bill_payment", record_id: "p9", status: "failed", failed_op: "remove", reason: "Couldn't void it in QuickBooks. QuickBooks said: no" });
  assert.deepEqual(c({ bill: voided, related: [stuckPay] }), ["bad|Couldn't remove from QuickBooks: a payment on it can't be taken off first. QuickBooks said: no"]);
  assert.deepEqual(c({ bill: voided, related: [receiptSent()] }), ["off|Being removed from QuickBooks"]);
  // Its receipt's upload got no answer and QuickBooks won't say whether it has it.
  const unsure = receiptSent({ qb_id: null, status: "waiting", reason: "Couldn't check whether QuickBooks got it. QuickBooks said: Forbidden" });
  assert.deepEqual(c({ bill: voided, related: [unsure] }), [
    "bad|Couldn't remove from QuickBooks yet: its receipt may be on it, and QuickBooks won't say. QuickBooks said: Forbidden",
  ]);
});

test("a receipt is uploaded to the bill as a Receipt, with a note to find it by if the answer is lost", async () => {
  let seen: Seen | null = null;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify({ AttachableResponse: [{ Attachable: { Id: "5000", SyncToken: "0" } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const bytes = new Uint8Array([1, 2, 3]);
  const res = await uploadReceipt(
    access,
    { billQbId: "108", fileName: "Receipt · V · Oct 7.jpg", contentType: "image/jpeg", note: "From the CRM · ref abc", bytes },
    fetchImpl
  );
  assert.deepEqual(res, { id: "5000", syncToken: "0" });
  const u = new URL(seen!.url);
  assert.equal(u.pathname, "/v3/company/9341/upload");
  assert.equal(u.searchParams.get("minorversion"), "75");
  const form = seen!.init.body as FormData;
  const meta = JSON.parse(await (form.get("file_metadata_01") as Blob).text());
  assert.deepEqual(meta, {
    AttachableRef: [{ EntityRef: { type: "Bill", value: "108" } }],
    FileName: "Receipt · V · Oct 7.jpg",
    ContentType: "image/jpeg",
    Category: "Receipt",
    Note: "From the CRM · ref abc",
  });
  const file = form.get("file_content_01") as File;
  assert.equal(file.type, "image/jpeg");
  assert.equal(file.size, 3);
  // The form sets its own boundary: no JSON content type on an upload.
  assert.equal((seen!.init.headers as Record<string, string>)["Content-Type"], undefined);

  // A refusal inside the answer is a refusal.
  const refusing = (async () =>
    new Response(JSON.stringify({ AttachableResponse: [{ Fault: { Error: [{ Message: "m", Detail: "Bad file", code: "6000" }] } }] }), {
      status: 200,
    })) as unknown as typeof fetch;
  const no = await uploadReceipt(access, { billQbId: "108", fileName: "a.jpg", contentType: "image/jpeg", note: "n", bytes }, refusing);
  assert.ok("error" in no && no.error.kind === "validation" && /Bad file/.test(no.error.message));

  assert.equal(attachableNoteQuery("From the CRM · ref abc"), "select * from Attachable where Note = 'From the CRM · ref abc'");
  assert.equal(
    attachableBillQuery("108"),
    "select * from Attachable where AttachableRef.EntityRef.Type = 'Bill' and AttachableRef.EntityRef.value = '108'"
  );
});

test("a lost upload is looked for by its note, else among the bill's attachments; a failed look is never 'not there'", async () => {
  const answer = (rows: unknown[]) => new Response(JSON.stringify({ QueryResponse: rows.length ? { Attachable: rows } : {} }), { status: 200 });
  const refused = () => new Response(JSON.stringify({ Fault: { Error: [{ Message: "m", Detail: "QueryParserError", code: "4000" }] } }), { status: 400 });
  const queries: string[] = [];
  const looks = (byNote: () => Response, byBill: () => Response) =>
    (async (url: string) => {
      const q = new URL(url).searchParams.get("query")!;
      queries.push(q);
      return /Note =/.test(q) ? byNote() : byBill();
    }) as unknown as typeof fetch;
  const n = { note: "From the CRM, ref crm-1", billQbId: "108" };
  assert.deepEqual(await findAttachableByNote(access, n, looks(() => answer([{ Id: "5000", Note: n.note }]), refused)), { attachable: { id: "5000" } });
  assert.deepEqual(await findAttachableByNote(access, n, looks(() => answer([]), refused)), { attachable: null });
  // QuickBooks won't look by note: the bill's attachments, matched by note.
  queries.length = 0;
  const onBill = await findAttachableByNote(access, n, looks(refused, () => answer([{ Id: "777", Note: "bookkeeper" }, { Id: "5001", Note: n.note }])));
  assert.deepEqual(onBill, { attachable: { id: "5001" } });
  assert.equal(queries.length, 2);
  // Neither works: an error, so the receipt stays in doubt.
  const neither = await findAttachableByNote(access, n, looks(refused, refused));
  assert.ok("error" in neither);
});

test("removing a receipt sends back the attachment as QuickBooks has it, as its delete asks", async () => {
  let seen: Seen | null = null;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify({ Attachable: { Id: "5000", status: "Deleted" } }), { status: 200 });
  }) as unknown as typeof fetch;
  const current = { Id: "5000", SyncToken: "1", FileName: "a.jpg", AttachableRef: [{ EntityRef: { type: "Bill", value: "108" } }] };
  const res = await deleteAttachable(access, current, "crm-z", fetchImpl);
  assert.deepEqual(res, { id: "5000", syncToken: "1" });
  const u = new URL(seen!.url);
  assert.equal(u.pathname, "/v3/company/9341/attachable");
  assert.equal(u.searchParams.get("operation"), "delete");
  assert.deepEqual(JSON.parse(String(seen!.init.body)), current);
});

test("0223 lets receipts be recorded; the job keeps going on a database without it", () => {
  const sql = source("../../../supabase/migrations/0223_quickbooks_receipts.sql");
  assert.match(sql, /drop constraint if exists quickbooks_sync_record_type_check/);
  assert.match(sql, /check \(record_type in \('bill', 'bill_payment', 'receipt'\)\)/);
  const run = source("./bill-sync-run.ts");
  assert.match(run, /storage\.from\(RECEIPT_BUCKET\)\.download\(/);
  assert.match(run, /quickbooks_sync_record_type_check/);
  // Written down before it's uploaded, like every add.
  assert.match(run, /case "attach_receipt":/);
  assert.match(run, /attachableNoteQuery|findAttachableByNote/);
  // The download is cut off with the run, like a QuickBooks call.
  assert.match(run, /\.download\(path, \{\}, \{ signal \}\)/);
});

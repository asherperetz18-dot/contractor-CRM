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
  nextTryAt,
  paymentHash,
  paymentQbNote,
  planBillSync,
  qbCreateRequestId,
  qbRequestId,
  qbText,
  qbVendorName,
  qbWebUrl,
  type SyncBill,
  type SyncPayment,
  type SyncRecord,
} from "./bill-sync.ts";
import {
  classifyQbError,
  createBillPayment,
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
  ...over,
});

const card = { id: "pa1", name: "Amex", kind: "credit_card", qbAccountId: "41" };
const bank = { id: "pa2", name: "Chase Checking", kind: "bank", qbAccountId: "35" };

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
  status: "sent",
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
  // No due date in the CRM: QuickBooks uses its own terms.
  assert.equal("DueDate" in billBody(bill({ dueDate: null }), { vendorId: "56", accountId: "60" }), false);
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

  const zelle = billPaymentBody(payment({ method: "zelle", account: { ...bank, kind: "cash" } }), { vendorId: "56", billQbId: "108" });
  assert.equal(zelle.PayType, "Check");
  assert.deepEqual(zelle.CheckPayment, { BankAccountRef: { value: "35" }, PrintStatus: "NotSet" });
  assert.equal("DocNumber" in zelle, false);
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
    reason(plan({ records: [sent()], payments: [payment({ account: { ...card, name: "Home Depot card", qbAccountId: null } })] }), "p1"),
    '"Home Depot card" isn\'t matched to a QuickBooks account yet. Match it in Settings › QuickBooks.'
  );
  // Its bill can't go yet, so neither can the payment.
  assert.equal(reason(plan({ bills: [bill({ vendorName: "" })], payments: [payment()] }), "p1"), "Waits for its bill to go to QuickBooks first.");
  // More paid than the bill: the payment that goes over waits.
  const over = plan({ records: [sent()], payments: [payment({ amountCents: 300000 }), payment({ id: "p2", paidOn: "2026-10-09", amountCents: 50000 })] });
  assert.equal(reason(over, "p1"), "create_payment");
  assert.equal(reason(over, "p2"), "This payment is more than what's left on the bill.");
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
  const failed = sent({ qb_id: null, status: "failed", reason: "QuickBooks said: no", tries: 1, next_try_at: "2026-10-08T16:00:00Z" });
  assert.deepEqual(ops(plan({ records: [failed] })), []);
  assert.deepEqual(ops(plan({ records: [failed], now: new Date("2026-10-08T16:01:00Z") })), ["create_bill:b1"]);
  assert.deepEqual(ops(plan({ records: [failed], bills: [bill({ amountCents: 1 })] })), ["create_bill:b1"]);
  // Send now tries everything.
  assert.deepEqual(ops(plan({ records: [failed], force: true })), ["create_bill:b1"]);
  // ...and its payments wait meanwhile, without asking QuickBooks.
  const s = plan({ records: [failed], payments: [payment()] });
  assert.deepEqual(ops(s), ["wait:p1"]);
});

test("tries back off: 15 minutes, then an hour, four, twelve, a day", () => {
  assert.deepEqual(BACKOFF_MINUTES, [15, 60, 240, 720, 1440]);
  assert.equal(nextTryAt(1, NOW), "2026-10-08T15:15:00.000Z");
  assert.equal(nextTryAt(2, NOW), "2026-10-08T16:00:00.000Z");
  assert.equal(nextTryAt(9, NOW), "2026-10-09T15:00:00.000Z");
});

test("a wait already noted isn't written again every run", () => {
  const waiting = sent({ qb_id: null, status: "waiting", reason: "This bill has no vendor.", qb_hash: billHash(bill({ vendorName: "" })) });
  assert.deepEqual(ops(plan({ bills: [bill({ vendorName: "" })], records: [waiting] })), []);
});

test("each write carries a request id QuickBooks uses to ignore a repeat; a new try gets a new one", () => {
  const a = qbRequestId(["c1", "r1", "bill", "b1", "create", "h", 0]);
  assert.equal(a, qbRequestId(["c1", "r1", "bill", "b1", "create", "h", 0]));
  assert.notEqual(a, qbRequestId(["c1", "r1", "bill", "b1", "create", "h", 1]));
  assert.ok(a.length <= 50);
  assert.match(a, /^crm-[0-9a-f]{40}$/);
  assert.notEqual(paymentHash(payment()), paymentHash(payment({ amountCents: 1 })));
});

test("adding a bill again after it was removed is a new request, not the first one repeated", () => {
  const scope = { companyId: "c1", realmId: "r1" };
  const first = qbCreateRequestId(scope, "bill", "b1", "h", null);
  // Cut off after QuickBooks saved it, before the CRM wrote it down: the same request.
  assert.equal(qbCreateRequestId(scope, "bill", "b1", "h", sent({ qb_id: null, status: "waiting", sent_at: null })), first);
  // Refused, then tried again: a new one.
  assert.notEqual(qbCreateRequestId(scope, "bill", "b1", "h", sent({ qb_id: null, status: "failed", tries: 1, sent_at: null })), first);
  // Voided, deleted in QuickBooks, un-voided: a new one, or QuickBooks answers with the deleted bill.
  assert.notEqual(qbCreateRequestId(scope, "bill", "b1", "h", sent({ qb_id: null, status: "removed" })), first);
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
  assert.deepEqual(chips({ bill: bill({ voided: true }) }), []);
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
  // A different QuickBooks company: sending stops until the owner picks the start date for it.
  assert.match(source("../../app/api/oauth/quickbooks/callback/route.ts"), /send_bills: false/);
  const actions = source("../actions/quickbooks.ts");
  assert.match(actions, /isCompanyLocked\(/);
  assert.match(actions, /syncCompanyBills\(/);
  assert.doesNotMatch(source("../../app/(app)/settings/quickbooks/quickbooks-view.tsx"), /token/i);
  // Bills to Pay reads the statuses as the person viewing, through row-level security.
  assert.match(source("../../app/(app)/bills/page.tsx"), /from\("quickbooks_sync"\)/);
});

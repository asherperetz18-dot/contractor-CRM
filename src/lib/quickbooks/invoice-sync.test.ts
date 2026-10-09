import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CHANGED_SINCE,
  SALES_WAIT,
  customerBody,
  customerName,
  invoiceBody,
  invoiceHash,
  jobBody,
  jobName,
  creditMemoBody,
  creditLinkBody,
  customerPaymentBody,
  paymentHash,
  planSalesSync,
  qbDocNumber,
  refundReceiptBody,
  qbPaymentMethodName,
  type SalesSettings,
  type SalesStep,
  type SyncCredit,
  type SyncDoc,
  type SyncLead,
  type SyncLine,
  type SyncMoney,
  type SyncStage,
} from "./invoice-sync.ts";
import { creditChipRecord, invoiceQbChips } from "./invoice-status.ts";
import type { SyncRecord } from "./bill-status.ts";
import {
  attachableNoteQuery,
  customerQuery,
  findCustomer,
  paymentMethodQuery,
  readPreferences,
  voidInvoice,
} from "./api.ts";

const source = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const access = { realmId: "9341", accessToken: "AT", apiBase: "https://qb.test" };
type Seen = { url: string; init: RequestInit };

// ---------------------------------------------------------------- fixtures (demo data)

const FROM = "2026-10-01";
const day = (iso: string) => iso.slice(0, 10);

const lead = (over: Partial<SyncLead> = {}): SyncLead => ({
  id: "L1",
  contactType: "Person",
  companyName: null,
  firstName: "Maria",
  lastName: "Lopez",
  email: "maria.lopez@example.com",
  phone: "(555) 555-0142",
  address: "418 Alder Way, Pasadena, CA 91101",
  zip: null,
  outside: false,
  ...over,
});

const contract = (over: Partial<SyncDoc> = {}): SyncDoc => ({
  id: "C1",
  leadId: "L1",
  kind: "contract",
  status: "Signed",
  docNumber: "EST-1047",
  title: "Kitchen remodel",
  parentId: null,
  signedAt: "2026-10-01T18:00:00Z",
  issuedAt: null,
  taxCents: 0,
  totalCents: 2_850_000,
  depositCents: 100_000,
  jobAddress: "418 Alder Way, Pasadena, CA 91101",
  customerMessage: null,
  ...over,
});

const stage = (over: Partial<SyncStage> = {}): SyncStage => ({
  id: "S1",
  docId: "C1",
  sortOrder: 0,
  name: "Rough-in",
  description: "At completion of rough-in",
  amountCents: 900_000,
  requestedAt: "2026-10-05T17:00:00Z",
  dueDate: "2026-10-12",
  cancelledAt: null,
  ...over,
});

const money = (over: Partial<SyncMoney> = {}): SyncMoney => ({
  id: "P1",
  docId: "C1",
  stageId: "S1",
  amountCents: 900_000,
  status: "succeeded",
  method: "check",
  reference: "2087",
  note: null,
  paidAt: "2026-10-07T19:00:00Z",
  source: "manual",
  refundOf: null,
  stillOwed: null,
  unfinished: false,
  ...over,
});

const credit = (over: Partial<SyncCredit> = {}): SyncCredit => ({
  id: "K1",
  docId: "I1",
  stageId: "IS1",
  amountCents: 15_000,
  reason: "Outlet trim delayed a week",
  createdAt: "2026-10-07T20:00:00Z",
  removed: false,
  fromRefund: false,
  ...over,
});

const inv = (over: Partial<SyncDoc> = {}): SyncDoc =>
  contract({
    id: "I1",
    kind: "invoice",
    docNumber: "INV-1004",
    title: "Extra outlets and permit",
    parentId: "C1",
    signedAt: "2026-10-06T16:00:00Z",
    issuedAt: "2026-10-06T16:00:00Z",
    totalCents: 86_700,
    depositCents: 0,
    customerMessage: "Thanks for the extra work!",
    ...over,
  });
const invStage = (over: Partial<SyncStage> = {}) =>
  stage({ id: "IS1", docId: "I1", name: "Extra outlets and permit", description: null, amountCents: 86_700, requestedAt: "2026-10-06T16:00:00Z", dueDate: "2026-10-21", ...over });
const invLines: SyncLine[] = [
  { docId: "I1", sortOrder: 0, name: "Add outlet", description: null, qty: 3, unitCents: 18_500, totalCents: 55_500, cost: false },
  { docId: "I1", sortOrder: 1, name: "Electrical permit", description: "City of Pasadena", qty: 1, unitCents: 31_200, totalCents: 31_200, cost: true },
];

const rec = (over: Partial<SyncRecord>): SyncRecord => ({
  record_type: "invoice",
  record_id: "S1",
  bill_id: "S1",
  qb_id: "500",
  qb_hash: null,
  tried_hash: null,
  doubt: null,
  status: "sent",
  failed_op: null,
  reason: null,
  tries: 0,
  next_try_at: null,
  sent_at: "2026-10-07T20:00:00Z",
  ...over,
});

const SETTINGS: SalesSettings = {
  jobItem: "1",
  depositItem: null,
  costItem: null,
  paymentsAccount: null,
  stripeRefundsAccount: null,
  handRefundsAccount: "35",
  sendOutside: false,
};
const PREFS = { customNumbers: true, autoApplyCredit: false, salesTax: true, bookCloseDate: null as string | null };

function plan(p: {
  leads?: SyncLead[];
  docs?: SyncDoc[];
  stages?: SyncStage[];
  lines?: SyncLine[];
  money?: SyncMoney[];
  credits?: SyncCredit[];
  records?: SyncRecord[];
  settings?: Partial<typeof SETTINGS>;
  prefs?: Partial<typeof PREFS>;
  force?: boolean;
  billLinks?: { leadId: string; contractId: string | null }[];
}): SalesStep[] {
  return planSalesSync({
    leads: p.leads ?? [lead()],
    docs: p.docs ?? [contract({ depositCents: 0 })],
    stages: p.stages ?? [],
    lines: p.lines ?? [],
    money: p.money ?? [],
    credits: p.credits ?? [],
    records: p.records ?? [],
    sendFrom: FROM,
    now: new Date("2026-10-08T12:00:00Z"),
    day,
    settings: { ...SETTINGS, ...p.settings },
    prefs: { ...PREFS, ...p.prefs },
    force: p.force,
    billLinks: p.billLinks ?? [],
  });
}

const ops = (steps: SalesStep[]) =>
  steps.map((s) => {
    switch (s.op) {
      case "resolve":
        return `resolve:${s.record.record_type}:${s.record.record_id}`;
      case "create_invoice":
      case "update_invoice":
      case "recheck_invoice":
        return `${s.op}:${s.spec.key.type}:${s.spec.key.id}`;
      case "void_invoice":
      case "delete_invoice":
        return `${s.op}:${s.recordType}:${s.recordId}`;
      case "create_payment":
      case "update_payment":
        return `${s.op}:${s.money.id}`;
      case "void_payment":
      case "delete_refund":
        return `${s.op}:${s.record.record_id}`;
      case "create_credit":
      case "link_credit":
        return `${s.op}:${s.credit.id}`;
      case "remove_credit":
        return `remove_credit:${s.recordId}`;
      case "create_refund":
        return `create_refund:${s.money.id}`;
      case "ensure_customer":
        return `ensure_customer:${s.leadId}`;
      case "ensure_job":
        return `ensure_job:${s.contractId}`;
      case "wait":
        return `wait:${s.recordType}:${s.recordId}`;
      case "drop":
        return `drop:${s.recordType}:${s.recordId}`;
      case "settle":
        return `settle:${s.recordType}:${s.recordId}`;
      case "unneeded":
        return `unneeded:${s.recordType}:${s.recordId}`;
    }
  });

const find = <T extends SalesStep["op"]>(steps: SalesStep[], op: T) => steps.find((s) => s.op === op) as SalesStep & { op: T };

// ---------------------------------------------------------------- customers and jobs

test("a customer goes by the name the CRM shows; a company by its company name, the person as its contact", () => {
  assert.equal(customerName(lead()), "Maria Lopez");
  assert.equal(customerName(lead({ contactType: "Company", companyName: "Ridgeway Property Group", firstName: "Sam", lastName: "Ortiz" })), "Ridgeway Property Group");
  assert.equal(customerName(lead({ firstName: "Ana: B", lastName: "Ruiz" })), "Ana - B Ruiz");
  assert.equal(customerName(lead({ firstName: "", lastName: "" })), "");
  assert.deepEqual(customerBody(lead()), {
    DisplayName: "Maria Lopez",
    GivenName: "Maria",
    FamilyName: "Lopez",
    PrimaryEmailAddr: { Address: "maria.lopez@example.com" },
    PrimaryPhone: { FreeFormNumber: "(555) 555-0142" },
    BillAddr: { Line1: "418 Alder Way", City: "Pasadena", CountrySubDivisionCode: "CA", PostalCode: "91101" },
  });
  const co = customerBody(lead({ contactType: "Company", companyName: "Ridgeway Property Group", firstName: "Sam", lastName: "Ortiz", email: "not an email", address: "somewhere", zip: "90001" }));
  assert.deepEqual(co, {
    DisplayName: "Ridgeway Property Group",
    CompanyName: "Ridgeway Property Group",
    GivenName: "Sam",
    FamilyName: "Ortiz",
    PrimaryPhone: { FreeFormNumber: "(555) 555-0142" },
    BillAddr: { Line1: "somewhere", PostalCode: "90001" },
  });
});

test("each signed contract is a job under its customer, named by its number and title", () => {
  assert.equal(jobName(contract()), "EST-1047 Kitchen remodel");
  assert.equal(jobName(contract({ title: null })), "EST-1047");
  assert.deepEqual(jobBody(contract(), "77"), {
    DisplayName: "EST-1047 Kitchen remodel",
    Job: true,
    ParentRef: { value: "77" },
    BillWithParent: true,
    ShipAddr: { Line1: "418 Alder Way", City: "Pasadena", CountrySubDivisionCode: "CA", PostalCode: "91101" },
  });
});

// ---------------------------------------------------------------- what goes

test("a billed stage goes as an invoice numbered from its contract, with the job in the memo; drafts and unbilled stages don't", () => {
  const steps = plan({ stages: [stage(), stage({ id: "S2", sortOrder: 1, name: "Cabinets and counters", requestedAt: null, dueDate: null }), stage({ id: "S3", sortOrder: 2, name: "Completion", requestedAt: null, dueDate: null })] });
  assert.deepEqual(ops(steps), ["create_invoice:invoice:S1"]);
  const spec = find(steps, "create_invoice").spec;
  assert.equal(spec.leadId, "L1");
  assert.equal(spec.contractId, "C1");
  assert.equal(spec.docNumber, "EST-1047-1");
  assert.equal(spec.txnDay, "2026-10-05");
  assert.equal(spec.dueDay, "2026-10-12");
  assert.equal(spec.amountCents, 900_000);
  assert.deepEqual(spec.lines, [{ item: "job", description: "Rough-in: At completion of rough-in", qty: null, unitCents: null, amountCents: 900_000 }]);
  assert.equal(spec.privateNote, "From the CRM · EST-1047 · Stage 1 of 3");
  assert.equal(spec.shipTo, "418 Alder Way, Pasadena, CA 91101");
  // A draft invoice never goes.
  assert.deepEqual(ops(plan({ docs: [contract({ depositCents: 0 }), inv({ status: "Draft", issuedAt: null })], stages: [invStage({ requestedAt: null })] })), []);
});

test("an issued invoice goes line by line, costs billed back on their own product, its message to the customer kept", () => {
  const steps = plan({ docs: [contract({ depositCents: 0 }), inv()], stages: [invStage()], lines: invLines });
  assert.deepEqual(ops(steps), ["create_invoice:invoice:IS1"]);
  const spec = find(steps, "create_invoice").spec;
  assert.equal(spec.docNumber, "INV-1004");
  assert.equal(spec.contractId, "C1", "an invoice for a contract goes on its job");
  assert.equal(spec.txnDay, "2026-10-06");
  assert.deepEqual(spec.lines, [
    { item: "job", description: "Add outlet", qty: 3, unitCents: 18_500, amountCents: 55_500 },
    { item: "cost", description: "Electrical permit - City of Pasadena", qty: 1, unitCents: 31_200, amountCents: 31_200 },
  ]);
  assert.equal(spec.customerMemo, "Thanks for the extra work!");
  assert.equal(spec.privateNote, "From the CRM · INV-1004 · for EST-1047");
  // Not for a contract: on the customer itself.
  const alone = find(plan({ docs: [inv({ parentId: null })], stages: [invStage()], lines: invLines }), "create_invoice").spec;
  assert.equal(alone.contractId, null);
});

test("a signed contract's deposit goes as its own invoice, dated the day it was signed", () => {
  const steps = plan({ docs: [contract()] });
  assert.deepEqual(ops(steps), ["create_invoice:deposit:C1"]);
  const spec = find(steps, "create_invoice").spec;
  assert.equal(spec.docNumber, "EST-1047-D");
  assert.equal(spec.txnDay, "2026-10-01");
  assert.equal(spec.dueDay, "2026-10-01");
  assert.deepEqual(spec.lines, [{ item: "deposit", description: "Deposit, EST-1047 Kitchen remodel", qty: null, unitCents: null, amountCents: 100_000 }]);
  assert.equal(spec.privateNote, "From the CRM · EST-1047 · Deposit");
  // No deposit, or not signed: nothing.
  assert.deepEqual(ops(plan({ docs: [contract({ depositCents: 0 })] })), []);
  assert.deepEqual(ops(plan({ docs: [contract({ status: "Sent" })] })), []);
});

test("custom transaction numbers off: QuickBooks numbers them and the CRM's number is in the memo", () => {
  const spec = find(plan({ stages: [stage()], prefs: { customNumbers: false } }), "create_invoice").spec;
  assert.equal(spec.docNumber, null);
  assert.equal(spec.privateNote, "From the CRM · EST-1047 · Stage 1 of 1");
});

test("the start date: older bills stay out, and so do their payments; one already sent keeps following", () => {
  const old = stage({ requestedAt: "2026-09-28T17:00:00Z", dueDate: "2026-10-05" });
  assert.deepEqual(ops(plan({ stages: [old], money: [money()] })), []);
  // Already sent before the date moved: its payment still goes.
  const sent = rec({ qb_hash: null });
  const steps = plan({ stages: [old], money: [money()], records: [{ ...sent, qb_hash: invoiceHash(find(plan({ stages: [stage({ requestedAt: "2026-10-05T17:00:00Z" })] }), "create_invoice").spec) }] });
  assert.ok(ops(steps).includes("create_payment:P1"));
});

// ---------------------------------------------------------------- what waits

test("a bill with sales tax waits, and so do its payments", () => {
  const steps = plan({ docs: [contract({ depositCents: 0, taxCents: 17_400 })], stages: [stage()], money: [money()] });
  assert.deepEqual(ops(steps), ["wait:invoice:S1", "wait:customer_payment:P1"]);
  const w = steps.filter((s) => s.op === "wait") as Extract<SalesStep, { op: "wait" }>[];
  assert.equal(w[0].reason, SALES_WAIT.taxed);
  assert.equal(w[0].reason, "This bill includes sales tax. The CRM doesn't send taxed bills to QuickBooks yet, so enter it there by hand.");
  assert.equal(w[1].reason, SALES_WAIT.taxedChild);
});

test("no product or service picked: invoices wait, saying where to pick one", () => {
  const steps = plan({ stages: [stage()], settings: { jobItem: null } });
  assert.deepEqual(ops(steps), ["wait:invoice:S1"]);
  assert.equal((steps[0] as Extract<SalesStep, { op: "wait" }>).reason, "No QuickBooks product or service for job work yet. Pick one in Settings › QuickBooks.");
});

test("customers invoiced outside the CRM are left out, unless the company sends them too", () => {
  const out = lead({ outside: true });
  assert.deepEqual(ops(plan({ leads: [out], docs: [contract()], stages: [stage()], money: [money()] })), []);
  assert.deepEqual(ops(plan({ leads: [out], docs: [contract()], stages: [stage()], settings: { sendOutside: true } })), [
    "create_invoice:deposit:C1",
    "create_invoice:invoice:S1",
  ]);
});

test("books closed in QuickBooks: a bill dated in a closed month waits with the date, to be entered there by hand", () => {
  const steps = plan({ stages: [stage()], prefs: { bookCloseDate: "2026-10-31" } });
  assert.deepEqual(ops(steps), ["wait:invoice:S1"]);
  assert.equal((steps[0] as Extract<SalesStep, { op: "wait" }>).reason, "QuickBooks' books are closed through Oct 31, 2026, so this isn't sent. Ask whoever keeps the books to enter it there by hand.");
});

// ---------------------------------------------------------------- payments

test("a payment that has arrived goes on its own invoice, after it; money still clearing waits", () => {
  const steps = plan({ stages: [stage()], money: [money()] });
  assert.deepEqual(ops(steps), ["create_invoice:invoice:S1", "create_payment:P1"]);
  const pay = find(steps, "create_payment");
  assert.deepEqual(pay.invoice, { type: "invoice", id: "S1" });
  // Clearing.
  const clearing = plan({ stages: [stage()], money: [money({ status: "pending", paidAt: null })] });
  assert.deepEqual(ops(clearing), ["create_invoice:invoice:S1", "wait:customer_payment:P1"]);
  assert.equal((clearing[1] as Extract<SalesStep, { op: "wait" }>).reason, "Goes when the money clears.");
  // A checkout the customer left, or a failed payment: nothing.
  assert.deepEqual(ops(plan({ stages: [stage()], money: [money({ status: "pending", unfinished: true }), money({ id: "P2", status: "failed" })] })), ["create_invoice:invoice:S1"]);
});

test("a deposit payment lands on the deposit invoice; one with nowhere to land waits", () => {
  const steps = plan({ docs: [contract()], money: [money({ stageId: null, amountCents: 100_000, paidAt: "2026-10-01T19:00:00Z", method: "card", source: "stripe", reference: null })] });
  assert.deepEqual(ops(steps), ["create_invoice:deposit:C1", "create_payment:P1"]);
  assert.deepEqual(find(steps, "create_payment").invoice, { type: "deposit", id: "C1" });
  const nowhere = plan({ docs: [contract({ depositCents: 0 })], money: [money({ stageId: null })] });
  assert.deepEqual(ops(nowhere), ["wait:customer_payment:P1"]);
  assert.equal((nowhere[0] as Extract<SalesStep, { op: "wait" }>).reason, "This payment isn't on a stage, and the contract has no deposit. Delete it and record it again on the stage it pays.");
  // On an invoice, a payment with no stage is the invoice's own.
  const onInv = plan({ docs: [inv({ parentId: null })], stages: [invStage()], lines: invLines, money: [money({ docId: "I1", stageId: null, amountCents: 86_700 })] });
  assert.deepEqual(find(onInv, "create_payment").invoice, { type: "invoice", id: "IS1" });
});

test("money on a stage that isn't billed yet: the stage goes, dated the day the money came, paid before it was billed", () => {
  const unbilled = stage({ requestedAt: null, dueDate: null });
  const steps = plan({ stages: [unbilled], money: [money({ method: "financing", reference: "LN-5521", paidAt: "2026-10-03T19:00:00Z" })] });
  assert.deepEqual(ops(steps), ["create_invoice:invoice:S1", "create_payment:P1"]);
  const spec = find(steps, "create_invoice").spec;
  assert.equal(spec.txnDay, "2026-10-03");
  assert.equal(spec.dueDay, "2026-10-03");
  assert.equal(spec.privateNote, "From the CRM · EST-1047 · Stage 1 of 1 · Paid before it was billed");
});

test("a payment bigger than what's left on its bill waits; payments already in QuickBooks count first", () => {
  const spec = find(plan({ stages: [stage()] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  const p1 = money({ amountCents: 600_000 });
  const p1Rec = rec({ record_type: "customer_payment", record_id: "P1", bill_id: "S1", qb_id: "600", qb_hash: paymentHash(p1, { type: "invoice", id: "S1" }, day(p1.paidAt ?? "")) });
  const p2 = money({ id: "P2", amountCents: 400_000, paidAt: "2026-10-06T19:00:00Z" });
  const steps = plan({ stages: [stage()], money: [p1, p2], records: [invRec, p1Rec] });
  assert.deepEqual(ops(steps), ["wait:customer_payment:P2"]);
  assert.equal((steps[0] as Extract<SalesStep, { op: "wait" }>).reason, SALES_WAIT.overpaid);
});

test("an edited payment is updated in QuickBooks; a deleted one is voided; one never sent is forgotten", () => {
  const spec = find(plan({ stages: [stage()] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  const p1 = money();
  const p1Rec = rec({ record_type: "customer_payment", record_id: "P1", bill_id: "S1", qb_id: "600", qb_hash: paymentHash(p1, { type: "invoice", id: "S1" }, day(p1.paidAt ?? "")) });
  assert.deepEqual(ops(plan({ stages: [stage()], money: [p1], records: [invRec, p1Rec] })), []);
  assert.deepEqual(ops(plan({ stages: [stage()], money: [money({ amountCents: 850_000 })], records: [invRec, p1Rec] })), ["update_payment:P1"]);
  assert.deepEqual(ops(plan({ stages: [stage()], money: [], records: [invRec, p1Rec] })), ["void_payment:P1"]);
  const waiting = rec({ record_type: "customer_payment", record_id: "P9", bill_id: "S1", qb_id: null, status: "waiting" });
  assert.deepEqual(ops(plan({ stages: [stage()], money: [], records: [invRec, waiting] })), ["drop:customer_payment:P9"]);
});

// ---------------------------------------------------------------- credits and refunds

test("a credit becomes a credit memo applied to the same invoice; it waits while QuickBooks applies credits on its own", () => {
  const docs = [contract({ depositCents: 0 }), inv()];
  const spec = find(plan({ docs, stages: [invStage()], lines: invLines }), "create_invoice").spec;
  const invRec = rec({ record_id: "IS1", bill_id: "IS1", qb_hash: invoiceHash(spec) });
  assert.deepEqual(ops(plan({ docs, stages: [invStage()], lines: invLines, credits: [credit()], records: [invRec] })), ["create_credit:K1", "link_credit:K1"]);
  const auto = plan({ docs, stages: [invStage()], lines: invLines, credits: [credit()], records: [invRec], prefs: { autoApplyCredit: true } });
  assert.deepEqual(ops(auto), ["wait:credit:K1"]);
  assert.equal((auto[0] as Extract<SalesStep, { op: "wait" }>).reason, 'QuickBooks is set to apply credits on its own, to the oldest invoice. Turn off "Automatically apply credits" in QuickBooks\' settings and it goes.');
  // Sent, but not yet applied: applied.
  const kRec = rec({ record_type: "credit", record_id: "K1", bill_id: "IS1", qb_id: "700" });
  assert.deepEqual(ops(plan({ docs, stages: [invStage()], lines: invLines, credits: [credit()], records: [invRec, kRec] })), ["link_credit:K1"]);
  // Removed in the CRM: taken off and removed there.
  const linkRec = rec({ record_type: "credit_link", record_id: "K1", bill_id: "IS1", qb_id: "701" });
  assert.deepEqual(ops(plan({ docs, stages: [invStage()], lines: invLines, credits: [credit({ removed: true })], records: [invRec, kRec, linkRec] })), ["remove_credit:K1"]);
  // A refund's own credit is never sent as a credit memo.
  assert.deepEqual(ops(plan({ docs, stages: [invStage()], lines: invLines, credits: [credit({ fromRefund: true })], records: [invRec] })), []);
});

test("refunds: one the customer doesn't owe back goes as a refund; owed again or undecided, it waits", () => {
  const spec = find(plan({ stages: [stage()] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  const p1 = money();
  const p1Rec = rec({ record_type: "customer_payment", record_id: "P1", bill_id: "S1", qb_id: "600", qb_hash: paymentHash(p1, { type: "invoice", id: "S1" }, day(p1.paidAt ?? "")) });
  const r = (over: Partial<SyncMoney>) => money({ id: "R1", amountCents: -20_000, refundOf: "P1", note: "Paint touch-up not needed", ...over });
  // Not owed: the CRM files a credit beside it for the whole refund.
  const filed = credit({ id: "KR1", docId: "C1", stageId: "S1", amountCents: 20_000, fromRefund: true, refundId: "R1" });
  const base = { stages: [stage()], records: [invRec, p1Rec], credits: [filed] };
  const no = plan({ ...base, money: [p1, r({ stillOwed: false })] });
  assert.deepEqual(ops(no), ["create_refund:R1"]);
  assert.equal(find(no, "create_refund").account, "hand");
  assert.equal(find(plan({ ...base, money: [p1, r({ stillOwed: false, source: "stripe" })] }), "create_refund").account, "stripe");
  const owed = plan({ ...base, money: [p1, r({ stillOwed: true })] });
  assert.deepEqual(ops(owed), ["wait:refund:R1"]);
  assert.equal((owed[0] as Extract<SalesStep, { op: "wait" }>).reason, SALES_WAIT.owedAgain);
  const undecided = plan({ ...base, money: [p1, r({ stillOwed: null, source: "stripe" })] });
  assert.equal((undecided[0] as Extract<SalesStep, { op: "wait" }>).reason, 'Waits for an answer to "Still owed?" on the refund\'s row in Payments.');
  // No account picked for refunds recorded by hand.
  const noAcct = plan({ ...base, money: [p1, r({ stillOwed: false })], settings: { handRefundsAccount: null } });
  assert.equal((noAcct[0] as Extract<SalesStep, { op: "wait" }>).reason, "Pick the account refunds you record by hand come from, in Settings › QuickBooks.");
  // Removed in the CRM after it went: removed there too.
  const rRec = rec({ record_type: "refund", record_id: "R1", bill_id: "S1", qb_id: "800" });
  assert.deepEqual(ops(plan({ ...base, money: [p1], records: [invRec, p1Rec, rRec] })), ["delete_refund:R1"]);
});

// ---------------------------------------------------------------- changes and removals

test("a stage un-billed is removed from QuickBooks; a cancelled invoice is voided there", () => {
  const spec = find(plan({ stages: [stage()] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  assert.deepEqual(ops(plan({ stages: [stage({ requestedAt: null, dueDate: null })], records: [invRec] })), ["delete_invoice:invoice:S1"]);
  const docs = [contract({ depositCents: 0 }), inv({ status: "Void" })];
  const iSpec = find(plan({ docs: [contract({ depositCents: 0 }), inv()], stages: [invStage()], lines: invLines }), "create_invoice").spec;
  const iRec = rec({ record_id: "IS1", bill_id: "IS1", qb_hash: invoiceHash(iSpec) });
  assert.deepEqual(ops(plan({ docs, stages: [invStage({ requestedAt: null, dueDate: null })], lines: invLines, records: [iRec] })), ["void_invoice:invoice:IS1"]);
  // Its credit comes off first.
  const kRec = rec({ record_type: "credit", record_id: "K1", bill_id: "IS1", qb_id: "700" });
  const linkRec = rec({ record_type: "credit_link", record_id: "K1", bill_id: "IS1", qb_id: "701" });
  assert.deepEqual(ops(plan({ docs, stages: [invStage({ requestedAt: null })], lines: invLines, credits: [credit()], records: [iRec, kRec, linkRec] })), [
    "remove_credit:K1",
    "void_invoice:invoice:IS1",
  ]);
});

test("a voided contract: its bills with no money are voided in QuickBooks; one with money stays, saying so", () => {
  const spec = find(plan({ stages: [stage()] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  const voided = [contract({ depositCents: 0, status: "Void" })];
  assert.deepEqual(ops(plan({ docs: voided, stages: [stage()], records: [invRec] })), ["void_invoice:invoice:S1"]);
  const p1Rec = rec({ record_type: "customer_payment", record_id: "P1", bill_id: "S1", qb_id: "600", qb_hash: paymentHash(money(), { type: "invoice", id: "S1" }, day(money().paidAt ?? "")) });
  const withMoney = plan({ docs: voided, stages: [stage()], money: [money()], records: [invRec, p1Rec] });
  assert.deepEqual(ops(withMoney), ["wait:invoice:S1"]);
  assert.equal((withMoney[0] as Extract<SalesStep, { op: "wait" }>).reason, SALES_WAIT.voidedWithMoney);
  // Never sent: nothing to do.
  assert.deepEqual(ops(plan({ docs: voided, stages: [stage()] })), []);
});

test("a new due date is sent as a change; an amount that changed after it went waits for a hand fix", () => {
  const spec = find(plan({ stages: [stage()] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  assert.deepEqual(ops(plan({ stages: [stage()], records: [invRec] })), []);
  assert.deepEqual(ops(plan({ stages: [stage({ dueDate: "2026-10-19" })], records: [invRec] })), ["update_invoice:invoice:S1"]);
  const changed = plan({ stages: [stage({ amountCents: 950_000 })], records: [invRec] });
  assert.deepEqual(ops(changed), ["wait:invoice:S1"]);
  assert.equal((changed[0] as Extract<SalesStep, { op: "wait" }>).reason, SALES_WAIT.changedAfter);
});

test("QuickBooks' total didn't match: the invoice is looked at again later, and its payments wait", () => {
  const spec = find(plan({ stages: [stage()] }), "create_invoice").spec;
  const mismatch = rec({ qb_hash: invoiceHash(spec), status: "waiting", reason: "x", tried_hash: "total:2574", next_try_at: null });
  const steps = plan({ stages: [stage()], money: [money()], records: [mismatch] });
  assert.deepEqual(ops(steps), ["recheck_invoice:invoice:S1", "wait:customer_payment:P1"]);
  assert.equal((steps[1] as Extract<SalesStep, { op: "wait" }>).reason, SALES_WAIT.mismatchChild);
});

test("an invoice someone deleted in QuickBooks is left alone, and so are its payments", () => {
  const gone = rec({ status: "gone", qb_id: "500" });
  const steps = plan({ stages: [stage()], money: [money()], records: [gone] });
  assert.deepEqual(ops(steps), ["wait:customer_payment:P1"]);
  assert.equal((steps[0] as Extract<SalesStep, { op: "wait" }>).reason, SALES_WAIT.billGone);
});

test("an add whose answer never came is repeated first, and nothing else happens to it that run", () => {
  const doubt = rec({ qb_id: null, status: "waiting", doubt: { requestId: "crm-x", body: {}, hash: "h" } });
  assert.deepEqual(ops(plan({ stages: [stage()], money: [money()], records: [doubt] })), ["resolve:invoice:S1", "wait:customer_payment:P1"]);
});

test("refused and resting: tried again later, at once when it changes, or with Send now", () => {
  const spec = find(plan({ stages: [stage()] }), "create_invoice").spec;
  const refused = rec({ qb_id: null, status: "failed", failed_op: "add", tried_hash: invoiceHash(spec), next_try_at: "2026-10-08T16:00:00Z" });
  assert.deepEqual(ops(plan({ stages: [stage()], records: [refused] })), []);
  assert.deepEqual(ops(plan({ stages: [stage()], records: [refused], force: true })), ["create_invoice:invoice:S1"]);
});

test("a contact deleted in the CRM: what went to QuickBooks for it is left as it is there, payments included", () => {
  const records = [
    rec({}),
    rec({ record_type: "deposit", record_id: "C1", bill_id: "C1", qb_id: "501" }),
    rec({ record_type: "customer_payment", record_id: "P1", bill_id: "S1", qb_id: "600" }),
    rec({ record_type: "customer_payment", record_id: "P0", bill_id: "C1", qb_id: "601" }),
    rec({ record_type: "credit", record_id: "K1", bill_id: "S1", qb_id: "700" }),
    rec({ record_type: "credit_link", record_id: "K1", bill_id: "S1", qb_id: "701" }),
    rec({ record_type: "refund", record_id: "R1", bill_id: "S1", qb_id: "800" }),
  ];
  assert.deepEqual(ops(plan({ leads: [], docs: [], stages: [], records })), []);
});

test("something deleted in QuickBooks isn't sent again: a payment, a credit or a refund", () => {
  const spec = find(plan({ stages: [stage()] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  const goneP = rec({ record_type: "customer_payment", record_id: "P1", bill_id: "S1", qb_id: "600", status: "gone" });
  assert.deepEqual(ops(plan({ stages: [stage()], money: [money({ note: "edited" })], records: [invRec, goneP] })), []);
  const docs = [contract({ depositCents: 0 }), inv()];
  const iSpec = find(plan({ docs, stages: [invStage()], lines: invLines }), "create_invoice").spec;
  const iRec = rec({ record_id: "IS1", bill_id: "IS1", qb_hash: invoiceHash(iSpec) });
  const goneK = rec({ record_type: "credit", record_id: "K1", bill_id: "IS1", qb_id: "700", status: "gone" });
  assert.deepEqual(ops(plan({ docs, stages: [invStage()], lines: invLines, credits: [credit()], records: [iRec, goneK] })), []);
  const p1 = money();
  const p1Rec = rec({ record_type: "customer_payment", record_id: "P1", bill_id: "S1", qb_id: "600", qb_hash: paymentHash(p1, { type: "invoice", id: "S1" }, day(p1.paidAt ?? "")) });
  const goneR = rec({ record_type: "refund", record_id: "R1", bill_id: "S1", qb_id: "800", status: "gone" });
  const r1 = money({ id: "R1", amountCents: -20_000, refundOf: "P1", stillOwed: false });
  assert.deepEqual(ops(plan({ stages: [stage()], money: [p1, r1], records: [invRec, p1Rec, goneR] })), []);
});

test("a credit on a bill being taken out of QuickBooks: only the removal touches it, never a re-link or a reset", () => {
  const docs = [contract({ depositCents: 0 }), inv({ status: "Void" })];
  const iSpec = find(plan({ docs: [contract({ depositCents: 0 }), inv()], stages: [invStage()], lines: invLines }), "create_invoice").spec;
  const iRec = rec({ record_id: "IS1", bill_id: "IS1", qb_hash: invoiceHash(iSpec) });
  const base = { docs, stages: [invStage({ requestedAt: null })], lines: invLines, credits: [credit()] };
  const later = "2026-10-08T18:00:00Z";
  // The $0.00 payment's removal was refused and is resting: nothing this run.
  const kRec = rec({ record_type: "credit", record_id: "K1", bill_id: "IS1", qb_id: "700" });
  const linkRefused = rec({ record_type: "credit_link", record_id: "K1", bill_id: "IS1", qb_id: "701", status: "failed", failed_op: "remove", tries: 1, next_try_at: later });
  assert.deepEqual(ops(plan({ ...base, records: [iRec, kRec, linkRefused] })), []);
  // The $0.00 payment came off, the credit memo's removal was refused: it isn't applied again.
  const linkGone = rec({ record_type: "credit_link", record_id: "K1", bill_id: "IS1", qb_id: null, status: "removed" });
  const memoRefused = rec({ record_type: "credit", record_id: "K1", bill_id: "IS1", qb_id: "700", status: "failed", failed_op: "remove", tries: 1, next_try_at: later });
  assert.deepEqual(ops(plan({ ...base, records: [iRec, memoRefused, linkGone] })), []);
  // A new credit on it isn't sent either.
  assert.deepEqual(ops(plan({ ...base, credits: [credit({ id: "K2" })], records: [iRec] })), ["void_invoice:invoice:IS1"]);
});

test("a change order counted once: money paid on the side that didn't go says to record it by hand", () => {
  const co = contract({ id: "CO1", kind: "change_order", docNumber: "EST-1047-CO1", title: "Add a window", parentId: "C1", depositCents: 0, totalCents: 120_000, signedAt: "2026-10-04T18:00:00Z" });
  const coStage = stage({ id: "CS1", docId: "CO1", name: "Window", description: null, amountCents: 120_000, requestedAt: "2026-10-06T17:00:00Z" });
  const mirror = stage({ id: "M1", docId: "C1", sortOrder: 3, name: "EST-1047-CO1", description: "Add a window", amountCents: 120_000, requestedAt: "2026-10-07T17:00:00Z" });
  const docs = [contract({ depositCents: 0 }), co];
  const mSpec = find(plan({ docs, stages: [mirror] }), "create_invoice").spec;
  const mRec = rec({ record_id: "M1", bill_id: "M1", qb_hash: invoiceHash(mSpec) });
  const paid = money({ id: "P5", docId: "CO1", stageId: "CS1", amountCents: 120_000 });
  const steps = plan({ docs, stages: [coStage, mirror], money: [paid], records: [mRec] });
  assert.deepEqual(ops(steps), ["wait:invoice:CS1", "wait:customer_payment:P5"]);
  assert.equal((steps[1] as Extract<SalesStep, { op: "wait" }>).reason, SALES_WAIT.coMoneyOnParent("EST-1047"));
  // The other way round: money on the contract's line while the change order went on its own stages.
  const cSpec = find(plan({ docs, stages: [coStage] }), "create_invoice").spec;
  const cRec = rec({ record_id: "CS1", bill_id: "CS1", qb_hash: invoiceHash(cSpec) });
  const onMirror = money({ id: "P6", stageId: "M1", amountCents: 120_000 });
  const other = plan({ docs, stages: [coStage, mirror], money: [onMirror], records: [cRec] });
  assert.deepEqual(ops(other), ["wait:invoice:M1", "wait:customer_payment:P6"]);
  assert.equal((other[1] as Extract<SalesStep, { op: "wait" }>).reason, SALES_WAIT.coMoneyOnOwn);
});

test("a billed stage below zero (a change order that lowers the price) waits, to be entered by hand", () => {
  const credited = stage({ id: "M2", sortOrder: 4, name: "EST-1047-CO2", description: "Skip the backsplash", amountCents: -80_000, requestedAt: "2026-10-07T17:00:00Z" });
  const steps = plan({ stages: [credited] });
  assert.deepEqual(ops(steps), ["wait:invoice:M2"]);
  assert.equal((steps[0] as Extract<SalesStep, { op: "wait" }>).reason, SALES_WAIT.negative);
});

test("paid again after a bounced check the customer still owes: the new payment says to enter both by hand", () => {
  const spec = find(plan({ stages: [stage()] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  const p1 = money();
  const p1Rec = rec({ record_type: "customer_payment", record_id: "P1", bill_id: "S1", qb_id: "600", qb_hash: paymentHash(p1, { type: "invoice", id: "S1" }, day(p1.paidAt ?? "")) });
  const bounced = money({ id: "R1", amountCents: -900_000, refundOf: "P1", stillOwed: true, note: "Check returned" });
  const again = money({ id: "P2", amountCents: 900_000, paidAt: "2026-10-09T19:00:00Z", reference: "2101" });
  const steps = plan({ stages: [stage()], money: [p1, bounced, again], records: [invRec, p1Rec] });
  assert.deepEqual(ops(steps), ["wait:customer_payment:P2", "wait:refund:R1"]);
  assert.equal((steps[0] as Extract<SalesStep, { op: "wait" }>).reason, SALES_WAIT.paidAgain);
});

test("money from before the start date isn't sent, even when its stage is billed after", () => {
  const early = money({ paidAt: "2026-09-25T19:00:00Z" });
  const steps = plan({ stages: [stage({ requestedAt: "2026-10-09T17:00:00Z", dueDate: "2026-10-16" })], money: [early] });
  assert.deepEqual(ops(steps), ["create_invoice:invoice:S1", "wait:customer_payment:P1"]);
  assert.equal((steps[1] as Extract<SalesStep, { op: "wait" }>).reason, SALES_WAIT.beforeStart("2026-10-01"));
});

// ---------------------------------------------------------------- change orders count once

test("a change order counts once: on its own stages, or as its one line on the contract, whichever went first", () => {
  const co = contract({ id: "CO1", kind: "change_order", docNumber: "EST-1047-CO1", title: "Add a window", parentId: "C1", depositCents: 0, totalCents: 120_000, signedAt: "2026-10-04T18:00:00Z" });
  const coStage = stage({ id: "CS1", docId: "CO1", name: "Window", description: null, amountCents: 120_000, requestedAt: "2026-10-06T17:00:00Z" });
  const mirror = stage({ id: "M1", docId: "C1", sortOrder: 3, name: "EST-1047-CO1", description: "Add a window", amountCents: 120_000, requestedAt: "2026-10-07T17:00:00Z" });
  const docs = [contract({ depositCents: 0 }), co];
  // Both billed, the change order's own stage first: it goes; the mirror waits (saying it goes the other way, not that it's there).
  const both = plan({ docs, stages: [coStage, mirror] });
  assert.deepEqual(ops(both), ["wait:invoice:M1", "create_invoice:invoice:CS1"]);
  assert.equal((both[0] as Extract<SalesStep, { op: "wait" }>).reason, SALES_WAIT.coGoesOwn);
  assert.equal(find(both, "create_invoice").spec.contractId, "C1", "a change order goes on its contract's job");
  assert.equal(find(both, "create_invoice").spec.docNumber, "EST-1047-CO1-1");
  // The mirror already in QuickBooks: the change order's own stages wait.
  const mSpec = find(plan({ docs, stages: [mirror] }), "create_invoice").spec;
  const mRec = rec({ record_id: "M1", bill_id: "M1", qb_hash: invoiceHash(mSpec) });
  const other = plan({ docs, stages: [coStage, mirror], records: [mRec] });
  assert.deepEqual(ops(other), ["wait:invoice:CS1"]);
  assert.equal((other[0] as Extract<SalesStep, { op: "wait" }>).reason, "This change order is already in QuickBooks as one bill on EST-1047. Sending its stages too would count it twice.");
});

test("round 2: a change order's own stage still in QuickBooks keeps its contract line out, even once un-billed", () => {
  const co = contract({ id: "CO1", kind: "change_order", docNumber: "EST-1047-CO1", title: "Add a window", parentId: "C1", depositCents: 0, totalCents: 120_000, signedAt: "2026-10-04T18:00:00Z" });
  const coStage = stage({ id: "CS1", docId: "CO1", name: "Window", description: null, amountCents: 120_000, requestedAt: "2026-10-06T17:00:00Z" });
  const mirror = stage({ id: "M1", docId: "C1", sortOrder: 3, name: "EST-1047-CO1", description: "Add a window", amountCents: 120_000, requestedAt: "2026-10-09T17:00:00Z" });
  const docs = [contract({ depositCents: 0 }), co];
  const cSpec = find(plan({ docs, stages: [coStage] }), "create_invoice").spec;
  const cRec = rec({ record_id: "CS1", bill_id: "CS1", qb_hash: invoiceHash(cSpec) });
  const steps = plan({ docs, stages: [{ ...coStage, requestedAt: null }, mirror], records: [cRec] });
  assert.deepEqual(ops(steps), ["delete_invoice:invoice:CS1", "wait:invoice:M1"]);
  // Its removal refused and resting: the contract line still waits.
  const refused = rec({ record_id: "CS1", bill_id: "CS1", qb_hash: invoiceHash(cSpec), status: "failed", failed_op: "remove", tries: 1, next_try_at: "2026-10-08T18:00:00Z" });
  assert.deepEqual(ops(plan({ docs, stages: [{ ...coStage, requestedAt: null }, mirror], records: [refused] })), ["wait:invoice:M1"]);
});

test("round 2: a change order's waiting side says what to do with a credit or refund on it too, not just a payment", () => {
  for (const text of [SALES_WAIT.coMoneyOnOwn, SALES_WAIT.coMoneyOnParent("EST-1047"), SALES_WAIT.coMoneyGoesOwn, SALES_WAIT.coMoneyGoesParent("EST-1047")]) {
    assert.doesNotMatch(text, /this payment/i);
  }
});

test("round 2: a refund of a payment deleted in QuickBooks says so, instead of waiting for that payment", () => {
  const spec = find(plan({ stages: [stage()] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  const goneP = rec({ record_type: "customer_payment", record_id: "P1", bill_id: "S1", qb_id: "600", status: "gone" });
  const r1 = money({ id: "R1", amountCents: -20_000, refundOf: "P1", stillOwed: false });
  const steps = plan({ stages: [stage()], money: [money(), r1], records: [invRec, goneP] });
  assert.deepEqual(ops(steps), ["wait:refund:R1"]);
  assert.equal((steps[0] as Extract<SalesStep, { op: "wait" }>).reason, SALES_WAIT.refundOfGone);
});

test("round 2: a credit's $0.00 payment record left from a refused try is cleared once its bill is out", () => {
  const docs = [contract({ depositCents: 0 }), inv({ status: "Void" })];
  const removed = rec({ record_id: "IS1", bill_id: "IS1", qb_id: null, status: "removed" });
  const memoRemoved = rec({ record_type: "credit", record_id: "K1", bill_id: "IS1", qb_id: null, status: "removed" });
  const linkRefused = rec({ record_type: "credit_link", record_id: "K1", bill_id: "IS1", qb_id: null, status: "failed", failed_op: "add" });
  const steps = plan({ docs, stages: [invStage({ requestedAt: null })], lines: invLines, credits: [credit()], records: [removed, memoRemoved, linkRefused] });
  assert.deepEqual(ops(steps), ["drop:credit_link:K1"]);
});

test("round 2: a bill isn't voided while a payment on it that QuickBooks wouldn't void is resting", () => {
  const spec = find(plan({ stages: [stage()] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  const stuck = rec({ record_type: "customer_payment", record_id: "P1", bill_id: "S1", qb_id: "600", status: "failed", failed_op: "remove", tries: 1, next_try_at: "2026-10-08T18:00:00Z" });
  const voided = [contract({ depositCents: 0, status: "Void" })];
  assert.deepEqual(ops(plan({ docs: voided, stages: [stage()], money: [], records: [invRec, stuck] })), []);
  // Not resting: the payment is voided first, in the same run (the run holds the bill back if that's refused again).
  const due = { ...stuck, next_try_at: "2026-10-08T11:00:00Z" };
  assert.deepEqual(ops(plan({ docs: voided, stages: [stage()], money: [], records: [invRec, due] })), ["void_payment:P1", "void_invoice:invoice:S1"]);
});

test("round 2: a customer QuickBooks refused isn't tried again for a bill's job until its back-off is up, or Send now", () => {
  const refused = rec({ record_type: "customer", record_id: "L1", bill_id: null, qb_id: null, status: "failed", failed_op: "add", tries: 1, next_try_at: "2026-10-08T18:00:00Z" });
  assert.deepEqual(ops(plan({ docs: [], billLinks: [{ leadId: "L1", contractId: null }], records: [refused] })), []);
  assert.deepEqual(ops(plan({ docs: [], billLinks: [{ leadId: "L1", contractId: null }], records: [refused], force: true })), ["ensure_customer:L1"]);
});

test("round 3: a job for bills isn't asked for while its customer is refused and backing off", () => {
  const refused = rec({ record_type: "customer", record_id: "L1", bill_id: null, qb_id: null, status: "failed", failed_op: "add", tries: 1, next_try_at: "2026-10-08T18:00:00Z" });
  const base = { docs: [contract({ depositCents: 0 })], billLinks: [{ leadId: "L1", contractId: "C1" }] };
  assert.deepEqual(ops(plan({ ...base, records: [refused] })), []);
  assert.deepEqual(ops(plan({ ...base, records: [refused], force: true })), ["ensure_job:C1"]);
});

test("round 3: a change order whose other bill was deleted in QuickBooks says so, instead of 'goes to QuickBooks'", () => {
  const co = contract({ id: "CO1", kind: "change_order", docNumber: "EST-1047-CO1", title: "Add a window", parentId: "C1", depositCents: 0, totalCents: 120_000, signedAt: "2026-10-04T18:00:00Z" });
  const coStage = stage({ id: "CS1", docId: "CO1", name: "Window", description: null, amountCents: 120_000, requestedAt: "2026-10-09T17:00:00Z" });
  const mirror = stage({ id: "M1", docId: "C1", sortOrder: 3, name: "EST-1047-CO1", description: "Add a window", amountCents: 120_000, requestedAt: "2026-10-06T17:00:00Z" });
  const mGone = rec({ record_id: "M1", bill_id: "M1", status: "gone" });
  const paid = money({ id: "P9", docId: "CO1", stageId: "CS1", amountCents: 120_000, paidAt: "2026-10-09T19:00:00Z" });
  const steps = plan({ docs: [contract({ depositCents: 0 }), co], stages: [coStage, mirror], money: [paid], records: [mGone] });
  const why = (id: string) => (steps.find((x) => x.op === "wait" && x.recordId === id) as Extract<SalesStep, { op: "wait" }>).reason;
  assert.equal(why("CS1"), SALES_WAIT.coGone);
  assert.equal(why("P9"), SALES_WAIT.coMoneyGone);
});

test("round 3: a change to something already in QuickBooks, dated in a month QuickBooks has closed, waits saying to make it there", () => {
  const spec = find(plan({ stages: [stage()] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  const p1 = money();
  const p1Rec = rec({ record_type: "customer_payment", record_id: "P1", bill_id: "S1", qb_id: "600", qb_hash: paymentHash(p1, { type: "invoice", id: "S1" }, day(p1.paidAt ?? "")) });
  const edited = plan({ stages: [stage()], money: [money({ reference: "2088" })], records: [invRec, p1Rec], prefs: { bookCloseDate: "2026-10-07" } });
  assert.deepEqual(ops(edited), ["wait:customer_payment:P1"]);
  assert.equal((edited[0] as Extract<SalesStep, { op: "wait" }>).reason, SALES_WAIT.closedChange("2026-10-07"));
  const redated = plan({ stages: [stage({ dueDate: "2026-10-19" })], records: [invRec], prefs: { bookCloseDate: "2026-10-07" } });
  assert.deepEqual(ops(redated), ["wait:invoice:S1"]);
  assert.equal((redated[0] as Extract<SalesStep, { op: "wait" }>).reason, SALES_WAIT.closedChange("2026-10-07"));
  assert.doesNotMatch(SALES_WAIT.closedChange("2026-10-07"), /enter it/);
});

test("round 3: a payment already in QuickBooks whose change didn't go says it's there, not that it didn't go", () => {
  const c = (child: SyncRecord) =>
    invoiceQbChips({ sending: true, sendFrom: FROM, label: "Invoice", invoice: { day: "2026-10-05", voided: false, outside: false }, record: rec({}), payments: [child], credits: [], refunds: [], day: (iso) => iso.slice(5, 10) }).chips.map((x) => `${x.tone}|${x.text}`);
  assert.deepEqual(c(rec({ record_type: "customer_payment", record_id: "P1", qb_id: "600", status: "failed", failed_op: "change", reason: "QuickBooks said: x" })), [
    "good|✓ Invoice in QuickBooks",
    "bad|Payment in QuickBooks, but its last change didn't go: QuickBooks said: x",
  ]);
  assert.deepEqual(c(rec({ record_type: "customer_payment", record_id: "P1", qb_id: "600", status: "waiting", reason: "Waits." })), [
    "good|✓ Invoice in QuickBooks",
    "wait|Payment in QuickBooks; its change waits: Waits.",
  ]);
});

test("round 4: a bill filed to a voided contract still gets its customer", () => {
  assert.deepEqual(ops(plan({ docs: [contract({ depositCents: 0, status: "Void" })], billLinks: [{ leadId: "L1", contractId: "C1" }] })), ["ensure_customer:L1"]);
});

test("round 4: a customer or job that couldn't be added, and that nothing needs any more, is cleared", () => {
  const stuckCustomer = rec({ record_type: "customer", record_id: "L9", bill_id: null, qb_id: null, status: "waiting", reason: "x", tries: 1, next_try_at: "2026-10-08T11:00:00Z" });
  const stuckJob = rec({ record_type: "job", record_id: "C9", bill_id: null, qb_id: null, status: "failed", failed_op: "add", reason: "x", tries: 1, next_try_at: "2026-10-08T11:00:00Z" });
  const inQb = rec({ record_type: "customer", record_id: "L8", bill_id: null, qb_id: "300" });
  assert.deepEqual(ops(plan({ docs: [], records: [stuckCustomer, stuckJob, inQb] })), ["drop:customer:L9", "drop:job:C9"]);
  // Still wanted for a bill's job: kept.
  assert.deepEqual(ops(plan({ docs: [], records: [stuckCustomer], billLinks: [{ leadId: "L9", contractId: null }] })), []);
});

test("round 5: a revision's copy of a change order's line is counted once too", () => {
  const v1 = contract({ status: "Void", depositCents: 0 });
  const v2 = contract({ id: "C2", docNumber: "EST-1047v2", familyNumber: "EST-1047", depositCents: 0, signedAt: "2026-10-05T18:00:00Z" });
  const co = contract({ id: "CO1", kind: "change_order", docNumber: "EST-1047-CO1", title: "Wet bar", parentId: "C1", depositCents: 0, totalCents: 400_000, signedAt: "2026-10-03T18:00:00Z" });
  const coStage = stage({ id: "CS1", docId: "CO1", name: "Wet bar", description: null, amountCents: 400_000, requestedAt: "2026-10-04T17:00:00Z" });
  const copied = stage({ id: "M2", docId: "C2", sortOrder: 2, name: "EST-1047-CO1", description: "Wet bar", amountCents: 400_000, requestedAt: "2026-10-09T17:00:00Z" });
  const docs = [v1, v2, co];
  const cSpec = find(plan({ docs, stages: [coStage] }), "create_invoice").spec;
  const cRec = rec({ record_id: "CS1", bill_id: "CS1", qb_hash: invoiceHash(cSpec) });
  const steps = plan({ docs, stages: [coStage, copied], records: [cRec] });
  assert.deepEqual(ops(steps), ["wait:invoice:M2"]);
  assert.equal((steps[0] as Extract<SalesStep, { op: "wait" }>).reason, SALES_WAIT.coOnOwn);
});

test("round 5: a revision's numbers carry its version; an edit before signing doesn't", () => {
  assert.equal(qbDocNumber({ kind: "contract", doc_number: "EST-1047", version: 2, supersedes_id: "x" }), "EST-1047v2");
  assert.equal(qbDocNumber({ kind: "contract", doc_number: "EST-1047", version: 2, supersedes_id: null }), "EST-1047");
  assert.equal(qbDocNumber({ kind: "invoice", doc_number: "INV-1004", version: 3, supersedes_id: "x" }), "INV-1004");
});

test("round 5: a payment's change is judged by the day QuickBooks gets, not the exact time", () => {
  const key = { type: "invoice" as const, id: "S1" };
  assert.equal(paymentHash(money({ paidAt: "2026-10-07T19:00:00Z" }), key, "2026-10-07"), paymentHash(money({ paidAt: "2026-10-07T19:07:00Z" }), key, "2026-10-07"));
  assert.notEqual(paymentHash(money(), key, "2026-10-07"), paymentHash(money(), key, "2026-10-08"));
});

test("round 5: a job record for a voided contract isn't kept for bills (they go on the customer)", () => {
  const stuckJob = rec({ record_type: "job", record_id: "C1", bill_id: null, qb_id: null, status: "waiting", reason: "x", tries: 1, next_try_at: "2026-10-08T11:00:00Z" });
  const steps = plan({ docs: [contract({ depositCents: 0, status: "Void" })], billLinks: [{ leadId: "L1", contractId: "C1" }], records: [stuckJob] });
  assert.deepEqual(ops(steps), ["drop:job:C1", "ensure_customer:L1"]);
});

test("round 5: an invoice voided (not deleted) in QuickBooks says so", () => {
  const voidedThere = rec({ status: "gone", reason: "Voided in QuickBooks, so the CRM doesn't send to it again." });
  const chips = invoiceQbChips({ sending: true, sendFrom: FROM, label: "Invoice", invoice: { day: "2026-10-05", voided: false, outside: false }, record: voidedThere, payments: [], credits: [], refunds: [], day: (iso) => iso });
  assert.deepEqual(chips.chips.map((c) => c.text), ["Voided in QuickBooks, so the CRM doesn't send to it again."]);
  assert.match(SALES_WAIT.billGone, /deleted or voided/);
});

test("round 6: money on a bill whose contract was voided before the bill went waits, to be entered by hand", () => {
  const v1 = contract({ status: "Void", depositCents: 0 });
  const paid = money({ paidAt: "2026-10-06T19:00:00Z" });
  const steps = plan({ docs: [v1], stages: [stage()], money: [paid] });
  assert.deepEqual(ops(steps), ["wait:invoice:S1", "wait:customer_payment:P1"]);
  assert.equal((steps[0] as Extract<SalesStep, { op: "wait" }>).reason, SALES_WAIT.voidedUnsent);
  assert.equal((steps[1] as Extract<SalesStep, { op: "wait" }>).reason, SALES_WAIT.voidedUnsentChild);
  // No money on it: nothing to do, as before.
  assert.deepEqual(ops(plan({ docs: [v1], stages: [stage()] })), []);
});

test("round 6: a change order's line on a voided version never counts as billed first", () => {
  const v1 = contract({ status: "Void", depositCents: 0 });
  const v2 = contract({ id: "C2", docNumber: "EST-1047v2", familyNumber: "EST-1047", depositCents: 0, signedAt: "2026-10-05T18:00:00Z" });
  const co = contract({ id: "CO1", kind: "change_order", docNumber: "EST-1047-CO1", title: "Wet bar", parentId: "C1", depositCents: 0, totalCents: 120_000, signedAt: "2026-10-03T18:00:00Z" });
  const oldLine = stage({ id: "M1", docId: "C1", sortOrder: 2, name: "EST-1047-CO1", description: "Wet bar", amountCents: 120_000, requestedAt: "2026-10-04T17:00:00Z" });
  const newLine = stage({ id: "M2", docId: "C2", sortOrder: 2, name: "EST-1047-CO1", description: "Wet bar", amountCents: 120_000, requestedAt: "2026-10-08T17:00:00Z" });
  const removedOld = rec({ record_id: "M1", bill_id: "M1", qb_id: null, status: "removed" });
  const steps = plan({ docs: [v1, v2, co], stages: [oldLine, newLine], records: [removedOld] });
  assert.ok(ops(steps).includes("create_invoice:invoice:M2"), ops(steps).join(","));
});

test("round 6: a change order on a voided contract goes on its revision's job (until it's sent)", () => {
  const v1 = contract({ status: "Void", depositCents: 0 });
  const v2 = contract({ id: "C2", docNumber: "EST-1047v2", familyNumber: "EST-1047", depositCents: 0, signedAt: "2026-10-05T18:00:00Z" });
  const co = contract({ id: "CO1", kind: "change_order", docNumber: "EST-1047-CO1", title: "Wet bar", parentId: "C1", depositCents: 0, totalCents: 120_000, signedAt: "2026-10-03T18:00:00Z" });
  const coStage = stage({ id: "CS1", docId: "CO1", name: "Wet bar", description: null, amountCents: 120_000, requestedAt: "2026-10-09T17:00:00Z" });
  const created = find(plan({ docs: [v1, v2, co], stages: [coStage] }), "create_invoice");
  assert.equal(created.spec.contractId, "C2");
});

test("round 6: a payment too much for its bill and refunded in full (not owed) needs nothing in QuickBooks", () => {
  const spec = find(plan({ stages: [stage()] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  const check = money();
  const checkRec = rec({ record_type: "customer_payment", record_id: "P1", bill_id: "S1", qb_id: "600", qb_hash: paymentHash(check, { type: "invoice", id: "S1" }, day(check.paidAt ?? "")) });
  const ach = money({ id: "P2", method: "us_bank_account", source: "stripe", reference: null, paidAt: "2026-10-08T19:00:00Z" });
  const back = money({ id: "R2", amountCents: -900_000, refundOf: "P2", stillOwed: false, source: "stripe", method: "us_bank_account", reference: null, paidAt: "2026-10-09T19:00:00Z" });
  const achWaiting = rec({ record_type: "customer_payment", record_id: "P2", bill_id: "S1", qb_id: null, status: "waiting", reason: SALES_WAIT.overpaid });
  const steps = plan({ stages: [stage()], money: [check, ach, back], records: [invRec, checkRec, achWaiting] });
  assert.deepEqual(ops(steps), ["unneeded:customer_payment:P2", "unneeded:refund:R2"]);
});

test("round 6: paid again after the payment in QuickBooks was refunded: enter it by hand, not 'fix the amount'", () => {
  const spec = find(plan({ stages: [stage()] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  const check = money();
  const checkRec = rec({ record_type: "customer_payment", record_id: "P1", bill_id: "S1", qb_id: "600", qb_hash: paymentHash(check, { type: "invoice", id: "S1" }, day(check.paidAt ?? "")) });
  const back = money({ id: "R1", amountCents: -900_000, refundOf: "P1", stillOwed: false, paidAt: "2026-10-09T19:00:00Z" });
  const ach = money({ id: "P2", method: "us_bank_account", source: "stripe", reference: null, paidAt: "2026-10-08T19:00:00Z" });
  const steps = plan({ stages: [stage()], money: [check, back, ach], records: [invRec, checkRec] });
  // Round 8: the same amount, so the refunded check in QuickBooks stands for it (paid twice).
  assert.deepEqual(ops(steps), ["unneeded:customer_payment:P2", "unneeded:refund:R1"]);
  // A different amount: entered by hand.
  const less = plan({ stages: [stage()], money: [check, back, { ...ach, amountCents: 800_000 }], records: [invRec, checkRec] });
  const why = (less.find((x) => x.op === "wait" && x.recordId === "P2") as Extract<SalesStep, { op: "wait" }>).reason;
  assert.equal(why, SALES_WAIT.paidAfterRefund);
});

test("round 7: a refund not owed goes only when the CRM took all of it off the bill; else it waits, to be entered by hand", () => {
  const spec = find(plan({ stages: [stage()] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  const p1 = money();
  const p1Rec = rec({ record_type: "customer_payment", record_id: "P1", bill_id: "S1", qb_id: "600", qb_hash: paymentHash(p1, { type: "invoice", id: "S1" }, day(p1.paidAt ?? "")) });
  const r1 = money({ id: "R1", amountCents: -300_000, refundOf: "P1", stillOwed: false, paidAt: "2026-10-09T19:00:00Z" });
  const part = credit({ id: "KR1", docId: "C1", stageId: "S1", amountCents: 100_000, fromRefund: true, refundId: "R1" });
  const partly = plan({ stages: [stage()], money: [p1, r1], credits: [part], records: [invRec, p1Rec] });
  assert.deepEqual(ops(partly), ["wait:refund:R1"]);
  // $900 - $100 credit - $600 kept: the CRM shows $200 owed again, so it says so.
  assert.equal((partly[0] as Extract<SalesStep, { op: "wait" }>).reason, SALES_WAIT.refundOwedAgain);
  const whole = { ...part, amountCents: 300_000 };
  assert.deepEqual(ops(plan({ stages: [stage()], money: [p1, r1], credits: [whole], records: [invRec, p1Rec] })), ["create_refund:R1"]);
});

test("round 7: a payment too much for its bill, refunded in full with nothing taken off the bill, is noted as needing nothing", () => {
  const spec = find(plan({ stages: [stage()] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  const check = money();
  const checkRec = rec({ record_type: "customer_payment", record_id: "P1", bill_id: "S1", qb_id: "600", qb_hash: paymentHash(check, { type: "invoice", id: "S1" }, day(check.paidAt ?? "")) });
  const dup = money({ id: "P2", method: "card", source: "stripe", reference: null, paidAt: "2026-10-08T19:00:00Z" });
  const back = money({ id: "R2", amountCents: -900_000, refundOf: "P2", stillOwed: false, source: "stripe", method: "card", reference: null, paidAt: "2026-10-09T19:00:00Z" });
  const zero = credit({ id: "KR2", docId: "C1", stageId: "S1", amountCents: 0, fromRefund: true, refundId: "R2" });
  const steps = plan({ stages: [stage()], money: [check, dup, back], credits: [zero], records: [invRec, checkRec] });
  assert.deepEqual(ops(steps), ["unneeded:customer_payment:P2", "unneeded:refund:R2"]);
  // Already noted: nothing more.
  const noted = (t: "customer_payment" | "refund", id: string) => rec({ record_type: t, record_id: id, bill_id: "S1", qb_id: null, status: "removed", reason: SALES_WAIT.refundedAway });
  assert.deepEqual(ops(plan({ stages: [stage()], money: [check, dup, back], credits: [zero], records: [invRec, checkRec, noted("customer_payment", "P2"), noted("refund", "R2")] })), []);
  // A credit came with the refund: it changed the bill, so it waits to be entered by hand.
  const some = { ...zero, amountCents: 300_000 };
  const withCredit = plan({ stages: [stage()], money: [check, dup, back], credits: [some], records: [invRec, checkRec] });
  assert.equal((withCredit.find((x) => x.op === "wait" && x.recordId === "P2") as Extract<SalesStep, { op: "wait" }>).reason, SALES_WAIT.overpaidRefunded);
});

test("round 7: a stage paid before it was billed, then voided by a revision, waits to be entered by hand", () => {
  const v1 = contract({ status: "Void", depositCents: 0 });
  const paidEarly = stage({ requestedAt: null, dueDate: null, cancelledAt: "2026-10-06T18:00:00Z" });
  const payout = money({ method: "financing", reference: "LN-1", paidAt: "2026-10-04T19:00:00Z" });
  const steps = plan({ docs: [v1], stages: [paidEarly], money: [payout] });
  assert.deepEqual(ops(steps), ["wait:invoice:S1", "wait:customer_payment:P1"]);
  assert.equal((steps[0] as Extract<SalesStep, { op: "wait" }>).reason, SALES_WAIT.voidedUnsent);
});

test("round 7: a voided version's change-order line keeps the counted-once reason, not 'enter the bill by hand'", () => {
  const v1 = contract({ status: "Void", depositCents: 0 });
  const v2 = contract({ id: "C2", docNumber: "EST-1047v2", familyNumber: "EST-1047", depositCents: 0, signedAt: "2026-10-05T18:00:00Z" });
  const co = contract({ id: "CO1", kind: "change_order", docNumber: "EST-1047-CO1", title: "Wet bar", parentId: "C1", depositCents: 0, totalCents: 200_000, signedAt: "2026-10-03T18:00:00Z" });
  const coStage = stage({ id: "CS1", docId: "CO1", name: "Wet bar", description: null, amountCents: 200_000, requestedAt: "2026-10-04T17:00:00Z" });
  const oldLine = stage({ id: "M1", docId: "C1", sortOrder: 2, name: "EST-1047-CO1", description: "Wet bar", amountCents: 200_000, requestedAt: "2026-10-05T17:00:00Z" });
  const docs = [v1, v2, co];
  const cSpec = find(plan({ docs, stages: [coStage] }), "create_invoice").spec;
  const cRec = rec({ record_id: "CS1", bill_id: "CS1", qb_hash: invoiceHash(cSpec) });
  const paid = money({ id: "P7", stageId: "M1", amountCents: 200_000, paidAt: "2026-10-06T19:00:00Z" });
  const steps = plan({ docs, stages: [coStage, oldLine], money: [paid], records: [cRec] });
  const why = (id: string) => (steps.find((x) => x.op === "wait" && x.recordId === id) as Extract<SalesStep, { op: "wait" }>).reason;
  assert.equal(why("M1"), SALES_WAIT.coOnOwn);
  assert.equal(why("P7"), SALES_WAIT.coMoneyOnOwn);
});

test("round 7: a voided bill waiting to be entered by hand says so on its row, and a payment needing nothing isn't 'going'", () => {
  const c = (p: Partial<Parameters<typeof invoiceQbChips>[0]>) =>
    invoiceQbChips({ sending: true, sendFrom: FROM, label: "Invoice", invoice: { day: "2026-10-05", voided: true, outside: false }, record: null, payments: [], credits: [], refunds: [], day: (iso) => iso, ...p }).chips.map((x) => `${x.tone}|${x.text}`);
  assert.deepEqual(c({ record: rec({ qb_id: null, status: "waiting", reason: SALES_WAIT.voidedUnsent }) }), [`wait|Waiting: ${SALES_WAIT.voidedUnsent}`]);
  const unneeded = rec({ record_type: "customer_payment", record_id: "P2", qb_id: null, status: "removed", reason: SALES_WAIT.refundedAway });
  assert.deepEqual(c({ invoice: { day: "2026-10-05", voided: false, outside: false }, record: rec({}), payments: [unneeded] }), ["good|✓ In QuickBooks · Invoice · 2026-10-07T20:00:00Z"]);
});

test("round 8: a payment refunded in full with nothing taken off its bill never goes, wherever the bill's balance stands", () => {
  const spec = find(plan({ stages: [stage()] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  const b = money({ id: "P2", amountCents: 450_000, method: "card", source: "stripe", reference: null, paidAt: "2026-10-08T19:00:00Z" });
  const back = money({ id: "R2", amountCents: -450_000, refundOf: "P2", stillOwed: false, source: "stripe", method: "card", reference: null, paidAt: "2026-10-09T19:00:00Z" });
  // The bill has room (nothing else paid on it): still nothing goes.
  assert.deepEqual(ops(plan({ stages: [stage()], money: [b, back], records: [invRec] })), ["unneeded:customer_payment:P2", "unneeded:refund:R2"]);
});

test("round 8: a payment whose refund gave back more than came off the bill waits for hand entry, and so does that refund", () => {
  const spec = find(plan({ stages: [stage({ amountCents: 500_000 })] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  const check = money({ amountCents: 525_000 });
  const extra = money({ id: "R1", amountCents: -25_000, refundOf: "P1", stillOwed: false, paidAt: "2026-10-09T19:00:00Z" });
  const steps = plan({ stages: [stage({ amountCents: 500_000 })], money: [check, extra], records: [invRec] });
  const why = (id: string) => (steps.find((x) => x.op === "wait" && x.recordId === id) as Extract<SalesStep, { op: "wait" }>).reason;
  assert.equal(why("P1"), SALES_WAIT.refundedExtra);
  assert.equal(why("R1"), SALES_WAIT.refundByHand);
  // A normal partial refund (all of it taken off the bill): both go.
  const normal = money({ id: "R1", amountCents: -20_000, refundOf: "P1", stillOwed: false, paidAt: "2026-10-09T19:00:00Z" });
  const filed = credit({ id: "KR1", docId: "C1", stageId: "S1", amountCents: 20_000, fromRefund: true, refundId: "R1" });
  assert.deepEqual(ops(plan({ stages: [stage()], money: [money(), normal], credits: [filed], records: [rec({ qb_hash: invoiceHash(find(plan({ stages: [stage()] }), "create_invoice").spec) })] })), [
    "create_payment:P1",
    "create_refund:R1",
  ]);
});

test("round 8: a not-owed refund whose credit is short never says 'owed again'", () => {
  for (const text of [SALES_WAIT.refundBeyondBill, SALES_WAIT.refundOnVoided, SALES_WAIT.refundedExtra, SALES_WAIT.voidedRefunded]) assert.doesNotMatch(text, /owed/i, text);
  // On a voided contract: it says so.
  const spec = find(plan({ stages: [stage()] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec), status: "waiting", reason: SALES_WAIT.voidedWithMoney });
  const p1 = money();
  const p1Rec = rec({ record_type: "customer_payment", record_id: "P1", bill_id: "S1", qb_id: "600", qb_hash: paymentHash(p1, { type: "invoice", id: "S1" }, day(p1.paidAt ?? "")) });
  const r1 = money({ id: "R1", amountCents: -900_000, refundOf: "P1", stillOwed: false, paidAt: "2026-10-09T19:00:00Z" });
  const steps = plan({ docs: [contract({ depositCents: 0, status: "Void" })], stages: [stage()], money: [p1, r1], records: [invRec, p1Rec] });
  const why = (steps.find((x) => x.op === "wait" && x.recordId === "R1") as Extract<SalesStep, { op: "wait" }>).reason;
  assert.equal(why, SALES_WAIT.refundOnVoided);
});

test("round 8: paid twice and the payment in QuickBooks refunded: it stands for the one kept, and neither the other nor the refund goes", () => {
  const spec = find(plan({ stages: [stage()] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  const a = money();
  const aRec = rec({ record_type: "customer_payment", record_id: "P1", bill_id: "S1", qb_id: "600", qb_hash: paymentHash(a, { type: "invoice", id: "S1" }, day(a.paidAt ?? "")) });
  const b = money({ id: "P2", method: "card", source: "stripe", reference: null, paidAt: "2026-10-08T19:00:00Z" });
  const ra = money({ id: "R1", amountCents: -900_000, refundOf: "P1", stillOwed: false, paidAt: "2026-10-09T19:00:00Z" });
  const steps = plan({ stages: [stage()], money: [a, b, ra], records: [invRec, aRec] });
  assert.deepEqual(ops(steps), ["unneeded:customer_payment:P2", "unneeded:refund:R1"]);
  for (const x of steps) assert.equal((x as Extract<SalesStep, { op: "unneeded" }>).reason, SALES_WAIT.paidTwice);
  // The other payment still clearing: the refund waits for it (not told to be entered by hand meanwhile).
  const clearing = plan({ stages: [stage()], money: [a, { ...b, status: "pending", paidAt: null }, ra], records: [invRec, aRec] });
  assert.equal((clearing.find((x) => x.op === "wait" && x.recordId === "R1") as Extract<SalesStep, { op: "wait" }>).reason, SALES_WAIT.otherClearing);
  // A different amount kept: the refund gave back money beyond the bill; the payment kept is entered by hand.
  const c = money({ id: "P2", amountCents: 300_000, method: "card", source: "stripe", reference: null, paidAt: "2026-10-08T19:00:00Z" });
  const part = money({ id: "R1", amountCents: -300_000, refundOf: "P1", stillOwed: false, paidAt: "2026-10-09T19:00:00Z" });
  const beyond = plan({ stages: [stage()], money: [a, c, part], records: [invRec, aRec] });
  const why = (id: string) => (beyond.find((x) => x.op === "wait" && x.recordId === id) as Extract<SalesStep, { op: "wait" }>).reason;
  assert.equal(why("R1"), SALES_WAIT.refundBeyondBill);
  assert.equal(why("P2"), SALES_WAIT.paidAfterRefund);
});

// Round 9: the shared state for twins: a $9,000 stage billed, card P1 in QuickBooks refunded (not owed, $0 credit).
const twinBase = () => {
  const spec = find(plan({ stages: [stage()] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  const p1 = money({ method: "card", source: "stripe", reference: null });
  const p1Rec = rec({ record_type: "customer_payment", record_id: "P1", bill_id: "S1", qb_id: "600", qb_hash: paymentHash(p1, { type: "invoice", id: "S1" }, day(p1.paidAt ?? "")) });
  const r1 = money({ id: "R1", amountCents: -900_000, refundOf: "P1", stillOwed: false, source: "stripe", method: "card", reference: null, paidAt: "2026-10-09T19:00:00Z" });
  return { invRec, p1, p1Rec, r1 };
};
const reasonOf = (steps: SalesStep[], id: string) => {
  const x = steps.find((s) => (s.op === "wait" || s.op === "unneeded") && s.recordId === id) as Extract<SalesStep, { op: "wait" | "unneeded" }> | undefined;
  return x ? `${x.op}:${x.reason}` : "none";
};

test("round 9: a twin refunded or bounced later is no longer stood for: everything says to enter it by hand, never 'waits for its payment'", () => {
  const { invRec, p1, p1Rec, r1 } = twinBase();
  const p2 = money({ id: "P2", paidAt: "2026-10-08T19:00:00Z" });
  // The check bounces (still owed).
  const bounce = money({ id: "R2", amountCents: -900_000, refundOf: "P2", stillOwed: true, paidAt: "2026-10-10T19:00:00Z" });
  const a = plan({ stages: [stage()], money: [p1, p2, r1, bounce], records: [invRec, p1Rec] });
  // Round 10: the bounced check never went, so it and its bounce need nothing; the card's refund is entered by hand.
  assert.equal(reasonOf(a, "P2"), `unneeded:${SALES_WAIT.refundedAway}`);
  assert.equal(reasonOf(a, "R2"), `unneeded:${SALES_WAIT.refundedAway}`);
  assert.equal(reasonOf(a, "R1"), `wait:${SALES_WAIT.refundOwedAgain}`);
  // A goodwill $1,000 off the check, taken off the bill in full.
  const off = money({ id: "R2", amountCents: -100_000, refundOf: "P2", stillOwed: false, paidAt: "2026-10-10T19:00:00Z" });
  const filed = credit({ id: "KR2", docId: "C1", stageId: "S1", amountCents: 100_000, fromRefund: true, refundId: "R2" });
  const b = plan({ stages: [stage()], money: [p1, p2, r1, off], credits: [filed], records: [invRec, p1Rec] });
  assert.equal(reasonOf(b, "P2"), `wait:${SALES_WAIT.paidAfterRefund}`);
  assert.equal(reasonOf(b, "R2"), `wait:${SALES_WAIT.refundByHand}`);
  assert.equal(reasonOf(b, "R1"), `wait:${SALES_WAIT.refundBeyondBill}`);
  for (const steps of [a, b]) assert.ok(!steps.some((s) => s.op === "wait" && s.reason === SALES_WAIT.paymentFirst));
});

test("round 9: twins pair only with a payment the CRM kept, in any id order, one each", () => {
  const { invRec, p1, p1Rec, r1 } = twinBase();
  // Three of $9,000: P1 (in QuickBooks) and one card refunded; the other card kept.
  for (const [refunded, kept] of [["P2", "P3"], ["P3", "P2"]]) {
    const cards = [money({ id: "P2", method: "card", source: "stripe", reference: null, paidAt: "2026-10-08T18:00:00Z" }), money({ id: "P3", method: "card", source: "stripe", reference: null, paidAt: "2026-10-08T18:01:00Z" })];
    const back = money({ id: "R9", amountCents: -900_000, refundOf: refunded, stillOwed: false, source: "stripe", method: "card", reference: null, paidAt: "2026-10-09T20:00:00Z" });
    const steps = plan({ stages: [stage()], money: [p1, ...cards, r1, back], records: [invRec, p1Rec] });
    assert.equal(reasonOf(steps, kept), `unneeded:${SALES_WAIT.paidTwice}`, `kept ${kept}`);
    assert.equal(reasonOf(steps, "R1"), `unneeded:${SALES_WAIT.paidTwice}`);
    assert.equal(reasonOf(steps, refunded), `unneeded:${SALES_WAIT.refundedAway}`);
    assert.equal(reasonOf(steps, "R9"), `unneeded:${SALES_WAIT.refundedAway}`);
  }
  // Two pairs on an $18,000 stage.
  const big = stage({ amountCents: 1_800_000 });
  const spec = find(plan({ stages: [big] }), "create_invoice").spec;
  const bigRec = rec({ qb_hash: invoiceHash(spec) });
  const q2 = money({ id: "Q2", reference: "2088", paidAt: "2026-10-07T19:30:00Z" });
  const q2Rec = rec({ record_type: "customer_payment", record_id: "Q2", bill_id: "S1", qb_id: "601", qb_hash: paymentHash(q2, { type: "invoice", id: "S1" }, day(q2.paidAt ?? "")) });
  const rq2 = money({ id: "RQ2", amountCents: -900_000, refundOf: "Q2", stillOwed: false, paidAt: "2026-10-09T19:30:00Z" });
  const c3 = money({ id: "C3", method: "card", source: "stripe", reference: null, paidAt: "2026-10-08T19:00:00Z" });
  const c4 = money({ id: "C4", method: "card", source: "stripe", reference: null, paidAt: "2026-10-08T19:05:00Z" });
  const two = plan({ stages: [big], money: [p1, q2, c3, c4, r1, rq2], records: [bigRec, p1Rec, q2Rec] });
  for (const id of ["C3", "C4", "R1", "RQ2"]) assert.equal(reasonOf(two, id), `unneeded:${SALES_WAIT.paidTwice}`, id);
  // Voided, both refunded: nothing was kept, so no stand-in.
  const p2 = money({ id: "P2", paidAt: "2026-10-08T19:00:00Z" });
  const r2 = money({ id: "R2", amountCents: -900_000, refundOf: "P2", stillOwed: false, paidAt: "2026-10-10T19:00:00Z" });
  const voidRec = { ...invRec, status: "waiting" as const, reason: SALES_WAIT.voidedWithMoney };
  const v = plan({ docs: [contract({ depositCents: 0, status: "Void" })], stages: [stage()], money: [p1, p2, r1, r2], records: [voidRec, p1Rec] });
  assert.equal(reasonOf(v, "R1"), `wait:${SALES_WAIT.refundOnVoided}`);
});

test("round 9: a payment already handed over to be entered by hand stays so, and so do its new refunds", () => {
  const { invRec, p1, p1Rec } = twinBase();
  const p2 = money({ id: "P2", paidAt: "2026-10-08T19:00:00Z" });
  const r2a = money({ id: "R2a", amountCents: -200_000, refundOf: "P2", stillOwed: false, paidAt: "2026-10-09T19:00:00Z" });
  const r2b = money({ id: "R2b", amountCents: -700_000, refundOf: "P2", stillOwed: false, paidAt: "2026-10-10T19:00:00Z" });
  const first = plan({ stages: [stage()], money: [p1, p2, r2a], records: [invRec, p1Rec] });
  assert.equal(reasonOf(first, "P2"), `wait:${SALES_WAIT.refundedExtra}`);
  const told = rec({ record_type: "customer_payment", record_id: "P2", bill_id: "S1", qb_id: null, status: "waiting", reason: SALES_WAIT.refundedExtra });
  const later = plan({ stages: [stage()], money: [p1, p2, r2a, r2b], records: [invRec, p1Rec, told] });
  assert.equal(reasonOf(later, "P2"), "none");
  assert.equal(reasonOf(later, "R2a"), `wait:${SALES_WAIT.refundByHand}`);
  assert.equal(reasonOf(later, "R2b"), `wait:${SALES_WAIT.refundByHand}`);
  // Never told: refunded in full, nothing to send.
  const fresh = plan({ stages: [stage()], money: [p1, p2, r2a, r2b], records: [invRec, p1Rec] });
  assert.equal(reasonOf(fresh, "P2"), `unneeded:${SALES_WAIT.refundedAway}`);
});

test("round 9: a voided bill in QuickBooks whose only money came in and went straight back out (never sent) is voided", () => {
  const spec = find(plan({ stages: [stage()] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  const p = money({ method: "card", source: "stripe", reference: null });
  const r = money({ id: "R1", amountCents: -900_000, refundOf: "P1", stillOwed: false, source: "stripe", method: "card", reference: null, paidAt: "2026-10-09T19:00:00Z" });
  const steps = plan({ docs: [contract({ depositCents: 0, status: "Void" })], stages: [stage()], money: [p, r], records: [invRec] });
  assert.deepEqual(ops(steps).filter((x) => x.startsWith("void_invoice") || x.startsWith("wait:invoice")), ["void_invoice:invoice:S1"]);
  // The same money in QuickBooks: the invoice stays (voiding would leave the payment as loose credit there).
  const pRec = rec({ record_type: "customer_payment", record_id: "P1", bill_id: "S1", qb_id: "600", qb_hash: paymentHash(p, { type: "invoice", id: "S1" }, day(p.paidAt ?? "")) });
  const kept = plan({ docs: [contract({ depositCents: 0, status: "Void" })], stages: [stage()], money: [p, r], records: [invRec, pRec] });
  assert.equal(reasonOf(kept, "S1"), `wait:${SALES_WAIT.voidedWithMoney}`);
});

test("round 9: the hand-entry words for a refunded payment are true when only the payments together went over the bill", () => {
  for (const text of [SALES_WAIT.refundedExtra, SALES_WAIT.overpaidRefunded]) assert.doesNotMatch(text, /this payment was more than/i, text);
});

test("round 10: a payment told to be entered by hand (before the start date, or in closed books) is never a twin", () => {
  const { invRec, p1, p1Rec, r1 } = twinBase();
  // A check received before sending started, recorded late, on the same bill.
  const early = money({ id: "P2", paidAt: "2026-09-30T19:00:00Z" });
  const a = plan({ stages: [stage()], money: [p1, early, r1], records: [invRec, p1Rec] });
  assert.equal(reasonOf(a, "P2"), `wait:${SALES_WAIT.beforeStart(FROM)}`);
  assert.equal(reasonOf(a, "R1"), `wait:${SALES_WAIT.refundBeyondBill}`);
  // A check dated in a month whose books are closed.
  const closedCheck = money({ id: "P2", paidAt: "2026-10-03T19:00:00Z" });
  const b = plan({ stages: [stage()], money: [p1, closedCheck, r1], records: [invRec, p1Rec], prefs: { bookCloseDate: "2026-10-04" } });
  assert.ok(reasonOf(b, "P2").startsWith("wait:"), reasonOf(b, "P2"));
  assert.equal(reasonOf(b, "R1"), `wait:${SALES_WAIT.refundBeyondBill}`);
  // Already told (closed books, since reopened): still never a twin.
  const told = rec({ record_type: "customer_payment", record_id: "P2", bill_id: "S1", qb_id: null, status: "waiting", reason: SALES_WAIT.closedByHand("2026-10-04") });
  const c = plan({ stages: [stage()], money: [p1, closedCheck, r1], records: [invRec, p1Rec, told] });
  assert.equal(reasonOf(c, "R1"), `wait:${SALES_WAIT.refundBeyondBill}`);
  assert.notEqual(reasonOf(c, "P2"), `unneeded:${SALES_WAIT.paidTwice}`);
});

test("round 10: a payment never sent and refunded in full as still owed (a bounce, or any deposit refund) needs nothing, nor its refund", () => {
  // A deposit paid twice (two tabs), the duplicate refunded: deposit refunds are always 'still owed' and file no credit.
  const docs = [contract({ depositCents: 100_000 })];
  const dSpec = find(plan({ docs }), "create_invoice").spec;
  const dRec = rec({ record_type: "deposit", record_id: "C1", bill_id: "C1", qb_hash: invoiceHash(dSpec) });
  const d1 = money({ stageId: null, amountCents: 100_000, method: "card", source: "stripe", reference: null, paidAt: "2026-10-01T19:00:00Z" });
  const d1Rec = rec({ record_type: "customer_payment", record_id: "P1", bill_id: "C1", qb_id: "600", qb_hash: paymentHash(d1, { type: "deposit", id: "C1" }, "2026-10-01") });
  const d2 = money({ id: "P2", stageId: null, amountCents: 100_000, method: "card", source: "stripe", reference: null, paidAt: "2026-10-01T19:02:00Z" });
  const back = money({ id: "R2", stageId: null, amountCents: -100_000, refundOf: "P2", stillOwed: true, source: "stripe", method: "card", reference: null, paidAt: "2026-10-02T19:00:00Z" });
  const steps = plan({ docs, money: [d1, d2, back], records: [dRec, d1Rec] });
  assert.deepEqual(ops(steps), ["unneeded:customer_payment:P2", "unneeded:refund:R2"]);
  // A check that bounced before it went: nothing goes (the invoice stays open in QuickBooks, as the CRM has it owed).
  const spec = find(plan({ stages: [stage()] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  const bounce = money({ id: "R1", amountCents: -900_000, refundOf: "P1", stillOwed: true, note: "Check returned", paidAt: "2026-10-08T19:00:00Z" });
  assert.deepEqual(ops(plan({ stages: [stage()], money: [money(), bounce], records: [invRec] })), ["unneeded:customer_payment:P1", "unneeded:refund:R1"]);
  // Part of it bounced: the payment goes and the refund waits, owed again (as before).
  const part = { ...bounce, amountCents: -300_000 };
  assert.deepEqual(ops(plan({ stages: [stage()], money: [money(), part], records: [invRec] })), ["create_payment:P1", "wait:refund:R1"]);
  // A voided contract whose deposit was refunded in full before its invoice went: nothing to enter by hand.
  const voided = [contract({ depositCents: 100_000, status: "Void" })];
  const r1 = money({ id: "R1", stageId: null, amountCents: -100_000, refundOf: "P1", stillOwed: true, source: "stripe", method: "card", reference: null, paidAt: "2026-10-02T19:00:00Z" });
  assert.deepEqual(ops(plan({ docs: voided, money: [d1, r1] })), []);
});

test("round 10: the by-hand words claim no 'part' they can't know", () => {
  assert.doesNotMatch(SALES_WAIT.overpaidRefunded, /part of this payment/i);
  assert.doesNotMatch(SALES_WAIT.refundOwedAgain, /^Only part/i);
});

test("round 11: a refund told to be entered by hand stays so: a later payment never pairs it away", () => {
  const { invRec, p1, p1Rec, r1 } = twinBase();
  // R1 was told to be entered by hand (a twin bounced since); a new check of the same amount arrives.
  const told = rec({ record_type: "refund", record_id: "R1", bill_id: "S1", qb_id: null, status: "waiting", reason: SALES_WAIT.refundOwedAgain });
  const pt = money({ id: "P2", paidAt: "2026-10-08T19:00:00Z" });
  const bounce = money({ id: "RB", amountCents: -900_000, refundOf: "P2", stillOwed: true, paidAt: "2026-10-10T19:00:00Z" });
  const pv = money({ id: "P3", reference: "2201", paidAt: "2026-10-11T19:00:00Z" });
  const steps = plan({ stages: [stage()], money: [p1, pt, bounce, pv, r1], records: [invRec, p1Rec, told] });
  assert.equal(reasonOf(steps, "R1"), "none");
  assert.equal(reasonOf(steps, "P3"), `wait:${SALES_WAIT.paidAfterRefund}`);
});

test("round 11: a payment dated in closed books waits to be entered by hand, and stays so: a bounce, a refund or reopened books never flip it", () => {
  const spec = find(plan({ stages: [stage()] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  const p1 = money({ paidAt: "2026-10-06T19:00:00Z" });
  const first = plan({ stages: [stage()], money: [p1], records: [invRec], prefs: { bookCloseDate: "2026-10-06" } });
  assert.equal(reasonOf(first, "P1"), `wait:${SALES_WAIT.closedByHand("2026-10-06")}`);
  const told = rec({ record_type: "customer_payment", record_id: "P1", bill_id: "S1", qb_id: null, status: "waiting", reason: SALES_WAIT.closedByHand("2026-10-06") });
  // It bounces: neither is noted as needing nothing.
  const bounce = money({ id: "RB", amountCents: -900_000, refundOf: "P1", stillOwed: true, paidAt: "2026-10-10T19:00:00Z" });
  const a = plan({ stages: [stage()], money: [p1, bounce], records: [invRec, told], prefs: { bookCloseDate: "2026-10-06" } });
  assert.equal(reasonOf(a, "P1"), "none");
  assert.equal(reasonOf(a, "RB"), `wait:${SALES_WAIT.refundByHand}`);
  // $500 of it refunded (with its credit): the refund is entered by hand too, never "waits for its payment".
  const part = money({ id: "R5", amountCents: -50_000, refundOf: "P1", stillOwed: false, paidAt: "2026-10-10T19:00:00Z" });
  const filed = credit({ id: "K5", docId: "C1", stageId: "S1", amountCents: 50_000, fromRefund: true, refundId: "R5" });
  const b = plan({ stages: [stage()], money: [p1, part], credits: [filed], records: [invRec, told], prefs: { bookCloseDate: "2026-10-06" } });
  assert.equal(reasonOf(b, "R5"), `wait:${SALES_WAIT.refundByHand}`);
  // Told in the same run: its refund says so at once.
  const c = plan({ stages: [stage()], money: [p1, part], credits: [filed], records: [invRec], prefs: { bookCloseDate: "2026-10-06" } });
  assert.equal(reasonOf(c, "R5"), `wait:${SALES_WAIT.refundByHand}`);
  // The month reopened: it still isn't sent (it may be there by hand).
  assert.ok(!plan({ stages: [stage()], money: [p1], records: [invRec, told] }).some((x) => x.op === "create_payment"));
});

test("round 11: a settled twin pairing holds when the books close on its date, and is preferred over a newcomer", () => {
  const { invRec, p1, p1Rec, r1 } = twinBase();
  const pt = money({ id: "P2", paidAt: "2026-10-08T19:00:00Z" });
  const noted = (t: "customer_payment" | "refund", id: string) => rec({ record_type: t, record_id: id, bill_id: "S1", qb_id: null, status: "removed", reason: SALES_WAIT.paidTwice });
  const records = [invRec, p1Rec, noted("customer_payment", "P2"), noted("refund", "R1")];
  assert.deepEqual(ops(plan({ stages: [stage()], money: [p1, pt, r1], records, prefs: { bookCloseDate: "2026-10-31" } })), []);
  // A newcomer of the same amount that sorts first: the settled twin keeps its pairing; the newcomer waits by hand.
  const pa = money({ id: "P0", reference: "3001", paidAt: "2026-10-12T19:00:00Z" });
  const steps = plan({ stages: [stage()], money: [p1, pa, pt, r1], records });
  assert.equal(reasonOf(steps, "P2"), "none");
  assert.equal(reasonOf(steps, "R1"), "none");
  // Round 15: the pairing accounts for the refund, so the newcomer is a plain overpayment (not by hand).
  assert.equal(reasonOf(steps, "P0"), `wait:${SALES_WAIT.overpaid}`);
});

test("round 11: a stage never billed whose only money came in and went back out isn't a bill: never created, and taken back out", () => {
  const unbilled = stage({ requestedAt: null, dueDate: null });
  const p = money({ paidAt: "2026-10-03T19:00:00Z" });
  const bounce = money({ id: "RB", amountCents: -900_000, refundOf: "P1", stillOwed: true, paidAt: "2026-10-05T19:00:00Z" });
  assert.deepEqual(ops(plan({ stages: [unbilled], money: [p, bounce] })), []);
  // It went to QuickBooks while the money was there (the payment didn't): it comes back out.
  const spec = find(plan({ stages: [unbilled], money: [p] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  assert.ok(ops(plan({ stages: [unbilled], money: [p, bounce], records: [invRec] })).includes("delete_invoice:invoice:S1"));
});

test("round 11: a deposit overpaid with the extra given back (always 'still owed') waits to be entered by hand, with its refund", () => {
  const docs = [contract({ depositCents: 100_000 })];
  const dSpec = find(plan({ docs }), "create_invoice").spec;
  const dRec = rec({ record_type: "deposit", record_id: "C1", bill_id: "C1", qb_hash: invoiceHash(dSpec) });
  const d = money({ stageId: null, amountCents: 120_000, paidAt: "2026-10-01T19:00:00Z" });
  const back = money({ id: "R1", stageId: null, amountCents: -20_000, refundOf: "P1", stillOwed: true, paidAt: "2026-10-02T19:00:00Z" });
  const steps = plan({ docs, money: [d, back], records: [dRec] });
  assert.equal(reasonOf(steps, "P1"), `wait:${SALES_WAIT.refundedExtra}`);
  assert.equal(reasonOf(steps, "R1"), `wait:${SALES_WAIT.refundByHand}`);
});

test("round 12: a bill told to be entered by hand stays so, with what's on it, whatever comes after (a full refund, reopened books)", () => {
  // Voided before its deposit went, money on it: told. Then the deposit is refunded in full.
  const docs = [contract({ depositCents: 100_000, status: "Void" })];
  const d1 = money({ stageId: null, amountCents: 100_000, paidAt: "2026-10-02T19:00:00Z" });
  const told = (t: "deposit" | "customer_payment" | "invoice", id: string, reason: string, bill = "C1") => rec({ record_type: t, record_id: id, bill_id: bill, qb_id: null, status: "waiting", reason });
  const rd = money({ id: "RD", stageId: null, amountCents: -100_000, refundOf: "P1", stillOwed: true, paidAt: "2026-10-09T19:00:00Z" });
  const a = plan({ docs, money: [d1, rd], records: [told("deposit", "C1", SALES_WAIT.voidedUnsent), told("customer_payment", "P1", SALES_WAIT.voidedUnsentChild)] });
  assert.deepEqual(ops(a), ["wait:refund:RD"]);
  assert.equal(reasonOf(a, "RD"), `wait:${SALES_WAIT.voidedUnsentChild}`);
  // A stage dated in closed books: by hand, and what's paid on it too; reopening never sends it.
  const s2 = stage({ requestedAt: "2026-10-02T17:00:00Z" });
  const p1 = money({ paidAt: "2026-10-07T19:00:00Z" });
  const b = plan({ stages: [s2], money: [p1], prefs: { bookCloseDate: "2026-10-03" } });
  assert.equal(reasonOf(b, "S1"), `wait:${SALES_WAIT.closedByHand("2026-10-03")}`);
  assert.equal(reasonOf(b, "P1"), `wait:${SALES_WAIT.billByHandChild}`);
  const reopened = plan({ stages: [s2], money: [p1], records: [told("invoice", "S1", SALES_WAIT.closedByHand("2026-10-03"), "S1"), told("customer_payment", "P1", SALES_WAIT.billByHandChild, "S1")] });
  assert.deepEqual(ops(reopened), []);
  // Taken back in the CRM (un-billed, no money) after it was told: say to take it out of QuickBooks if it went in.
  const back = plan({ stages: [stage({ requestedAt: null, dueDate: null })], records: [told("invoice", "S1", SALES_WAIT.closedByHand("2026-10-03"), "S1")] });
  assert.equal(reasonOf(back, "S1"), `wait:${SALES_WAIT.undoTakenBack}`);
});

test("round 12: a payment told to be entered by hand for its date stays so when the start date moves earlier, and holds its bill's balance", () => {
  const spec = find(plan({ stages: [stage()] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  const p1 = money({ paidAt: "2026-10-05T19:00:00Z" });
  const told = rec({ record_type: "customer_payment", record_id: "P1", bill_id: "S1", qb_id: null, status: "waiting", reason: SALES_WAIT.beforeStart("2026-10-06") });
  const r1 = money({ id: "R1", amountCents: -50_000, refundOf: "P1", stillOwed: false, paidAt: "2026-10-09T19:00:00Z" });
  const k1 = credit({ id: "K1R", docId: "C1", stageId: "S1", amountCents: 50_000, fromRefund: true, refundId: "R1" });
  const a = plan({ stages: [stage()], money: [p1, r1], credits: [k1], records: [invRec, told] });
  assert.ok(!a.some((x) => x.op === "create_payment"));
  assert.equal(reasonOf(a, "R1"), `wait:${SALES_WAIT.refundByHand}`);
  // Closed books: a second card payment of the same amount is more than what's left (the first goes on by hand).
  const card = money({ id: "P2", method: "card", source: "stripe", reference: null, paidAt: "2026-10-07T19:00:00Z" });
  const b = plan({ stages: [stage()], money: [money({ paidAt: "2026-10-03T19:00:00Z" }), card], records: [invRec], prefs: { bookCloseDate: "2026-10-04" } });
  assert.equal(reasonOf(b, "P2"), `wait:${SALES_WAIT.overpaidCard}`);
});

test("round 12: a refund that failed after it was told to be entered by hand says to take it out; one never told is forgotten; a pending one waits to go through", () => {
  const spec = find(plan({ stages: [stage()] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  const p1 = money({ paidAt: "2026-10-03T19:00:00Z" });
  const pTold = rec({ record_type: "customer_payment", record_id: "P1", bill_id: "S1", qb_id: null, status: "waiting", reason: SALES_WAIT.closedByHand("2026-10-04") });
  const r = (status: SyncMoney["status"]) => money({ id: "R1", amountCents: -50_000, refundOf: "P1", stillOwed: null, status, source: "stripe", method: "card", reference: null, paidAt: "2026-10-09T19:00:00Z" });
  const rTold = rec({ record_type: "refund", record_id: "R1", bill_id: "S1", qb_id: null, status: "waiting", reason: SALES_WAIT.refundByHand });
  const prefs = { bookCloseDate: "2026-10-04" };
  assert.equal(reasonOf(plan({ stages: [stage()], money: [p1, r("failed")], records: [invRec, pTold, rTold], prefs }), "R1"), `wait:${SALES_WAIT.undoFailed}`);
  assert.equal(reasonOf(plan({ stages: [stage()], money: [p1, r("failed")], records: [invRec, pTold], prefs }), "R1"), "none");
  assert.equal(reasonOf(plan({ stages: [stage()], money: [p1, r("pending")], records: [invRec, pTold], prefs }), "R1"), `wait:${SALES_WAIT.refundPending}`);
  // A payment told by hand that fails (an ACH returned): take it out of QuickBooks if it went in.
  assert.equal(reasonOf(plan({ stages: [stage()], money: [{ ...p1, status: "failed" }], records: [invRec, pTold], prefs }), "P1"), `wait:${SALES_WAIT.undoFailed}`);
});

test("round 12: a refund dated in closed books is entered by hand and stays so; a duplicate's undecided refund waits for its answer", () => {
  const spec = find(plan({ stages: [stage()] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  const p1 = money();
  const p1Rec = rec({ record_type: "customer_payment", record_id: "P1", bill_id: "S1", qb_id: "600", qb_hash: paymentHash(p1, { type: "invoice", id: "S1" }, day(p1.paidAt ?? "")) });
  const r1 = money({ id: "R1", amountCents: -50_000, refundOf: "P1", stillOwed: false, paidAt: "2026-10-04T19:00:00Z" });
  const k1 = credit({ id: "K1R", docId: "C1", stageId: "S1", amountCents: 50_000, fromRefund: true, refundId: "R1" });
  const a = plan({ stages: [stage()], money: [p1, r1], credits: [k1], records: [invRec, p1Rec], prefs: { bookCloseDate: "2026-10-06" } });
  assert.equal(reasonOf(a, "R1"), `wait:${SALES_WAIT.closedByHand("2026-10-06")}`);
  const rTold = rec({ record_type: "refund", record_id: "R1", bill_id: "S1", qb_id: null, status: "waiting", reason: SALES_WAIT.closedByHand("2026-10-06") });
  assert.deepEqual(ops(plan({ stages: [stage()], money: [p1, r1], credits: [k1], records: [invRec, p1Rec, rTold] })), []);
  // A duplicate card charge, refunded at Stripe, waiting for "Still owed?".
  const dup = money({ id: "P2", method: "card", source: "stripe", reference: null, paidAt: "2026-10-08T19:00:00Z" });
  const rd = money({ id: "RD", amountCents: -900_000, refundOf: "P2", stillOwed: null, source: "stripe", method: "card", reference: null, paidAt: "2026-10-09T19:00:00Z" });
  const b = plan({ stages: [stage()], money: [p1, dup, rd], records: [invRec, p1Rec] });
  assert.equal(reasonOf(b, "RD"), `wait:${SALES_WAIT.undecided}`);
  // Round 14: the duplicate waits for that answer, never "more than what's left" meanwhile.
  assert.equal(reasonOf(b, "P2"), `wait:${SALES_WAIT.otherRefundOpen}`);
  assert.equal(reasonOf(plan({ stages: [stage()], money: [p1, dup, { ...rd, status: "pending" }], records: [invRec, p1Rec] }), "RD"), `wait:${SALES_WAIT.refundPending}`);
});

test("round 12: a refund that went to QuickBooks with all of it taken off isn't 'QuickBooks still has the bill paid by a refunded payment'", () => {
  const spec = find(plan({ stages: [stage({ amountCents: 150_000 })] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  const p1 = money({ amountCents: 150_000 });
  const p1Rec = rec({ record_type: "customer_payment", record_id: "P1", bill_id: "S1", qb_id: "600", qb_hash: paymentHash(p1, { type: "invoice", id: "S1" }, day(p1.paidAt ?? "")) });
  const r1 = money({ id: "R1", amountCents: -150_000, refundOf: "P1", stillOwed: false, paidAt: "2026-10-08T19:00:00Z" });
  const k1 = credit({ id: "K1R", docId: "C1", stageId: "S1", amountCents: 150_000, fromRefund: true, refundId: "R1" });
  const r1Rec = rec({ record_type: "refund", record_id: "R1", bill_id: "S1", qb_id: "700" });
  const dup = money({ id: "P2", amountCents: 150_000, method: "card", source: "stripe", reference: null, paidAt: "2026-10-09T19:00:00Z" });
  const steps = plan({ stages: [stage({ amountCents: 150_000 })], money: [p1, r1, dup], credits: [k1], records: [invRec, p1Rec, r1Rec] });
  assert.equal(reasonOf(steps, "P2"), `wait:${SALES_WAIT.overpaidCard}`);
});

test("round 12: a payment told to be entered by hand keeps its line when its voided bill leaves QuickBooks", () => {
  const removed = rec({ qb_id: null, status: "removed" });
  const p = money({ amountCents: 450_000 });
  const pTold = rec({ record_type: "customer_payment", record_id: "P1", bill_id: "S1", qb_id: null, status: "waiting", reason: SALES_WAIT.refundedExtra });
  const r1 = money({ id: "R1", amountCents: -50_000, refundOf: "P1", stillOwed: false, paidAt: "2026-10-08T19:00:00Z" });
  const r2 = money({ id: "R2", amountCents: -400_000, refundOf: "P1", stillOwed: false, paidAt: "2026-10-09T19:00:00Z" });
  const steps = plan({ docs: [contract({ depositCents: 0, status: "Void" })], stages: [stage({ amountCents: 400_000 })], money: [p, r1, r2], records: [removed, pTold] });
  assert.ok(!steps.some((x) => x.op === "drop" && x.recordId === "P1"), JSON.stringify(ops(steps)));
});

test("round 13: a payment held by hand for its day that bounces or is refunded: the next payment is told by hand, never 'overpaid'", () => {
  const spec = find(plan({ stages: [stage()] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  const prefs = { bookCloseDate: "2026-10-04" };
  const p1 = money({ paidAt: "2026-10-03T19:00:00Z" });
  const told = rec({ record_type: "customer_payment", record_id: "P1", bill_id: "S1", qb_id: null, status: "waiting", reason: SALES_WAIT.closedByHand("2026-10-04") });
  // It bounces; the customer pays again online.
  const bounce = money({ id: "RB", amountCents: -900_000, refundOf: "P1", stillOwed: true, paidAt: "2026-10-06T19:00:00Z" });
  const p2 = money({ id: "P2", method: "card", source: "stripe", reference: null, paidAt: "2026-10-07T19:00:00Z" });
  assert.equal(reasonOf(plan({ stages: [stage()], money: [p1, bounce, p2], records: [invRec, told], prefs }), "P2"), `wait:${SALES_WAIT.paidAgain}`);
  // Bounced before it was ever told (in and back out): it holds nothing, and the new payment goes.
  assert.ok(ops(plan({ stages: [stage()], money: [p1, bounce, p2], records: [invRec], prefs })).includes("create_payment:P2"));
  // Refunded instead (not owed, nothing taken off: the card covers the bill).
  const back = money({ id: "R1", amountCents: -900_000, refundOf: "P1", stillOwed: false, paidAt: "2026-10-08T19:00:00Z" });
  assert.equal(reasonOf(plan({ stages: [stage()], money: [p1, p2, back], records: [invRec, told], prefs }), "P2"), `wait:${SALES_WAIT.paidAfterRefund}`);
  // A check from before the start date that bounced before anything was sent holds nothing: the new payment goes.
  const early = money({ paidAt: "2026-09-28T19:00:00Z" });
  const gone = money({ id: "RB", amountCents: -900_000, refundOf: "P1", stillOwed: true, paidAt: "2026-09-30T19:00:00Z" });
  const z = money({ id: "P2", method: "zelle", reference: null, paidAt: "2026-10-05T19:00:00Z" });
  assert.ok(ops(plan({ stages: [stage()], money: [early, gone, z], records: [invRec] })).includes("create_payment:P2"));
});

test("round 13: 'take it out of QuickBooks' stays; something told by hand and then deleted or removed in the CRM says so too", () => {
  const told = (t: "invoice" | "customer_payment" | "refund" | "credit", id: string, reason: string) => rec({ record_type: t, record_id: id, bill_id: "S1", qb_id: null, status: "waiting", reason, tried_hash: "h" });
  // The bill's note survives the next run.
  const unbilled = stage({ requestedAt: null, dueDate: null });
  assert.deepEqual(ops(plan({ stages: [unbilled], records: [told("invoice", "S1", SALES_WAIT.undoTakenBack)] })), []);
  // Billed again: still by hand (it may still be there).
  const again = plan({ stages: [stage()], records: [told("invoice", "S1", SALES_WAIT.undoTakenBack)] });
  assert.equal(reasonOf(again, "S1"), `wait:${SALES_WAIT.handAgain}`);
  // A payment told by hand, deleted in the CRM.
  const spec = find(plan({ stages: [stage()] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  const del = plan({ stages: [stage()], records: [invRec, told("customer_payment", "P9", SALES_WAIT.closedByHand("2026-10-04"))] });
  assert.equal(reasonOf(del, "P9"), `wait:${SALES_WAIT.undoTakenBack}`);
  assert.deepEqual(ops(plan({ stages: [stage()], records: [invRec, told("customer_payment", "P9", SALES_WAIT.undoTakenBack)] })), []);
  // A refund told by hand, removed in the CRM.
  const p1 = money();
  const p1Rec = rec({ record_type: "customer_payment", record_id: "P1", bill_id: "S1", qb_id: "600", qb_hash: paymentHash(p1, { type: "invoice", id: "S1" }, day(p1.paidAt ?? "")) });
  assert.equal(reasonOf(plan({ stages: [stage()], money: [p1], records: [invRec, p1Rec, told("refund", "R9", SALES_WAIT.owedAgain)] }), "R9"), `wait:${SALES_WAIT.undoTakenBack}`);
  // A credit told by hand (closed books), then removed; and one gone from the CRM altogether.
  const k = credit({ id: "K1", docId: "C1", stageId: "S1", amountCents: 50_000, removed: true });
  assert.equal(reasonOf(plan({ stages: [stage()], credits: [k], records: [invRec, told("credit", "K1", SALES_WAIT.closedByHand("2026-10-04"))] }), "K1"), `wait:${SALES_WAIT.undoTakenBack}`);
  assert.equal(reasonOf(plan({ stages: [stage()], records: [invRec, told("credit", "K2", SALES_WAIT.closedByHand("2026-10-04"))] }), "K2"), `wait:${SALES_WAIT.undoTakenBack}`);
});

test("round 13: an unanswered refund of a payment told by hand waits for its answer first; a credit in closed books holds its bill's balance", () => {
  const spec = find(plan({ stages: [stage()] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  const prefs = { bookCloseDate: "2026-10-04" };
  const p1 = money({ method: "card", source: "stripe", reference: null, paidAt: "2026-10-03T19:00:00Z" });
  const told = rec({ record_type: "customer_payment", record_id: "P1", bill_id: "S1", qb_id: null, status: "waiting", reason: SALES_WAIT.closedByHand("2026-10-04") });
  const r = money({ id: "R1", amountCents: -50_000, refundOf: "P1", stillOwed: null, source: "stripe", method: "card", reference: null, paidAt: "2026-10-08T19:00:00Z" });
  assert.equal(reasonOf(plan({ stages: [stage()], money: [p1, r], records: [invRec, told], prefs }), "R1"), `wait:${SALES_WAIT.undecided}`);
  // A $500 credit dated in closed books, then a check for the full $9,000: more than what's left.
  const k = credit({ id: "K1", docId: "C1", stageId: "S1", amountCents: 50_000, createdAt: "2026-10-03T20:00:00Z" });
  const check = money({ id: "P2", paidAt: "2026-10-07T19:00:00Z" });
  const steps = plan({ stages: [stage()], money: [check], credits: [k], records: [invRec], prefs });
  assert.equal(reasonOf(steps, "K1"), `wait:${SALES_WAIT.closedByHand("2026-10-04")}`);
  assert.equal(reasonOf(steps, "P2"), `wait:${SALES_WAIT.overpaid}`);
});

test("round 14: a taxed change order billed both ways is entered by hand once: the side that doesn't go says so", () => {
  const co = contract({ id: "CO1", kind: "change_order", docNumber: "EST-1047-CO1", title: "Add a window", parentId: "C1", depositCents: 0, totalCents: 128_700, taxCents: 8_700, signedAt: "2026-10-04T18:00:00Z" });
  const coStage = stage({ id: "CS1", docId: "CO1", name: "Window", description: null, amountCents: 128_700, requestedAt: "2026-10-05T17:00:00Z" });
  const mirror = stage({ id: "M1", docId: "C1", sortOrder: 3, name: "EST-1047-CO1", description: "Add a window", amountCents: 128_700, requestedAt: "2026-10-06T17:00:00Z" });
  const steps = plan({ docs: [contract({ depositCents: 0 }), co], stages: [coStage, mirror] });
  assert.equal(reasonOf(steps, "CS1"), `wait:${SALES_WAIT.taxed}`);
  assert.equal(reasonOf(steps, "M1"), `wait:${SALES_WAIT.coGoesOwn}`);
});

test("round 14: a contact deleted in the CRM leaves its by-hand lines as they are (never 'take it out' for half of it)", () => {
  const told = rec({ record_type: "customer_payment", record_id: "P9", bill_id: "S9", qb_id: null, status: "waiting", reason: SALES_WAIT.closedByHand("2026-10-04"), tried_hash: "h" });
  const about = (steps: SalesStep[], id: string) => ops(steps).filter((x) => x.endsWith(`:${id}`));
  assert.deepEqual(about(plan({ stages: [stage()], records: [told] }), "P9"), []);
  const toldRefund = { ...told, record_type: "refund" as const, record_id: "R9" };
  assert.deepEqual(about(plan({ stages: [stage()], records: [toldRefund] }), "R9"), []);
  const toldCredit = { ...told, record_type: "credit" as const, record_id: "K9" };
  assert.deepEqual(about(plan({ stages: [stage()], records: [toldCredit] }), "K9"), []);
});

test("round 14: while a refund on the bill is still going through or unanswered, nothing on it is told by hand yet", () => {
  const { invRec, p1, p1Rec, r1 } = twinBase();
  // A duplicate paid while the card's refund is unanswered: waits for that answer, never "more than what's left".
  const p2 = money({ id: "P2", paidAt: "2026-10-08T19:00:00Z" });
  const open = { ...r1, stillOwed: null };
  const a = plan({ stages: [stage()], money: [p1, p2, open], records: [invRec, p1Rec] });
  assert.equal(reasonOf(a, "P2"), `wait:${SALES_WAIT.otherRefundOpen}`);
  // A settled pairing holds while the twin's own refund is still going through.
  const noted = (t: "customer_payment" | "refund", id: string) => rec({ record_type: t, record_id: id, bill_id: "S1", qb_id: null, status: "removed", reason: SALES_WAIT.paidTwice });
  const r2 = money({ id: "R2", amountCents: -30_000, refundOf: "P2", stillOwed: null, status: "pending", source: "stripe", method: "card", reference: null, paidAt: "2026-10-10T19:00:00Z" });
  const b = plan({ stages: [stage()], money: [p1, p2, r1, r2], records: [invRec, p1Rec, noted("customer_payment", "P2"), noted("refund", "R1")] });
  assert.equal(reasonOf(b, "P2"), "none");
  assert.equal(reasonOf(b, "R1"), "none");
  assert.equal(reasonOf(b, "R2"), `wait:${SALES_WAIT.refundPending}`);
  // A short refund waits for another refund on the bill to settle before it's told by hand.
  const p3 = money({ id: "P3", amountCents: 300_000, method: "card", source: "stripe", reference: null, paidAt: "2026-10-08T19:00:00Z" });
  const r3 = money({ id: "R3", amountCents: -300_000, refundOf: "P1", stillOwed: false, paidAt: "2026-10-09T19:00:00Z" });
  const r4 = money({ id: "R4", amountCents: -10_000, refundOf: "P3", stillOwed: null, source: "stripe", method: "card", reference: null, paidAt: "2026-10-10T19:00:00Z" });
  const c = plan({ stages: [stage()], money: [p1, p3, r3, r4], records: [invRec, p1Rec] });
  assert.equal(reasonOf(c, "R3"), `wait:${SALES_WAIT.otherRefundOpen}`);
});

test("round 14: a card paid twice is refunded in Stripe, not 'in the CRM'", () => {
  assert.match(SALES_WAIT.overpaidCard, /Stripe/);
  assert.doesNotMatch(SALES_WAIT.overpaidCard, /in the CRM\./);
});

test("round 15: a settled twin pairing doesn't make a later overpayment on the bill 'paid after a refund'", () => {
  const { invRec, p1, p1Rec, r1 } = twinBase();
  const p2 = money({ id: "P2", paidAt: "2026-10-08T19:00:00Z" });
  const t2 = money({ id: "P3", method: "card", source: "stripe", reference: null, paidAt: "2026-10-10T19:00:00Z" });
  const steps = plan({ stages: [stage()], money: [p1, p2, t2, r1], records: [invRec, p1Rec] });
  assert.equal(reasonOf(steps, "P2"), `unneeded:${SALES_WAIT.paidTwice}`);
  assert.equal(reasonOf(steps, "P3"), `wait:${SALES_WAIT.overpaidCard}`);
});

test("round 15: a payment with a refund of its own still open isn't told by hand yet, whenever the run comes", () => {
  const { invRec, p1, p1Rec } = twinBase();
  // A double card charge refunded in two parts: the first answered (not owed, $0 credit), the second not yet.
  const t = money({ id: "T", method: "card", source: "stripe", reference: null, paidAt: "2026-10-08T19:00:00Z" });
  const ra = money({ id: "Ra", amountCents: -600_000, refundOf: "T", stillOwed: false, source: "stripe", method: "card", reference: null, paidAt: "2026-10-09T19:00:00Z" });
  const rb = money({ id: "Rb", amountCents: -300_000, refundOf: "T", stillOwed: null, source: "stripe", method: "card", reference: null, paidAt: "2026-10-09T19:05:00Z" });
  const a = plan({ stages: [stage()], money: [p1, t, ra, rb], records: [invRec, p1Rec] });
  assert.equal(reasonOf(a, "T"), `wait:${SALES_WAIT.otherRefundOpen}`);
  assert.equal(reasonOf(a, "Ra"), `wait:${SALES_WAIT.otherRefundOpen}`);
  assert.equal(reasonOf(a, "Rb"), `wait:${SALES_WAIT.undecided}`);
  // Answered: in and back out, nothing goes.
  const b = plan({ stages: [stage()], money: [p1, t, ra, { ...rb, stillOwed: false }], records: [invRec, p1Rec] });
  assert.equal(reasonOf(b, "T"), `unneeded:${SALES_WAIT.refundedAway}`);
  // From before the start date, its refund unanswered: waits (holding its bill), not told by hand yet.
  const early = money({ id: "E", method: "card", source: "stripe", reference: null, paidAt: "2026-09-29T19:00:00Z" });
  const re = money({ id: "RE", amountCents: -900_000, refundOf: "E", stillOwed: null, source: "stripe", method: "card", reference: null, paidAt: "2026-10-02T19:00:00Z" });
  const spec = find(plan({ stages: [stage({ requestedAt: "2026-10-03T17:00:00Z" })] }), "create_invoice").spec;
  const c = plan({ stages: [stage({ requestedAt: "2026-10-03T17:00:00Z" })], money: [early, re], records: [rec({ qb_hash: invoiceHash(spec) })] });
  assert.equal(reasonOf(c, "E"), `wait:${SALES_WAIT.otherRefundOpen}`);
});

test("round 15: a voided bill not sent waits, not told by hand, while its money clears or its refund is unanswered", () => {
  const docs = [contract({ depositCents: 100_000, status: "Void" })];
  const d1 = money({ stageId: null, amountCents: 100_000, method: "card", source: "stripe", reference: null, paidAt: "2026-10-02T19:00:00Z" });
  const rd = money({ id: "RD", stageId: null, amountCents: -100_000, refundOf: "P1", stillOwed: null, source: "stripe", method: "card", reference: null, paidAt: "2026-10-05T19:00:00Z" });
  assert.equal(reasonOf(plan({ docs, money: [d1, rd] }), "C1"), `wait:${SALES_WAIT.voidedSettling}`);
  assert.equal(reasonOf(plan({ docs, money: [{ ...d1, status: "pending", paidAt: null }] }), "C1"), `wait:${SALES_WAIT.voidedSettling}`);
  assert.equal(reasonOf(plan({ docs, money: [d1] }), "C1"), `wait:${SALES_WAIT.voidedUnsent}`);
});

test("round 15: a credit QuickBooks' copy of the bill can't take (paid there, bounced since) is entered by hand, never half sent", () => {
  const spec = find(plan({ stages: [stage()] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  const p1 = money();
  const p1Rec = rec({ record_type: "customer_payment", record_id: "P1", bill_id: "S1", qb_id: "600", qb_hash: paymentHash(p1, { type: "invoice", id: "S1" }, day(p1.paidAt ?? "")) });
  const bounce = money({ id: "RB", amountCents: -400_000, refundOf: "P1", stillOwed: true, paidAt: "2026-10-08T19:00:00Z" });
  const k = credit({ id: "K1", docId: "C1", stageId: "S1", amountCents: 50_000, createdAt: "2026-10-09T19:00:00Z" });
  const steps = plan({ stages: [stage()], money: [p1, bounce], credits: [k], records: [invRec, p1Rec] });
  assert.equal(reasonOf(steps, "K1"), `wait:${SALES_WAIT.creditByHand}`);
  assert.ok(!steps.some((x) => x.op === "create_credit"));
});

test("round 15: a cancelled invoice is never called a voided contract", () => {
  const docs = [contract({ depositCents: 0 }), inv({ status: "Void" })];
  const spec = find(plan({ docs: [contract({ depositCents: 0 }), inv()], stages: [invStage()], lines: invLines }), "create_invoice").spec;
  const iRec = rec({ record_id: "IS1", bill_id: "IS1", qb_hash: invoiceHash(spec) });
  const p = money({ id: "PI", docId: "I1", stageId: "IS1", amountCents: 86_700 });
  const pRec = rec({ record_type: "customer_payment", record_id: "PI", bill_id: "IS1", qb_id: "601", qb_hash: paymentHash(p, { type: "invoice", id: "IS1" }, day(p.paidAt ?? "")) });
  const steps = plan({ docs, stages: [invStage()], lines: invLines, money: [p], records: [iRec, pRec] });
  assert.equal(reasonOf(steps, "IS1"), `wait:${SALES_WAIT.cancelledWithMoney}`);
  for (const t of [SALES_WAIT.cancelledWithMoney, SALES_WAIT.cancelledUnsent, SALES_WAIT.cancelledUnsentChild]) assert.doesNotMatch(t, /contract/);
});

test("round 16: a refund of a payment on an invoice gone from QuickBooks is left alone too", () => {
  const gone = rec({ status: "gone", qb_id: "500" });
  const p1 = money({ amountCents: 600_000 });
  const p1Rec = rec({ record_type: "customer_payment", record_id: "P1", bill_id: "S1", qb_id: "600", qb_hash: paymentHash(p1, { type: "invoice", id: "S1" }, day(p1.paidAt ?? "")) });
  const r1 = money({ id: "R1", amountCents: -600_000, refundOf: "P1", stillOwed: false, paidAt: "2026-10-09T19:00:00Z" });
  const k = credit({ id: "KR1", docId: "C1", stageId: "S1", amountCents: 600_000, fromRefund: true, refundId: "R1" });
  const steps = plan({ stages: [stage({ amountCents: 1_000_000 })], money: [p1, r1], credits: [k], records: [gone, p1Rec] });
  assert.equal(reasonOf(steps, "R1"), `wait:${SALES_WAIT.billGone}`);
  assert.ok(!steps.some((x) => x.op === "create_refund"));
});

test("round 16: a credit can't take what a payment held by hand for its day holds; edits to payments go first", () => {
  const spec = find(plan({ stages: [stage({ amountCents: 500_000 })] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  // $4,000 dated before the start date (held by hand), $1,000 card in QuickBooks bounced: a $1,000 credit can't apply there.
  const early = money({ amountCents: 400_000, paidAt: "2026-09-29T19:00:00Z" });
  const card = money({ id: "P2", amountCents: 100_000, method: "card", source: "stripe", reference: null, paidAt: "2026-10-03T19:00:00Z" });
  const cardRec = rec({ record_type: "customer_payment", record_id: "P2", bill_id: "S1", qb_id: "601", qb_hash: paymentHash(card, { type: "invoice", id: "S1" }, "2026-10-03") });
  const bounce = money({ id: "RB", amountCents: -100_000, refundOf: "P2", stillOwed: true, paidAt: "2026-10-05T19:00:00Z" });
  const k = credit({ id: "K1", docId: "C1", stageId: "S1", amountCents: 100_000, createdAt: "2026-10-06T19:00:00Z" });
  const a = plan({ stages: [stage({ amountCents: 500_000 })], money: [early, card, bounce], credits: [k], records: [invRec, cardRec] });
  assert.equal(reasonOf(a, "K1"), `wait:${SALES_WAIT.creditByHand}`);
  // A payment in QuickBooks lowered in the CRM, and a missed older check recorded: the change goes first.
  const fixed = money({ amountCents: 600_000 });
  const fixedRec = rec({ record_type: "customer_payment", record_id: "P1", bill_id: "S1", qb_id: "600", qb_hash: paymentHash(money(), { type: "invoice", id: "S1" }, day(fixed.paidAt ?? "")) });
  const missed = money({ id: "P0", amountCents: 300_000, reference: "2080", paidAt: "2026-10-05T19:00:00Z" });
  const spec9 = find(plan({ stages: [stage()] }), "create_invoice").spec;
  const b = ops(plan({ stages: [stage()], money: [missed, fixed], records: [rec({ qb_hash: invoiceHash(spec9) }), fixedRec] }));
  assert.ok(b.indexOf("update_payment:P1") >= 0 && b.indexOf("update_payment:P1") < b.indexOf("create_payment:P0"), b.join(","));
});

test("round 16: a told bill taken back whose only money came in and went back out says to take it out; words stay true", () => {
  const told = rec({ qb_id: null, status: "waiting", reason: SALES_WAIT.taxed });
  const p1 = money();
  const bounce = money({ id: "RB", amountCents: -900_000, refundOf: "P1", stillOwed: true, paidAt: "2026-10-08T19:00:00Z" });
  const steps = plan({ stages: [stage({ requestedAt: null, dueDate: null })], money: [p1, bounce], records: [told] });
  assert.equal(reasonOf(steps, "S1"), `wait:${SALES_WAIT.undoTakenBack}`);
  // A cancelled invoice whose money is still clearing says "invoice", never "contract".
  const docs = [contract({ depositCents: 0 }), inv({ status: "Void" })];
  const ach = money({ id: "PA", docId: "I1", stageId: "IS1", amountCents: 86_700, status: "pending", paidAt: null, method: "us_bank_account", source: "stripe", reference: null });
  const c = plan({ docs, stages: [invStage()], lines: invLines, money: [ach] });
  assert.equal(reasonOf(c, "IS1"), `wait:${SALES_WAIT.cancelledSettling}`);
  assert.doesNotMatch(SALES_WAIT.cancelledSettling, /contract/);
  assert.match(SALES_WAIT.refundedExtra, /some or all/);
});

test("round 17: a refund receipt in QuickBooks that later failed at Stripe is taken out, even when its payment stands for a twin", () => {
  const { invRec, p1, p1Rec } = twinBase();
  const r1 = money({ id: "R1", amountCents: -30_000, refundOf: "P1", stillOwed: false, status: "failed", source: "stripe", method: "card", reference: null, paidAt: "2026-10-08T19:00:00Z" });
  const r1Rec = rec({ record_type: "refund", record_id: "R1", bill_id: "S1", qb_id: "700" });
  const r2 = money({ id: "R2", amountCents: -900_000, refundOf: "P1", stillOwed: false, source: "stripe", method: "card", reference: null, paidAt: "2026-10-10T19:00:00Z" });
  const p2 = money({ id: "P2", paidAt: "2026-10-09T19:00:00Z" });
  const steps = plan({ stages: [stage()], money: [p1, p2, r1, r2], records: [invRec, p1Rec, r1Rec] });
  assert.ok(ops(steps).includes("delete_refund:R1"), ops(steps).join(","));
});

test("round 17: a change order's side told by hand is the side that goes: the other side waits, never told by hand too", () => {
  const co = contract({ id: "CO1", kind: "change_order", docNumber: "EST-1047-CO1", title: "Add a window", parentId: "C1", depositCents: 0, totalCents: 128_700, taxCents: 8_700, signedAt: "2026-10-04T18:00:00Z" });
  const coStage = stage({ id: "CS1", docId: "CO1", name: "Window", description: null, amountCents: 128_700, requestedAt: "2026-10-07T15:00:00Z" });
  const mirror = stage({ id: "M1", docId: "C1", sortOrder: 3, name: "EST-1047-CO1", description: "Add a window", amountCents: 128_700, requestedAt: "2026-10-07T09:00:00Z" });
  const toldLine = rec({ record_id: "M1", bill_id: "M1", qb_id: null, status: "waiting", reason: SALES_WAIT.taxed });
  const steps = plan({ docs: [contract({ depositCents: 0 }), co], stages: [coStage, mirror], records: [toldLine] });
  assert.equal(reasonOf(steps, "CS1"), `wait:${SALES_WAIT.coGoesParent("EST-1047")}`);
  assert.equal(reasonOf(steps, "M1"), "none");
  // The own stage told; the line billed after: the line waits.
  const toldOwn = rec({ record_id: "CS1", bill_id: "CS1", qb_id: null, status: "waiting", reason: SALES_WAIT.taxed });
  const b = plan({ docs: [contract({ depositCents: 0 }), co], stages: [coStage, { ...mirror, requestedAt: "2026-10-08T09:00:00Z" }], records: [toldOwn] });
  assert.equal(reasonOf(b, "M1"), `wait:${SALES_WAIT.coGoesOwn}`);
});

test("round 17: a payment held by hand for its day holds its bill whatever the dates of the others", () => {
  const spec = find(plan({ stages: [stage({ amountCents: 400_000 })] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  // Told before the start date; its date since corrected to after a card payment's.
  const x = money({ id: "X", amountCents: 400_000, paidAt: "2026-10-09T19:00:00Z" });
  const xTold = rec({ record_type: "customer_payment", record_id: "X", bill_id: "S1", qb_id: null, status: "waiting", reason: SALES_WAIT.beforeStart(FROM) });
  const card = money({ id: "P2", amountCents: 400_000, method: "card", source: "stripe", reference: null, paidAt: "2026-10-06T19:00:00Z" });
  const steps = plan({ stages: [stage({ amountCents: 400_000 })], money: [x, card], records: [invRec, xTold] });
  assert.equal(reasonOf(steps, "P2"), `wait:${SALES_WAIT.overpaidCard}`);
});

test("round 17: a bill told by hand and taken back: what's on it says to take it out too, its bounce included", () => {
  const told = rec({ qb_id: null, status: "waiting", reason: SALES_WAIT.taxed });
  const p1 = money();
  const p1Told = rec({ record_type: "customer_payment", record_id: "P1", bill_id: "S1", qb_id: null, status: "waiting", reason: SALES_WAIT.taxedChild });
  const bounce = money({ id: "RB", amountCents: -900_000, refundOf: "P1", stillOwed: true, paidAt: "2026-10-08T19:00:00Z" });
  const steps = plan({ stages: [stage({ requestedAt: null, dueDate: null })], money: [p1, bounce], records: [told, p1Told] });
  assert.equal(reasonOf(steps, "S1"), `wait:${SALES_WAIT.undoTakenBack}`);
  assert.equal(reasonOf(steps, "P1"), `wait:${SALES_WAIT.undoTakenBack}`);
  assert.equal(reasonOf(steps, "RB"), `wait:${SALES_WAIT.undoTakenBack}`);
});

test("round 18: a short refund waits while another payment on the bill still clears, then says why", () => {
  const spec = find(plan({ stages: [stage({ amountCents: 500_000 })] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  const x = money({ id: "X", amountCents: 300_000 });
  const xRec = rec({ record_type: "customer_payment", record_id: "X", bill_id: "S1", qb_id: "600", qb_hash: paymentHash(x, { type: "invoice", id: "S1" }, day(x.paidAt ?? "")) });
  const ach = money({ id: "P", amountCents: 500_000, status: "pending", paidAt: null, method: "us_bank_account", source: "stripe", reference: null });
  const rx = money({ id: "RX", amountCents: -300_000, refundOf: "X", stillOwed: false, paidAt: "2026-10-09T19:00:00Z" });
  const st5 = [stage({ amountCents: 500_000 })];
  assert.equal(reasonOf(plan({ stages: st5, money: [x, ach, rx], records: [invRec, xRec] }), "RX"), `wait:${SALES_WAIT.otherClearing}`);
  assert.equal(reasonOf(plan({ stages: st5, money: [x, { ...ach, status: "failed" }, rx], records: [invRec, xRec] }), "RX"), `wait:${SALES_WAIT.refundOwedAgain}`);
});

test("round 18: credits on a bill told by hand and taken back say so too, and follow it when it's billed again", () => {
  const told = rec({ qb_id: null, status: "waiting", reason: SALES_WAIT.taxed });
  const k = credit({ id: "K1", docId: "C1", stageId: "S1", amountCents: 50_000 });
  const kTold = rec({ record_type: "credit", record_id: "K1", bill_id: "S1", qb_id: null, status: "waiting", reason: SALES_WAIT.taxedChild });
  const a = plan({ stages: [stage({ requestedAt: null, dueDate: null })], credits: [k], records: [told, kTold] });
  assert.equal(reasonOf(a, "K1"), `wait:${SALES_WAIT.undoTakenBack}`);
  // Billed again after: the bill stays by hand, and so does its credit.
  const undone = rec({ qb_id: null, status: "waiting", reason: SALES_WAIT.undoTakenBack });
  const kUndo = { ...kTold, reason: SALES_WAIT.undoTakenBack };
  const b = plan({ stages: [stage()], credits: [k], records: [undone, kUndo] });
  assert.equal(reasonOf(b, "K1"), `wait:${SALES_WAIT.billByHandChild}`);
});

test("round 18: a change order's stage told, taken back, then billed again while its line goes keeps its 'take it out' note", () => {
  const co = contract({ id: "CO1", kind: "change_order", docNumber: "EST-1047-CO1", title: "Add a window", parentId: "C1", depositCents: 0, totalCents: 128_700, taxCents: 8_700, signedAt: "2026-10-04T18:00:00Z" });
  const coStage = stage({ id: "CS1", docId: "CO1", name: "Window", description: null, amountCents: 128_700, requestedAt: "2026-10-09T15:00:00Z" });
  const mirror = stage({ id: "M1", docId: "C1", sortOrder: 3, name: "EST-1047-CO1", description: "Add a window", amountCents: 128_700, requestedAt: "2026-10-07T09:00:00Z" });
  const csUndo = rec({ record_id: "CS1", bill_id: "CS1", qb_id: null, status: "waiting", reason: SALES_WAIT.undoTakenBack });
  const mTold = rec({ record_id: "M1", bill_id: "M1", qb_id: null, status: "waiting", reason: SALES_WAIT.taxed });
  const steps = plan({ docs: [contract({ depositCents: 0 }), co], stages: [coStage, mirror], records: [csUndo, mTold] });
  assert.equal(reasonOf(steps, "CS1"), "none");
});

test("round 18: a refunded payment never sent, with the CRM showing money owed again, says so", () => {
  const spec = find(plan({ stages: [stage({ amountCents: 150_000 })] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  const card = money({ id: "CARD", amountCents: 150_000, method: "card", source: "stripe", reference: null });
  const rc = money({ id: "RC", amountCents: -75_000, refundOf: "CARD", stillOwed: false, source: "stripe", method: "card", reference: null, paidAt: "2026-10-09T19:00:00Z" });
  const steps = plan({ stages: [stage({ amountCents: 150_000 })], money: [card, rc], records: [invRec] });
  assert.equal(reasonOf(steps, "CARD"), `wait:${SALES_WAIT.refundedOwedAgain}`);
  assert.equal(reasonOf(steps, "RC"), `wait:${SALES_WAIT.refundByHand}`);
});

test("round 18: a further duplicate after a bounce already paid again is a plain overpayment", () => {
  const spec = find(plan({ stages: [stage({ amountCents: 150_000 })] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  const c1 = money({ id: "C1P", amountCents: 150_000 });
  const c1Rec = rec({ record_type: "customer_payment", record_id: "C1P", bill_id: "S1", qb_id: "600", qb_hash: paymentHash(c1, { type: "invoice", id: "S1" }, day(c1.paidAt ?? "")) });
  const bounce = money({ id: "RB", amountCents: -150_000, refundOf: "C1P", stillOwed: true, paidAt: "2026-10-08T19:00:00Z" });
  const p2 = money({ id: "P2", amountCents: 150_000, method: "card", source: "stripe", reference: null, paidAt: "2026-10-09T19:00:00Z" });
  const c3 = money({ id: "C3", amountCents: 150_000, reference: "3003", paidAt: "2026-10-10T19:00:00Z" });
  const steps = plan({ stages: [stage({ amountCents: 150_000 })], money: [c1, bounce, p2, c3], records: [invRec, c1Rec] });
  assert.equal(reasonOf(steps, "P2"), `wait:${SALES_WAIT.paidAgain}`);
  assert.equal(reasonOf(steps, "C3"), `wait:${SALES_WAIT.overpaid}`);
});

test("round 19: a voided change order's stage with money waits for its line already in QuickBooks, never told by hand", () => {
  const co = contract({ id: "CO1", kind: "change_order", docNumber: "EST-1047-CO1", title: "Add a window", parentId: "C1", depositCents: 0, totalCents: 200_000, status: "Void", signedAt: "2026-10-04T18:00:00Z" });
  const coStage = stage({ id: "CS1", docId: "CO1", name: "Window", description: null, amountCents: 200_000, requestedAt: null, dueDate: null });
  const mirror = stage({ id: "M1", docId: "C1", sortOrder: 3, name: "EST-1047-CO1", description: "Add a window", amountCents: 200_000, requestedAt: "2026-10-06T09:00:00Z" });
  const mSpec = find(plan({ docs: [contract({ depositCents: 0 })], stages: [mirror] }), "create_invoice").spec;
  const mRec = rec({ record_id: "M1", bill_id: "M1", qb_hash: invoiceHash(mSpec) });
  const card = money({ id: "PC", docId: "CO1", stageId: "CS1", amountCents: 200_000, method: "card", source: "stripe", reference: null, paidAt: "2026-10-07T19:00:00Z" });
  const steps = plan({ docs: [contract({ depositCents: 0 }), co], stages: [coStage, mirror], money: [card], records: [mRec] });
  assert.equal(reasonOf(steps, "CS1"), `wait:${SALES_WAIT.coOnParent("EST-1047")}`);
  assert.equal(reasonOf(steps, "PC"), `wait:${SALES_WAIT.coMoneyOnParent("EST-1047")}`);
});

test("round 19: a refund of a payment only planned this run is never told by hand yet", () => {
  const p1 = money();
  const r1 = money({ id: "R1", amountCents: -300_000, refundOf: "P1", stillOwed: true, paidAt: "2026-10-08T19:00:00Z" });
  const steps = plan({ stages: [stage()], money: [p1, r1] });
  assert.ok(ops(steps).includes("create_payment:P1"));
  assert.equal(reasonOf(steps, "R1"), `wait:${SALES_WAIT.paymentFirst}`);
});

test("round 19: a payment told by hand and edited since says to make the same change there, and still holds its bill", () => {
  const spec = find(plan({ stages: [stage()] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  const before = money({ amountCents: 500_000, paidAt: "2026-10-03T19:00:00Z" });
  const told = rec({ record_type: "customer_payment", record_id: "P1", bill_id: "S1", qb_id: null, status: "waiting", reason: SALES_WAIT.closedByHand("2026-10-04"), tried_hash: paymentHash(before, { type: "invoice", id: "S1" }, "2026-10-03") });
  const after = { ...before, amountCents: 700_000 };
  const p2 = money({ id: "P2", amountCents: 500_000, method: "card", source: "stripe", reference: null, paidAt: "2026-10-07T19:00:00Z" });
  const steps = plan({ stages: [stage()], money: [after, p2], records: [invRec, told], prefs: { bookCloseDate: "2026-10-04" } });
  assert.equal(reasonOf(steps, "P1"), `wait:${SALES_WAIT.closedByHand("2026-10-04")}${CHANGED_SINCE}`);
  // It still holds its bill ($7,000 of $9,000): the $5,000 card is more than what's left.
  assert.equal(reasonOf(steps, "P2"), `wait:${SALES_WAIT.overpaidCard}`);
});

test("round 19: a refund waiting on another payment to clear says that; a payment in QuickBooks raised past its bill waits", () => {
  const spec = find(plan({ stages: [stage({ amountCents: 500_000 })] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  const y = money({ id: "Y", amountCents: 300_000 });
  const ach = money({ id: "A", amountCents: 500_000, status: "pending", paidAt: null, method: "us_bank_account", source: "stripe", reference: null });
  const ry = money({ id: "RY", amountCents: -100_000, refundOf: "Y", stillOwed: false, paidAt: "2026-10-09T19:00:00Z" });
  const a = plan({ stages: [stage({ amountCents: 500_000 })], money: [y, ach, ry], records: [invRec] });
  assert.equal(reasonOf(a, "Y"), `wait:${SALES_WAIT.otherClearing}`);
  assert.equal(reasonOf(a, "RY"), `wait:${SALES_WAIT.otherClearing}`);
  // Two checks in QuickBooks, one raised past the bill in the CRM.
  const c1 = money({ id: "C1P", amountCents: 300_000 });
  const c2 = money({ id: "C2P", amountCents: 200_000, reference: "2090", paidAt: "2026-10-08T19:00:00Z" });
  const r = (m: SyncMoney, qb: string) => rec({ record_type: "customer_payment", record_id: m.id, bill_id: "S1", qb_id: qb, qb_hash: paymentHash(m, { type: "invoice", id: "S1" }, day(m.paidAt ?? "")) });
  // Round 20: decided where QuickBooks' own amount is known (the runner); the planner sends the change, and another
  // payment's edit (its check number) on the same bill goes too.
  const raised = { ...c2, amountCents: 400_000 };
  const b = plan({ stages: [stage({ amountCents: 500_000 })], money: [{ ...c1, reference: "2111" }, raised], records: [invRec, r(c1, "601"), r(c2, "602")] });
  assert.deepEqual(ops(b).filter((x) => x.startsWith("update_payment")).sort(), ["update_payment:C1P", "update_payment:C2P"]);
});

test("round 20: change-order money told to go on the other side is re-noted when its own bill goes after all", () => {
  const co = contract({ id: "CO1", kind: "change_order", docNumber: "EST-1047-CO1", title: "Add a window", parentId: "C1", depositCents: 0, totalCents: 200_000, signedAt: "2026-10-04T18:00:00Z" });
  const coStage = stage({ id: "CS1", docId: "CO1", name: "Window", description: null, amountCents: 200_000, requestedAt: null, dueDate: null });
  const mirror = stage({ id: "M1", docId: "C1", sortOrder: 3, name: "EST-1047-CO1", description: "Add a window", amountCents: 200_000, requestedAt: null, dueDate: null });
  const card = money({ id: "PC", docId: "CO1", stageId: "CS1", amountCents: 200_000, method: "card", source: "stripe", reference: null, paidAt: "2026-10-07T19:00:00Z" });
  const told = rec({ record_type: "customer_payment", record_id: "PC", bill_id: "CS1", qb_id: null, status: "waiting", reason: SALES_WAIT.coMoneyOnParent("EST-1047") });
  // The contract's line taken back since: the change order's own stage goes (paid before it was billed).
  const steps = plan({ docs: [contract({ depositCents: 0 }), co], stages: [coStage, mirror], money: [card], records: [told] });
  assert.ok(ops(steps).includes("create_invoice:invoice:CS1"));
  assert.equal(reasonOf(steps, "PC"), `wait:${SALES_WAIT.coMoneyMoved}`);
});

test("round 20: a told payment edited again after its 'changed since' note is noted again", () => {
  const spec = find(plan({ stages: [stage()] }), "create_invoice").spec;
  const invRec = rec({ qb_hash: invoiceHash(spec) });
  const first = money({ amountCents: 700_000, paidAt: "2026-10-03T19:00:00Z" });
  const told = rec({ record_type: "customer_payment", record_id: "P1", bill_id: "S1", qb_id: null, status: "waiting", reason: SALES_WAIT.closedByHand("2026-10-04") + CHANGED_SINCE, tried_hash: paymentHash(first, { type: "invoice", id: "S1" }, "2026-10-03") });
  const again = { ...first, amountCents: 650_000 };
  const steps = plan({ stages: [stage()], money: [again], records: [invRec, told], prefs: { bookCloseDate: "2026-10-04" } });
  const w = steps.find((x) => x.op === "wait" && x.recordId === "P1") as Extract<SalesStep, { op: "wait" }> | undefined;
  assert.ok(w, "noted again");
  assert.equal(w!.hash, paymentHash(again, { type: "invoice", id: "S1" }, "2026-10-03"));
  // Unchanged since: nothing.
  assert.deepEqual(ops(plan({ stages: [stage()], money: [first], records: [invRec, told], prefs: { bookCloseDate: "2026-10-04" } })).filter((x) => x.endsWith(":P1")), []);
});

test("round 20: a voided change order is called that, never 'the contract was voided'", () => {
  const co = contract({ id: "CO1", kind: "change_order", docNumber: "EST-1047-CO1", title: "Add a window", parentId: "C1", depositCents: 0, totalCents: 120_000, status: "Void", signedAt: "2026-10-04T18:00:00Z" });
  const coStage = stage({ id: "CS1", docId: "CO1", name: "Window", description: null, amountCents: 120_000, requestedAt: "2026-10-05T17:00:00Z" });
  const card = money({ id: "PC", docId: "CO1", stageId: "CS1", amountCents: 120_000, method: "card", source: "stripe", reference: null, paidAt: "2026-10-06T19:00:00Z" });
  const steps = plan({ docs: [contract({ depositCents: 0 }), co], stages: [coStage], money: [card] });
  assert.equal(reasonOf(steps, "CS1"), `wait:${SALES_WAIT.coVoidedUnsent}`);
  assert.equal(reasonOf(steps, "PC"), `wait:${SALES_WAIT.coVoidedUnsentChild}`);
  for (const t of [SALES_WAIT.coVoidedUnsent, SALES_WAIT.coVoidedUnsentChild, SALES_WAIT.coVoidedWithMoney, SALES_WAIT.coVoidedSettling]) assert.doesNotMatch(t, /contract/);
});

test("round 8: money on a voided contract's stage that was once billed and taken back waits, never dropped", () => {
  const removed = rec({ qb_id: null, status: "removed" });
  const pending = money({ status: "pending", paidAt: null });
  const steps = plan({ docs: [contract({ depositCents: 0, status: "Void" })], stages: [stage({ requestedAt: null, dueDate: null, cancelledAt: "2026-10-07T18:00:00Z" })], money: [money({ paidAt: "2026-10-06T19:00:00Z" })], records: [removed] });
  assert.deepEqual(ops(steps), ["wait:invoice:S1", "wait:customer_payment:P1"]);
  assert.ok(pending);
});

// ---------------------------------------------------------------- jobs for bills

test("bills on a job get that job in QuickBooks: the job is added even before anything is billed", () => {
  assert.deepEqual(ops(plan({ docs: [contract({ depositCents: 0 })], billLinks: [{ leadId: "L1", contractId: "C1" }] })), ["ensure_job:C1"]);
  const jobRec = rec({ record_type: "job", record_id: "C1", bill_id: null, qb_id: "78" });
  assert.deepEqual(ops(plan({ docs: [contract({ depositCents: 0 })], billLinks: [{ leadId: "L1", contractId: "C1" }], records: [jobRec] })), []);
  assert.deepEqual(ops(plan({ billLinks: [{ leadId: "L1", contractId: null }] })), ["ensure_customer:L1"]);
  // Left-out customers aren't added for their bills either.
  assert.deepEqual(ops(plan({ leads: [lead({ outside: true })], billLinks: [{ leadId: "L1", contractId: "C1" }] })), []);
});

// ---------------------------------------------------------------- what is sent

test("invoice, payment, credit and refund bodies as QuickBooks takes them", () => {
  const spec = find(plan({ docs: [contract({ depositCents: 0 }), inv()], stages: [invStage()], lines: invLines }), "create_invoice").spec;
  const body = invoiceBody(spec, { customerId: "78", items: { job: "1", deposit: "1", cost: "9" }, salesTax: true });
  assert.deepEqual(body, {
    CustomerRef: { value: "78" },
    DocNumber: "INV-1004",
    TxnDate: "2026-10-06",
    DueDate: "2026-10-21",
    PrivateNote: "From the CRM · INV-1004 · for EST-1047",
    CustomerMemo: { value: "Thanks for the extra work!" },
    ShipAddr: { Line1: "418 Alder Way", City: "Pasadena", CountrySubDivisionCode: "CA", PostalCode: "91101" },
    EmailStatus: "NotSet",
    AllowOnlineCreditCardPayment: false,
    AllowOnlineACHPayment: false,
    Line: [
      { DetailType: "SalesItemLineDetail", Amount: 555, Description: "Add outlet", SalesItemLineDetail: { ItemRef: { value: "1" }, Qty: 3, UnitPrice: 185, TaxCodeRef: { value: "NON" } } },
      { DetailType: "SalesItemLineDetail", Amount: 312, Description: "Electrical permit - City of Pasadena", SalesItemLineDetail: { ItemRef: { value: "9" }, Qty: 1, UnitPrice: 312, TaxCodeRef: { value: "NON" } } },
    ],
  });
  // Sales tax off in QuickBooks: no tax code at all.
  const noTax = invoiceBody(spec, { customerId: "78", items: { job: "1", deposit: "1", cost: "9" }, salesTax: false }) as { Line: { SalesItemLineDetail: Record<string, unknown> }[] };
  assert.equal("TaxCodeRef" in noTax.Line[0].SalesItemLineDetail, false);

  const pay = customerPaymentBody(money(), { customerId: "78", invoiceQbId: "500", methodId: "2", depositTo: null, txnDay: "2026-10-07" });
  assert.deepEqual(pay, {
    CustomerRef: { value: "78" },
    TotalAmt: 9000,
    TxnDate: "2026-10-07",
    PaymentMethodRef: { value: "2" },
    PaymentRefNum: "2087",
    PrivateNote: "From the CRM",
    Line: [{ Amount: 9000, LinkedTxn: [{ TxnId: "500", TxnType: "Invoice" }] }],
  });
  assert.equal(
    (customerPaymentBody(money({ note: "Left in the mailbox" }), { customerId: "78", invoiceQbId: "500", methodId: null, depositTo: "35", txnDay: "2026-10-07" }) as Record<string, unknown>).PrivateNote,
    "From the CRM · Left in the mailbox"
  );
  assert.deepEqual((customerPaymentBody(money(), { customerId: "78", invoiceQbId: "500", methodId: null, depositTo: "35", txnDay: "2026-10-07" }) as Record<string, unknown>).DepositToAccountRef, { value: "35" });

  assert.deepEqual(creditMemoBody(credit(), { customerId: "78", item: "1", docNumber: "INV-1004", day: "2026-10-07", salesTax: true }), {
    CustomerRef: { value: "78" },
    TxnDate: "2026-10-07",
    PrivateNote: "From the CRM · Credit on INV-1004",
    CustomerMemo: { value: "Outlet trim delayed a week" },
    Line: [{ DetailType: "SalesItemLineDetail", Amount: 150, Description: "Credit on INV-1004: Outlet trim delayed a week", SalesItemLineDetail: { ItemRef: { value: "1" }, TaxCodeRef: { value: "NON" } } }],
  });
  assert.deepEqual(creditLinkBody({ customerId: "78", invoiceQbId: "500", creditQbId: "700", amountCents: 15_000, day: "2026-10-07" }), {
    CustomerRef: { value: "78" },
    TotalAmt: 0,
    TxnDate: "2026-10-07",
    PrivateNote: "From the CRM · applies a credit",
    Line: [
      { Amount: 150, LinkedTxn: [{ TxnId: "500", TxnType: "Invoice" }] },
      { Amount: 150, LinkedTxn: [{ TxnId: "700", TxnType: "CreditMemo" }] },
    ],
  });
  const refund = money({ id: "R1", amountCents: -20_000, refundOf: "P1", note: "Paint touch-up not needed", paidAt: "2026-10-08T15:00:00Z" });
  assert.deepEqual(refundReceiptBody(refund, { customerId: "78", item: "1", accountId: "35", methodId: "2", salesTax: false, txnDay: "2026-10-08" }), {
    CustomerRef: { value: "78" },
    TxnDate: "2026-10-08",
    DepositToAccountRef: { value: "35" },
    PaymentMethodRef: { value: "2" },
    PaymentRefNum: "2087",
    PrivateNote: "From the CRM",
    CustomerMemo: { value: "Paint touch-up not needed" },
    Line: [{ DetailType: "SalesItemLineDetail", Amount: 200, Description: "Refund: Paint touch-up not needed", SalesItemLineDetail: { ItemRef: { value: "1" } } }],
  });
  assert.equal(qbPaymentMethodName("card"), "Credit card");
  assert.equal(qbPaymentMethodName("us_bank_account"), "Bank transfer");
  assert.equal(qbPaymentMethodName("zelle"), "Zelle");
  assert.equal(qbPaymentMethodName("klarna"), "Other");
});

// ---------------------------------------------------------------- Invoices page

test("the Invoices page says where each bill stands with QuickBooks", () => {
  const c = (p: Partial<Parameters<typeof invoiceQbChips>[0]>) =>
    invoiceQbChips({
      sending: true,
      sendFrom: FROM,
      label: "Invoice",
      invoice: { day: "2026-10-05", voided: false, outside: false },
      record: rec({}),
      payments: [],
      credits: [],
      refunds: [],
      day: (iso) => iso.slice(5, 10),
      ...p,
    }).chips.map((x) => `${x.tone}|${x.text}`);
  const payRec = rec({ record_type: "customer_payment", record_id: "P1", sent_at: "2026-10-08T09:00:00Z" });
  assert.deepEqual(c({}), ["good|✓ In QuickBooks · Invoice · 10-07"]);
  assert.deepEqual(c({ payments: [payRec] }), ["good|✓ In QuickBooks · Invoice and payment · 10-08"]);
  assert.deepEqual(c({ payments: [payRec, payRec], credits: [rec({ record_type: "credit" })] }), ["good|✓ In QuickBooks · Invoice, 2 payments and credit · 10-08"]);
  assert.deepEqual(c({ payments: [null] }), ["good|✓ Invoice in QuickBooks", "off|Payment goes in a few minutes"]);
  assert.deepEqual(c({ payments: [rec({ record_type: "customer_payment", qb_id: null, status: "waiting", reason: "Goes when the money clears." })] }), [
    "good|✓ Invoice in QuickBooks",
    "wait|Payment waiting: Goes when the money clears.",
  ]);
  assert.deepEqual(c({ record: null }), ["off|Goes to QuickBooks in a few minutes"]);
  assert.deepEqual(c({ record: null, invoice: { day: "2026-09-28", voided: false, outside: false } }), ["off|Before 10-01: not sent"]);
  assert.deepEqual(c({ record: null, invoice: { day: "2026-10-05", voided: false, outside: true } }), ["off|Not sent: this customer is invoiced outside the CRM (Online payments off)"]);
  assert.deepEqual(c({ record: rec({ qb_id: null, status: "waiting", reason: "This bill includes sales tax. The CRM doesn't send taxed bills to QuickBooks yet, so enter it there by hand." }) }), [
    "wait|Waiting: This bill includes sales tax. The CRM doesn't send taxed bills to QuickBooks yet, so enter it there by hand.",
  ]);
  assert.deepEqual(c({ record: null, sending: false }), []);
  assert.deepEqual(c({ invoice: { day: "2026-10-05", voided: true, outside: false } }), ["off|Being removed from QuickBooks"]);
  assert.deepEqual(c({ invoice: { day: "2026-10-05", voided: true, outside: false }, record: rec({ status: "removed", qb_id: null }) }), ["off|Removed from QuickBooks"]);
  assert.deepEqual(c({ record: rec({ status: "gone" }) }), ["off|Deleted in QuickBooks, so the CRM doesn't send it again"]);
  assert.deepEqual(c({ label: "Deposit invoice" }), ["good|✓ Deposit invoice in QuickBooks · 10-07"]);
  // A credit counts as in QuickBooks only once its $0.00 payment applies it there too.
  const memo = rec({ record_type: "credit", record_id: "K1" });
  const linkRefused = rec({ record_type: "credit_link", record_id: "K1", qb_id: null, status: "failed", failed_op: "add", reason: "QuickBooks said: more than the balance" });
  assert.equal(creditChipRecord(memo, null), null);
  assert.equal(creditChipRecord(memo, linkRefused), linkRefused);
  assert.equal(creditChipRecord(memo, rec({ record_type: "credit_link", record_id: "K1" })), memo);
  assert.deepEqual(c({ credits: [creditChipRecord(memo, linkRefused)] }), ["good|✓ Invoice in QuickBooks", "bad|Credit didn't go: QuickBooks said: more than the balance"]);
  // Something taken off in the CRM that QuickBooks wouldn't let go of says so.
  const stuck = rec({ record_type: "customer_payment", record_id: "P9", status: "failed", failed_op: "remove", reason: "Couldn't void it in QuickBooks. This payment is in a bank deposit." });
  assert.deepEqual(c({ stuck: [stuck] }), ["good|✓ Invoice in QuickBooks", "bad|Payment taken off in the CRM is still in QuickBooks: Couldn't void it in QuickBooks. This payment is in a bank deposit."]);
  assert.deepEqual(c({ invoice: { day: "2026-10-05", voided: true, outside: false }, stuck: [stuck] }), [
    "bad|Still in QuickBooks: a payment on it couldn't be taken off first: Couldn't void it in QuickBooks. This payment is in a bank deposit.",
  ]);
  // Deleted in QuickBooks: said, not "goes in a few minutes".
  assert.deepEqual(c({ payments: [rec({ record_type: "customer_payment", record_id: "P1", status: "gone" })] }), [
    "good|✓ Invoice in QuickBooks",
    "off|Payment deleted in QuickBooks, so the CRM doesn't send it again",
  ]);
});

// ---------------------------------------------------------------- talking to QuickBooks

test("customers are looked up by exact name, inactive ones too; payment methods by name", () => {
  assert.equal(customerQuery("O'Brien Homes"), "select * from Customer where DisplayName = 'O\\'Brien Homes' and Active in (true, false)");
  assert.equal(paymentMethodQuery("Zelle"), "select * from PaymentMethod where Name = 'Zelle'");
  // A backslash is escaped too, so a name ending in one can't end the quote early.
  assert.equal(customerQuery("Smith \\"), "select * from Customer where DisplayName = 'Smith \\\\' and Active in (true, false)");
  assert.equal(attachableNoteQuery("a\\'b"), "select * from Attachable where Note = 'a\\\\\\'b'");
});

test("a found customer says whether it's active, a job, and whose", async () => {
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({ QueryResponse: { Customer: [{ Id: "78", DisplayName: "EST-1047 Kitchen remodel", Active: true, Job: true, ParentRef: { value: "77" } }] } }),
      { status: 200 }
    )) as unknown as typeof fetch;
  assert.deepEqual(await findCustomer(access, "EST-1047 Kitchen remodel", fetchImpl), { customer: { id: "78", active: true, parentId: "77" } });
});

test("QuickBooks' own settings are read: custom numbers, auto-applied credits, sales tax, closed books", async () => {
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({
        Preferences: {
          SalesFormsPrefs: { CustomTxnNumbers: true, AutoApplyCredit: false },
          TaxPrefs: { UsingSalesTax: true, PartnerTaxEnabled: true },
          AccountingInfoPrefs: { BookCloseDate: "2026-09-30" },
        },
      }),
      { status: 200 }
    )) as unknown as typeof fetch;
  assert.deepEqual(await readPreferences(access, fetchImpl), {
    prefs: { customNumbers: true, autoApplyCredit: false, salesTax: true, automaticTax: true, bookCloseDate: "2026-09-30" },
  });
});

test("voiding an invoice names it and its current version", async () => {
  let seen: Seen | null = null;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify({ Invoice: { Id: "500", SyncToken: "3", TotalAmt: 0 } }), { status: 200 });
  }) as unknown as typeof fetch;
  assert.deepEqual(await voidInvoice(access, { id: "500", syncToken: "2" }, "crm-v", fetchImpl), { id: "500", syncToken: "3" });
  const u = new URL(seen!.url);
  assert.equal(u.pathname, "/v3/company/9341/invoice");
  assert.equal(u.searchParams.get("operation"), "void");
  assert.equal(u.searchParams.get("requestid"), "crm-v");
  assert.deepEqual(JSON.parse(String(seen!.init.body)), { Id: "500", SyncToken: "2" });
});

test("0225 adds what step 3 records; the job runs invoices and bills together", () => {
  const sql = source("../../../supabase/migrations/0225_quickbooks_invoices.sql");
  assert.match(sql, /add column if not exists send_invoices boolean not null default false/);
  assert.match(sql, /'customer', 'job', 'invoice', 'deposit', 'customer_payment', 'credit', 'credit_link', 'refund'/);
  const cron = source("../../app/api/cron/quickbooks-sync/route.ts");
  assert.match(cron, /syncCompanyInvoices/);
  assert.match(cron, /syncCompanyBills/);
});

// ---------------------------------------------------------------- bills get their job (step 2's lines)

import { billBody, billHash, billRetagBody, billUpdateBody, type SyncBill } from "./bill-sync.ts";

test("a bill on a job is tagged with it in QuickBooks, not billable; a line the bookkeeper tagged keeps theirs", () => {
  const b: SyncBill = {
    id: "b1",
    vendorName: "ABC Lumber",
    vendorCategory: null,
    reference: "Framing lumber",
    amountCents: 324_000,
    billDate: "2026-10-08",
    dueDate: null,
    createdAt: "2026-10-08T16:00:00Z",
    voided: false,
    memo: "EST-1047 · Maria Lopez · Kitchen remodel",
    receiptPath: null,
  };
  // No job yet: exactly as before (the hash too, so nothing already sent is sent again).
  assert.equal(billHash({ ...b, tag: null }), billHash(b));
  assert.notEqual(billHash({ ...b, tag: "78" }), billHash(b));
  const made = billBody({ ...b, tag: "78" }, { vendorId: "56", accountId: "60" });
  assert.deepEqual(made.Line[0].AccountBasedExpenseLineDetail, { AccountRef: { value: "60" }, CustomerRef: { value: "78" }, BillableStatus: "NotBillable" });
  // Already in QuickBooks untagged: the change adds the job and keeps the rest of the line.
  const line = { Id: "1", DetailType: "AccountBasedExpenseLineDetail", Amount: 3240, Description: "Framing lumber", AccountBasedExpenseLineDetail: { AccountRef: { value: "60" }, ClassRef: { value: "3" } } };
  const up = billUpdateBody({ ...b, tag: "78" }, { id: "108", syncToken: "0", lines: [line] }, { vendorId: "56" });
  assert.ok("body" in up);
  assert.deepEqual((up.body.Line as Record<string, unknown>[])[0].AccountBasedExpenseLineDetail, {
    AccountRef: { value: "60" },
    ClassRef: { value: "3" },
    CustomerRef: { value: "78" },
    BillableStatus: "NotBillable",
  });
  // The bookkeeper already tagged it: header only.
  const theirs = { ...line, AccountBasedExpenseLineDetail: { AccountRef: { value: "60" }, CustomerRef: { value: "99" } } };
  const kept = billUpdateBody({ ...b, tag: "78" }, { id: "108", syncToken: "0", lines: [theirs] }, { vendorId: "56" });
  assert.ok("body" in kept && !("Line" in kept.body));
  // The tag the CRM itself last sent on this bill moves with it: to its job once it's there, or off when the bill leaves the job.
  const own = "77";
  const ours = { ...line, AccountBasedExpenseLineDetail: { AccountRef: { value: "60" }, CustomerRef: { value: "77" }, BillableStatus: "NotBillable" } };
  const moved = billUpdateBody({ ...b, tag: "78" }, { id: "108", syncToken: "0", lines: [ours] }, { vendorId: "56", lastTag: own });
  assert.ok("body" in moved);
  assert.deepEqual((moved.body.Line as Record<string, unknown>[])[0].AccountBasedExpenseLineDetail, {
    AccountRef: { value: "60" },
    CustomerRef: { value: "78" },
    BillableStatus: "NotBillable",
  });
  const off = billUpdateBody({ ...b, tag: null }, { id: "108", syncToken: "0", lines: [ours] }, { vendorId: "56", lastTag: own });
  assert.ok("body" in off);
  assert.deepEqual((off.body.Line as Record<string, unknown>[])[0].AccountBasedExpenseLineDetail, { AccountRef: { value: "60" } });
  // Still on the same job: header only. A bookkeeper's own customer is never touched.
  const same = billUpdateBody({ ...b, tag: "77" }, { id: "108", syncToken: "0", lines: [ours] }, { vendorId: "56", lastTag: own });
  assert.ok("body" in same && !("Line" in same.body));
  const stillTheirs = billUpdateBody({ ...b, tag: null }, { id: "108", syncToken: "0", lines: [theirs] }, { vendorId: "56", lastTag: own });
  assert.ok("body" in stillTheirs && !("Line" in stillTheirs.body));
  // A customer the bookkeeper put on the line is theirs, even one the CRM knows too (it found it by name): never moved.
  const foundByName = { ...line, AccountBasedExpenseLineDetail: { AccountRef: { value: "60" }, CustomerRef: { value: "300" }, BillableStatus: "Billable" } };
  const keep = billUpdateBody({ ...b, tag: "301" }, { id: "108", syncToken: "0", lines: [foundByName] }, { vendorId: "56", lastTag: null });
  assert.ok("body" in keep && !("Line" in keep.body));
  // Only the job changed: just the lines go, nothing else on the bill (dates, memo, amount stay as QuickBooks has them).
  const split = [
    { ...line, Id: "1", Amount: 3240 },
    { Id: "2", DetailType: "AccountBasedExpenseLineDetail", Amount: 75, Description: "Freight", AccountBasedExpenseLineDetail: { AccountRef: { value: "61" } } },
  ];
  const retag = billRetagBody({ ...b, tag: "78" }, { id: "108", syncToken: "3", lines: split, vendorRef: { value: "56", name: "ABC Lumber" } }, null);
  assert.ok(retag);
  assert.deepEqual(Object.keys(retag!).sort(), ["Id", "Line", "SyncToken", "VendorRef", "sparse"]);
  assert.deepEqual((retag!.Line as Record<string, unknown>[]).map((l) => (l.AccountBasedExpenseLineDetail as { CustomerRef?: { value: string } }).CustomerRef?.value), ["78", "78"]);
  assert.equal(billRetagBody({ ...b, tag: "78" }, { id: "108", syncToken: "3", lines: [foundByName] }, null), null, "nothing of the CRM's to move: nothing sent");
});

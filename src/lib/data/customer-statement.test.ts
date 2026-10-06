import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildStatement, statementEmail, type StatementDoc, type StatementPayment } from "./customer-statement.ts";
import type { InvoiceStageLite } from "./invoice-rows.ts";

/**
 * Step 5 of full invoicing (DECISIONS #153): one customer's statement --
 * every bill and every payment, in date order, with the balance after
 * each, and what is owed now. Printable, and sent by email.
 */

const doc = (over: Partial<StatementDoc>): StatementDoc => ({
  id: "c1",
  lead_id: "l1",
  doc_number: "EST-1047",
  title: "Kitchen remodel",
  kind: "contract",
  status: "Signed",
  signed_at: "2026-08-01T17:00:00Z",
  created_at: "2026-07-20T17:00:00Z",
  total_cents: 2_500_000,
  deposit_cents: 100_000,
  ...over,
});

const stage = (over: Partial<InvoiceStageLite>): InvoiceStageLite => ({
  id: "s1",
  estimate_id: "c1",
  sort_order: 0,
  name: "Rough-in complete",
  amount_cents: 1_000_000,
  requested_at: "2026-09-01T17:00:00Z",
  due_date: "2026-09-15",
  cancelled_at: null,
  ...over,
});

const pay = (over: Partial<StatementPayment>): StatementPayment => ({
  estimate_id: "c1",
  estimate_payment_id: null,
  kind: "deposit",
  status: "succeeded",
  amount_cents: 100_000,
  method: "check",
  reference: "4417",
  paid_at: "2026-08-02T17:00:00Z",
  created_at: "2026-08-02T17:00:00Z",
  ...over,
});

const docs = [
  doc({}),
  doc({ id: "i1", doc_number: "INV-1004", title: "Permit fee", kind: "invoice", total_cents: 45_000, deposit_cents: 0, signed_at: "2026-09-20T17:00:00Z" }),
];
const stages = [
  stage({}),
  stage({ id: "s2", sort_order: 1, name: "Drywall", amount_cents: 800_000, requested_at: "2026-09-25T17:00:00Z", due_date: "2026-10-30" }),
  stage({ id: "si", estimate_id: "i1", name: "Invoice", amount_cents: 45_000, requested_at: "2026-09-20T17:00:00Z", due_date: "2026-10-05" }),
];
const payments = [
  pay({}),
  pay({ estimate_payment_id: "s1", kind: "progress", amount_cents: 600_000, method: "card", reference: null, paid_at: "2026-09-10T17:00:00Z" }),
  // On its way, not yet money: listed apart, never in the balance.
  pay({ estimate_payment_id: "s2", kind: "progress", status: "pending", amount_cents: 800_000, method: "us_bank_account", reference: null, paid_at: null, stripe_session_id: "cs_1", stripe_payment_intent_id: "pi_1" }),
  // A checkout opened and left: nothing at all.
  pay({ estimate_payment_id: "si", kind: "progress", status: "pending", amount_cents: 45_000, method: null, reference: null, paid_at: null, stripe_session_id: "cs_2", stripe_payment_intent_id: null }),
  pay({ estimate_payment_id: "s1", kind: "progress", status: "failed", amount_cents: 400_000, method: "us_bank_account", paid_at: null }),
];

const zone = "America/Los_Angeles";

test("every bill and payment in date order, with the balance after each", () => {
  const s = buildStatement(docs, stages, payments, { today: "2026-10-06", zone });
  assert.deepEqual(
    s.lines.map((l) => [l.day, l.kind, l.label, l.amountCents, l.balanceCents]),
    [
      ["2026-08-01", "charge", "Deposit — EST-1047", 100_000, 100_000],
      ["2026-08-02", "payment", "Payment — Deposit — EST-1047", 100_000, 0],
      ["2026-09-01", "charge", "Rough-in complete — EST-1047", 1_000_000, 1_000_000],
      ["2026-09-10", "payment", "Payment — Rough-in complete — EST-1047", 600_000, 400_000],
      ["2026-09-20", "charge", "Invoice INV-1004", 45_000, 445_000],
      ["2026-09-25", "charge", "Drywall — EST-1047", 800_000, 1_245_000],
    ]
  );
  assert.equal(s.billedCents, 1_945_000);
  assert.equal(s.paidCents, 700_000);
  assert.equal(s.balanceCents, 1_245_000);
  // Rough-in's $4,000 left and the invoice, both past due.
  assert.equal(s.overdueCents, 445_000);
  assert.deepEqual(s.clearing, { cents: 800_000, count: 1 });
});

test("each line says what it is: the document's title, how it was paid, when a bill is due", () => {
  const s = buildStatement(docs, stages, payments, { today: "2026-10-06", zone });
  const by = (label: string) => s.lines.find((l) => l.label === label)!;
  assert.equal(by("Payment — Deposit — EST-1047").detail, "Check #4417");
  assert.equal(by("Payment — Rough-in complete — EST-1047").detail, "Card");
  assert.equal(by("Invoice INV-1004").detail, "Permit fee · due Oct 5, 2026 · Overdue");
  assert.equal(by("Rough-in complete — EST-1047").detail, "Kitchen remodel · due Sep 15, 2026 · Overdue");
  assert.equal(by("Drywall — EST-1047").detail, "Kitchen remodel · due Oct 30, 2026 · Payment clearing");
});

test("a day is the company's day, not the server's", () => {
  // 3am UTC on Sep 11 is still Sep 10 in Los Angeles.
  const s = buildStatement(docs, stages, [pay({ paid_at: "2026-09-11T03:00:00Z" })], { today: "2026-10-06", zone });
  assert.equal(s.lines.find((l) => l.kind === "payment")!.day, "2026-09-10");
});

test("cancelled bills, drafts and unbilled stages are not on it; a credit lowers the balance", () => {
  const s = buildStatement(
    [
      doc({ deposit_cents: 0 }),
      doc({ id: "v1", doc_number: "INV-1001", kind: "invoice", status: "Void", deposit_cents: 0 }),
      doc({ id: "d1", doc_number: "INV-1002", kind: "invoice", status: "Draft", signed_at: null, deposit_cents: 0 }),
    ],
    [
      stage({}),
      stage({ id: "s9", sort_order: 2, name: "Final", requested_at: null }),
      stage({ id: "sc", sort_order: 3, name: "Allowance credit", amount_cents: -50_000, requested_at: "2026-09-02T17:00:00Z" }),
      stage({ id: "sv", estimate_id: "v1", name: "Invoice", amount_cents: 20_000 }),
    ],
    [],
    { today: "2026-09-05", zone }
  );
  assert.deepEqual(
    s.lines.map((l) => [l.kind, l.label, l.amountCents, l.balanceCents]),
    [
      ["charge", "Rough-in complete — EST-1047", 1_000_000, 1_000_000],
      ["credit", "Credit: Allowance credit — EST-1047", -50_000, 950_000],
    ]
  );
  assert.equal(s.balanceCents, 950_000);
});

test("a customer with nothing billed has an empty statement and owes nothing", () => {
  const s = buildStatement([], [], [], { today: "2026-10-06", zone });
  assert.deepEqual(s.lines, []);
  assert.equal(s.balanceCents, 0);
});

test("the email: the balance, what's overdue, every line, and the link when something is owed", () => {
  const s = buildStatement(docs, stages, payments, { today: "2026-10-06", zone });
  const mail = statementEmail({
    companyName: "Summit Builders Co",
    customerName: "Jordan Ellis",
    today: "2026-10-06",
    statement: s,
    link: "https://crm.example.com/portal/verify?token=abc&next=%2Fportal",
  });
  assert.equal(mail.subject, "Summit Builders Co: your statement, $12,450.00 due");
  assert.match(mail.text, /^Hi Jordan Ellis,/);
  assert.match(mail.text, /Here's your statement as of Oct 6, 2026\./);
  assert.match(mail.text, /Balance due: \$12,450\.00 \(\$4,450\.00 past due\)/);
  assert.match(mail.text, /Payments on their way: \$8,000\.00, not counted until they arrive\./);
  assert.match(mail.text, /Sep 20, 2026 {2}Invoice INV-1004 {2}\$450\.00 {2}balance \$4,450\.00/);
  assert.match(mail.text, /View and pay: https:\/\/crm\.example\.com/);
  assert.match(mail.html, /<table/);
  assert.match(mail.html, />View and pay</);

  const settled = statementEmail({
    companyName: "Summit Builders Co",
    customerName: null,
    today: "2026-10-06",
    statement: buildStatement([doc({})], [], [pay({})], { today: "2026-10-06", zone }),
    link: null,
  });
  assert.equal(settled.subject, "Summit Builders Co: your statement, nothing due");
  assert.match(settled.text, /^Hi there,/);
  assert.match(settled.text, /Balance due: \$0\.00/);
  assert.doesNotMatch(settled.text, /View and pay/);
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the page is company money: gated like Invoices, and sending it like recording a payment", () => {
  const page = source("../../app/(app)/invoices/statement/[leadId]/page.tsx");
  assert.match(page, /canViewFinancials\(profile\)/);
  assert.match(page, /<PrintButton/);
  const action = source("../actions/statements.ts");
  assert.match(action, /export async function emailCustomerStatement\(leadId: string\)/);
  assert.match(action, /canManageBills\(profile\)/);
  assert.match(action, /\[Statement emailed\]/);
  // Read for this company and this customer only.
  const loader = source("./load-customer-statement.ts");
  assert.match(loader, /\.eq\("company_id", companyId\)\s*\.eq\("lead_id", leadId\)/);
});

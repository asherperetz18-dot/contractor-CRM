import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { receiptEmail, receiptFigures, receiptMethodLabel, refundEmail, type ReceiptEmailInput } from "./receipt-email.ts";

/**
 * Step 3b of full invoicing (DECISIONS #151): when money arrives -- paid
 * online, or recorded by hand -- the customer can be emailed a receipt
 * saying what was paid, for what, and what is still owed. An online
 * payment gets one by itself, once; a hand-recorded one when asked.
 */

const base: ReceiptEmailInput = {
  companyName: "Summit Builders Co",
  customerName: "Jordan Ellis",
  amountCents: 109_360,
  paidOn: "2026-10-06",
  method: "card",
  reference: null,
  isInvoice: true,
  isDeposit: false,
  docNumber: "INV-1004",
  title: "Site cleanup & permit",
  stageName: null,
  stageOwedCents: 0,
  paidToDateCents: 109_360,
  totalCents: 109_360,
};

test("an invoice paid in full: what, when, how, and that nothing is left", () => {
  const mail = receiptEmail(base);
  assert.equal(mail.subject, "Summit Builders Co: payment received, $1,093.60 for invoice INV-1004");
  assert.match(mail.text, /^Hi Jordan Ellis,/);
  assert.match(mail.text, /Thank you\. We received your payment of \$1,093\.60 for invoice INV-1004 \(Site cleanup & permit\)\./);
  assert.match(mail.text, /Amount: \$1,093\.60\nDate: Oct 6, 2026\nPaid by: Card\n/);
  assert.doesNotMatch(mail.text, /Reference/);
  assert.match(mail.text, /Invoice INV-1004 is paid in full\./);
  assert.match(mail.text, /Keep this email for your records\./);
  assert.match(mail.text, /Summit Builders Co$/);
  // Everything in the HTML is escaped: titles and names come from people.
  assert.match(mail.html, /Site cleanup &amp; permit/);
  assert.match(mail.html, /Hi Jordan Ellis,/);
});

test("part of an invoice: what's still owed on it", () => {
  const mail = receiptEmail({ ...base, amountCents: 50_000, stageOwedCents: 59_360, paidToDateCents: 50_000 });
  assert.match(mail.text, /Still owed on invoice INV-1004: \$593\.60\./);
  assert.doesNotMatch(mail.text, /paid in full/);
});

test("money on an invoice that isn't filed to its bill claims no balance", () => {
  const mail = receiptEmail({ ...base, stageOwedCents: null });
  assert.doesNotMatch(mail.text, /paid in full|Still owed/);
  assert.match(mail.text, /Paid by: Card\n\nKeep this email/);
});

test("a contract stage: what's left on that payment, and paid so far on the contract", () => {
  const mail = receiptEmail({
    ...base,
    isInvoice: false,
    docNumber: "EST-1047",
    title: "Kitchen remodel",
    stageName: "Rough-in complete",
    amountCents: 400_000,
    stageOwedCents: 100_000,
    paidToDateCents: 900_000,
    totalCents: 2_500_000,
    method: "us_bank_account",
  });
  assert.equal(mail.subject, "Summit Builders Co: payment received, $4,000.00 for Rough-in complete on EST-1047");
  assert.match(mail.text, /for Rough-in complete on EST-1047 \(Kitchen remodel\)\./);
  assert.match(mail.text, /Paid by: Bank transfer/);
  assert.match(mail.text, /Still owed on Rough-in complete: \$1,000\.00\./);
  assert.match(mail.text, /Paid so far on EST-1047: \$9,000\.00 of \$25,000\.00\./);
  // A stage settled in full says nothing about it; the contract line stays.
  const settled = receiptEmail({ ...base, isInvoice: false, docNumber: "EST-1047", title: null, stageName: "Rough-in complete", stageOwedCents: 0, paidToDateCents: 900_000, totalCents: 2_500_000 });
  assert.doesNotMatch(settled.text, /Still owed/);
  assert.match(settled.text, /for Rough-in complete on EST-1047\./);
  assert.match(settled.text, /Paid so far on EST-1047/);
});

test("a deposit by check: the check number, and what's been paid on the contract", () => {
  const mail = receiptEmail({
    ...base,
    isInvoice: false,
    isDeposit: true,
    docNumber: "EST-1047",
    title: "Kitchen remodel",
    amountCents: 100_000,
    method: "check",
    reference: "4417",
    stageOwedCents: null,
    paidToDateCents: 100_000,
    totalCents: 2_500_000,
  });
  assert.equal(mail.subject, "Summit Builders Co: payment received, $1,000.00 for the deposit on EST-1047");
  assert.match(mail.text, /for the deposit on EST-1047 \(Kitchen remodel\)\./);
  assert.match(mail.text, /Paid by: Check\nReference: 4417\n/);
  assert.match(mail.text, /Paid so far on EST-1047: \$1,000\.00 of \$25,000\.00\./);
});

test("no name on file still greets politely, and no method is no line", () => {
  const mail = receiptEmail({ ...base, customerName: " ", method: "other", reference: "<b>x</b>" });
  assert.match(mail.text, /^Hi there,/);
  assert.doesNotMatch(mail.text, /Paid by/);
  assert.match(mail.html, /Reference: &lt;b&gt;x&lt;\/b&gt;/);
});

test("how each method reads on a receipt", () => {
  assert.equal(receiptMethodLabel("card"), "Card");
  assert.equal(receiptMethodLabel("us_bank_account"), "Bank transfer");
  assert.equal(receiptMethodLabel("check"), "Check");
  assert.equal(receiptMethodLabel("cash"), "Cash");
  assert.equal(receiptMethodLabel("zelle"), "Zelle");
  assert.equal(receiptMethodLabel("wire"), "Wire transfer");
  assert.equal(receiptMethodLabel("other"), null);
  assert.equal(receiptMethodLabel(null), null);
});

test("the figures count only money that has arrived", () => {
  const stage = { id: "s1", amount_cents: 400_000, requested_at: "2026-10-01T00:00:00Z" };
  const payments: Parameters<typeof receiptFigures>[1] = [
    { estimate_payment_id: "s1", status: "succeeded", amount_cents: 300_000 },
    { estimate_payment_id: "s1", status: "pending", amount_cents: 100_000 },
    { estimate_payment_id: null, status: "succeeded", amount_cents: 100_000 },
    { estimate_payment_id: "s2", status: "failed", amount_cents: 50_000 },
  ];
  assert.deepEqual(receiptFigures(stage, payments), { stageOwedCents: 100_000, paidToDateCents: 400_000 });
  // A deposit has no stage to owe on.
  assert.deepEqual(receiptFigures(null, payments), { stageOwedCents: null, paidToDateCents: 400_000 });
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("an online payment gets one receipt by itself; a webhook never fails over it", () => {
  const send = source("./send-receipt.ts");
  // Once per payment: claimed before it goes, released if it doesn't.
  assert.match(send, /\.is\("receipt_sent_at", null\)/);
  assert.match(send, /update\(\{ receipt_sent_at: null \}\)/);
  // The company's switch (0207); a locked company sends nothing.
  assert.match(send, /receipt_emails_enabled === false/);
  assert.match(send, /lockedServicesError\(companyId\)/);
  // Only money that has arrived, for this company's payment.
  assert.match(send, /payment\.status !== "succeeded"/);
  assert.match(send, /\.eq\("company_id", companyId\)/);
  // Logged where the team already looks.
  assert.match(send, /\[Receipt emailed\]/);
  assert.match(send, /from\("sms_messages"\)\.insert\(/);

  const webhook = source("./stripe/handle-webhook.ts");
  assert.match(webhook, /await sendAutomaticReceipts\(admin, sessionId, companyId\)/);
  assert.match(webhook, /if \(settled\) await receiptsFor\(session\.id\);/);
  assert.match(webhook, /catch \{\s*\/\/ A receipt never fails the payment/);
  // A payment settled by Settings' reconcile (the webhook never came) gets
  // the receipt the webhook would have sent.
  const reconcile = source("./actions/stripe-admin.ts");
  assert.match(reconcile, /patch\.status === "succeeded"\) \{\s*try \{\s*await sendAutomaticReceipts\(admin, r\.stripe_session_id, profile\.company_id\)/);
});

test("a hand-recorded payment emails a receipt when asked, and any paid one can be sent again", () => {
  const manual = source("./actions/manual-payments.ts");
  assert.match(manual, /sendReceipt\?: boolean;/);
  assert.match(manual, /if \(input\.sendReceipt && cleared\)/);
  assert.match(manual, /export async function emailPaymentReceipt\(paymentId: string\)/);
  assert.match(manual, /automatic: false, sentBy: profile\.id/);
  // The Payments page asks for sends separately, and shrugs if 0207 hasn't run.
  const page = source("../app/(app)/payments/page.tsx");
  assert.match(page, /\.select\("id, receipt_sent_at"\)/);
  // The company's switch is an admin's to change.
  const settings = source("./actions/settings.ts");
  assert.match(settings, /export async function savePaymentReceiptSettings\(enabled: boolean\)/);
});

// ── Refund notices (DECISIONS #158) ────────────────────────────────────

const refund = {
  companyName: "Summit Builders Co",
  customerName: "Jordan Ellis",
  amountCents: 50_000,
  refundedOn: "2026-10-06",
  method: "check",
  reference: "2210",
  reason: "Paid for tile we didn't use",
  isInvoice: false,
  isDeposit: false,
  docNumber: "EST-1047",
  title: "Kitchen remodel",
  stageName: "Rough-in complete",
  stageOwedCents: 0,
  paidToDateCents: 950_000,
  totalCents: 2_500_000,
};

test("a refund notice: how much went back, for what, why, and how it was sent", () => {
  const mail = refundEmail(refund);
  assert.equal(mail.subject, "Summit Builders Co: refund of $500.00 for Rough-in complete on EST-1047");
  assert.match(mail.text, /^Hi Jordan Ellis,/);
  assert.match(mail.text, /We've refunded \$500\.00 to you for Rough-in complete on EST-1047 \(Kitchen remodel\)\./);
  assert.match(mail.text, /Amount: \$500\.00\nDate: Oct 6, 2026\nRefunded by: Check\nReference: 2210\nWhy: Paid for tile we didn't use\n/);
  // Nothing owed on the stage after it (a credit went with it).
  assert.match(mail.text, /Nothing more is owed on Rough-in complete\./);
  assert.match(mail.text, /Paid so far on EST-1047: \$9,500\.00 of \$25,000\.00\./);
  assert.doesNotMatch(mail.text, /payment received/i);
  // Names and reasons come from people: escaped in the HTML.
  assert.match(mail.html, /didn&#39;t use/);
});

test("a refund the customer still owes says so; a deposit and an invoice read as themselves", () => {
  const owed = refundEmail({ ...refund, stageOwedCents: 50_000 });
  assert.match(owed.text, /Still owed on Rough-in complete: \$500\.00\./);
  const deposit = refundEmail({ ...refund, isDeposit: true, stageName: null, stageOwedCents: null, reason: null, reference: null, method: "card" });
  assert.equal(deposit.subject, "Summit Builders Co: refund of $500.00 for the deposit on EST-1047");
  assert.match(deposit.text, /Refunded by: Card\n/);
  assert.doesNotMatch(deposit.text, /Why:|Reference:/);
  const invoice = refundEmail({ ...refund, isInvoice: true, docNumber: "INV-1004", stageName: null, stageOwedCents: 0 });
  assert.equal(invoice.subject, "Summit Builders Co: refund of $500.00 for invoice INV-1004");
  assert.match(invoice.text, /Nothing more is owed on invoice INV-1004\./);
});

test("a refund notice goes when the office asks, never by itself, and never before 'Still owed?' is answered", () => {
  const send = source("./send-receipt.ts");
  assert.match(send, /if \(payment\.amount_cents < 0\) \{/);
  assert.match(send, /if \(opts\.automatic\) return \{ skipped: "Refund notices go only when asked\." \};/);
  assert.match(send, /Answer "Still owed\?" on this refund first/);
  assert.match(send, /\[Refund notice emailed\]/);
  const manual = source("./actions/manual-payments.ts");
  assert.match(manual, /emailCustomer\?: boolean;/);
  assert.match(manual, /if \(input\.emailCustomer\)/);
  const view = source("../app/(app)/payments/payments-view.tsx");
  assert.match(view, /<ReceiptButton paymentId=\{r\.id\} sentAt=\{r\.receiptSentAt\} refund=\{r\.isRefund\} \/>/);
  assert.match(source("../app/(app)/payments/refund-payment.tsx"), /Email the customer that the money is coming back/);
});

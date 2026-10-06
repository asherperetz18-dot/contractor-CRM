import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { billChannelParts, billEmail, billRecipients, sentViaOf, sentViaLabel } from "./bill-email.ts";
import { buildInvoiceRows } from "./data/invoice-rows.ts";

/**
 * Step 3a of full invoicing (DECISIONS #150): a bill -- an invoice, or a
 * billed stage of a contract -- goes out by email as well as text, an
 * emailed invoice carries its PDF, and each send is recorded, so the
 * Invoices page can tell a bill that was sent from one only marked billed.
 */

const base = {
  companyName: "Summit Builders Co",
  customerName: "Jordan",
  docNumber: "INV-1004",
  title: "Site cleanup & permit",
  stageName: null as string | null,
  amountCents: 109_360,
  dueDate: "2026-10-21",
  termsLabel: "Net 15" as string | null,
  link: "https://crm.example.com/portal/verify?token=abc&next=%2Fportal%2Festimates%2F1",
};

test("an invoice email says what, how much and when, with the link to view and pay", () => {
  const mail = billEmail({ ...base, isInvoice: true });
  assert.equal(mail.subject, "Summit Builders Co: invoice INV-1004 for $1,093.60, due Oct 21, 2026");
  assert.match(mail.text, /^Hi Jordan,/);
  assert.match(mail.text, /Here's invoice INV-1004 for Site cleanup & permit\./);
  assert.match(mail.text, /Amount due: \$1,093\.60/);
  assert.match(mail.text, /Due: Oct 21, 2026 \(Net 15\)/);
  assert.ok(mail.text.includes(base.link));
  assert.match(mail.text, /A PDF copy is attached\./);
  // Everything in the HTML is escaped: titles and names come from people.
  assert.match(mail.html, /Site cleanup &amp; permit/);
  assert.ok(mail.html.includes(base.link.replace(/&/g, "&amp;")));
  assert.match(mail.html, />View and pay</);
});

test("a contract stage reads as a payment that's now due, with no PDF promised", () => {
  const mail = billEmail({
    ...base,
    isInvoice: false,
    docNumber: "EST-1047",
    title: "Kitchen remodel",
    stageName: "Rough-in complete",
    termsLabel: null,
  });
  assert.equal(mail.subject, "Summit Builders Co: Rough-in complete on EST-1047, $1,093.60 due Oct 21, 2026");
  assert.match(mail.text, /Payment for Rough-in complete on EST-1047 \(Kitchen remodel\) is now due\./);
  assert.match(mail.text, /Due: Oct 21, 2026\n/);
  assert.doesNotMatch(mail.text, /PDF/);
});

test("no name on file still greets politely", () => {
  assert.match(billEmail({ ...base, isInvoice: true, customerName: null }).text, /^Hi there,/);
  assert.match(billEmail({ ...base, isInvoice: true, customerName: "<b>x</b>" }).html, /Hi &lt;b&gt;x&lt;\/b&gt;,/);
});

test("who an emailed bill goes to: the customer, with the second contact copied", () => {
  assert.deepEqual(billRecipients("a@example.com", "b@example.com"), { to: ["a@example.com"], cc: ["b@example.com"] });
  assert.deepEqual(billRecipients(null, "b@example.com"), { to: ["b@example.com"], cc: [] });
  assert.deepEqual(billRecipients("a@example.com", " A@Example.com "), { to: ["a@example.com"], cc: [] });
  assert.deepEqual(billRecipients(" ", null), { to: [], cc: [] });
  assert.deepEqual(billRecipients("not an email", null), { to: [], cc: [] });
});

test("channels, and how a send is recorded and read back", () => {
  assert.deepEqual(billChannelParts("text"), { text: true, email: false });
  assert.deepEqual(billChannelParts("email"), { text: false, email: true });
  assert.deepEqual(billChannelParts("both"), { text: true, email: true });
  assert.equal(sentViaOf(true, false), "text");
  assert.equal(sentViaOf(false, true), "email");
  assert.equal(sentViaOf(true, true), "text+email");
  assert.equal(sentViaOf(false, false), null);
  assert.equal(sentViaLabel("text+email"), "by text and email");
  assert.equal(sentViaLabel("email"), "by email");
  assert.equal(sentViaLabel(null), null);
});

test("a bill that was sent reads Sent; one only marked billed still reads Billed", () => {
  const rows = buildInvoiceRows(
    [{ id: "c1", lead_id: "l", doc_number: "EST-1", title: "Kitchen", kind: "contract", status: "Signed", signed_at: "2026-08-01T00:00:00Z", created_at: "2026-08-01T00:00:00Z", total_cents: 1 }],
    [
      { id: "s1", estimate_id: "c1", sort_order: 0, name: "A", amount_cents: 100, requested_at: "2026-10-01T00:00:00Z", due_date: "2026-10-30", cancelled_at: null },
      { id: "s2", estimate_id: "c1", sort_order: 1, name: "B", amount_cents: 100, requested_at: "2026-10-01T00:00:00Z", due_date: "2026-10-30", cancelled_at: null },
    ],
    [],
    new Map(),
    "2026-10-06",
    new Map([["s1", "2026-10-01T00:00:00Z"]])
  );
  assert.equal(rows.find((r) => r.id === "s1")!.status, "sent");
  assert.equal(rows.find((r) => r.id === "s2")!.status, "billed");
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("one send path for every bill, recorded after it goes out, never blocking the billing", () => {
  const billing = source("./actions/progress-billing.ts");
  assert.match(billing, /export async function requestProgressPayment\(\s*phaseId: string,\s*dueDate\?: string,\s*channel: BillChannel = "text"\s*\)/);
  // A re-send keeps the day it was first billed.
  assert.match(billing, /requested_at: phase\.requested_at \?\? now/);
  // The send record is its own write, so a database without 0206 still bills.
  assert.match(billing, /\.update\(\{ sent_at: now, sent_via: via \}\)/);
  // Emailed invoices carry the PDF; logged where the team already looks.
  assert.match(billing, /invoicePdfAttachment\(/);
  assert.match(billing, /from\("sms_messages"\)\.insert\(/);
  // The Invoices page asks for sends separately, and shrugs if 0206 hasn't run.
  const loader = source("./data/load-invoice-rows.ts");
  assert.match(loader, /\.select\("id, sent_at"\)/);
  const email = source("./email-env.ts");
  assert.match(email, /if \(options\.attachments\?\.length\) body\.attachments = options\.attachments;/);
});

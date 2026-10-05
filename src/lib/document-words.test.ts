import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  changeOrderOnePaymentLine,
  changeOrderScheduleNote,
  documentLabels,
  documentPaymentSection,
  depositDueLine,
  documentWord,
  paymentPercentLabel,
  scheduledPhases,
} from "./document-words.ts";
import { STANDARD_WORDS, readCompanyWords } from "./company-words.ts";

/**
 * The labels printed on a document -- the portal's web copy and the PDF
 * read the same ones (DECISIONS #122), in the company's words, so a
 * company that says "Agreement" and "Homeowner" never prints "contract"
 * and "Customer" on the page its customer signs.
 */

const WORDS = readCompanyWords({
  estimate: { one: "Quote", many: "Quotes" },
  project: { one: "Job", many: "Jobs" },
  contract: { one: "Agreement", many: "Agreements" },
  customer: { one: "Homeowner", many: "Homeowners" },
  change_order: { one: "Amendment", many: "Amendments" },
  deposit: { one: "Down Payment", many: "Down Payments" },
});

test("each kind of document is called what it is", () => {
  assert.equal(documentWord(null, WORDS).one, "Quote");
  assert.equal(documentWord("contract", WORDS).one, "Quote");
  assert.equal(documentWord("change_order", WORDS).one, "Amendment");
  assert.equal(documentWord("completion", WORDS).one, "Completion Certificate");
  assert.equal(documentWord("invoice", WORDS).one, "Invoice");
});

test("an estimate's labels, in the company's words", () => {
  const l = documentLabels("contract", WORDS);
  assert.equal(l.banner, null);
  assert.equal(l.untitled, "Quote");
  assert.equal(l.preparedFor, "Prepared for");
  assert.equal(l.forLabel, "Job");
  assert.equal(l.locationLabel, "Job location");
  assert.equal(l.deposit, "Down Payment");
  assert.equal(l.depositDue, "Due upon agreement signing");
  assert.equal(l.customerParty, "Homeowner");
  assert.equal(l.contractorParty, "Contractor");
  assert.equal(l.totalLabel, "Total");
});

test("a change order says so, and what it amends", () => {
  const l = documentLabels("change_order", WORDS);
  assert.equal(l.banner, "AMENDMENT");
  assert.equal(l.parentLink, "To agreement");
  assert.equal(l.originalParent, "Original agreement");
  assert.equal(l.revisedTotal, "Revised agreement total");
  assert.equal(l.totalLabel, "This amendment");
});

test("a change order's deposit and schedule are its own, in the company's words", () => {
  const l = documentLabels("change_order", WORDS);
  assert.equal(l.scheduleHeading, "Payment schedule for this amendment");
  // Not "upon agreement signing": the agreement was signed long ago.
  assert.equal(l.depositDue, "Due when you sign this amendment");
  assert.equal(documentLabels("contract", WORDS).scheduleHeading, "Payment schedule");
  assert.equal(
    changeOrderScheduleNote("EST-1112", WORDS),
    "These payments are for this amendment only. They don't change the payments already scheduled on your agreement EST-1112."
  );
});

test("a change order with no stages says how it is billed", () => {
  assert.equal(
    changeOrderOnePaymentLine(850000, "EST-1112", STANDARD_WORDS),
    "Billed as one payment of $8,500.00, added to the payment schedule of your contract EST-1112."
  );
  // A credit is money back, not a payment of minus $500.
  assert.equal(
    changeOrderOnePaymentLine(-50000, "EST-1112", WORDS),
    "A credit of $500.00, taken off the payment schedule of your agreement EST-1112."
  );
});

test("which payment section a document prints", () => {
  const doc = { depositCents: null, phaseCount: 0, totalCents: 850000, hasParent: true };
  // A change order's own stages are what it is collected on (DECISIONS
  // #015), so the customer signing it reads them -- this used to print
  // nothing at all on a change order.
  assert.equal(documentPaymentSection({ ...doc, kind: "change_order", phaseCount: 1 }), "schedule");
  assert.equal(documentPaymentSection({ ...doc, kind: "change_order", depositCents: 425000 }), "schedule");
  // No stages of its own: the one row signing adds to the contract.
  assert.equal(documentPaymentSection({ ...doc, kind: "change_order" }), "one-payment");
  // Nothing to say without the contract to name, or with nothing owed.
  assert.equal(documentPaymentSection({ ...doc, kind: "change_order", hasParent: false }), null);
  assert.equal(documentPaymentSection({ ...doc, kind: "change_order", totalCents: 0 }), null);
  // A contract prints its schedule when it has one, as always.
  assert.equal(documentPaymentSection({ ...doc, kind: "contract", phaseCount: 3, hasParent: false }), "schedule");
  assert.equal(documentPaymentSection({ ...doc, kind: "contract", hasParent: false }), null);
  // An invoice's Pay card is its payment terms.
  assert.equal(documentPaymentSection({ ...doc, kind: "invoice", phaseCount: 1 }), null);
});

test("a stage's share of the total prints as a percent", () => {
  assert.equal(paymentPercentLabel(425000, 850000), "50.00%");
  // The PDF printed the raw number: "(33.333333333333336)".
  assert.equal(paymentPercentLabel(100000, 300000), "33.33%");
  assert.equal(paymentPercentLabel(100000, 0), null);
});

test("the Pay card says why a deposit is due", () => {
  assert.equal(depositDueLine("contract", 425000, WORDS), "$4,250.00 is due to schedule your job.");
  // A change order's job is already on the calendar.
  assert.equal(
    depositDueLine("change_order", 425000, WORDS),
    "$4,250.00 is due now that you've signed this amendment."
  );
});

test("a cancelled stage is not printed as owed", () => {
  // Voiding a document cancels its unbilled stages; billed ones stay,
  // because that request really went out.
  const phases = [
    { id: "a", amount_cents: 100, cancelled_at: null },
    { id: "b", amount_cents: 200, cancelled_at: "2026-10-05T20:00:00Z" },
    { id: "c", amount_cents: 300 },
  ];
  assert.deepEqual(
    scheduledPhases(phases).map((p) => p.id),
    ["a", "c"]
  );
});

test("a certificate and an invoice keep their own names", () => {
  assert.equal(documentLabels("completion", WORDS).banner, "CERTIFICATE OF COMPLETION");
  const inv = documentLabels("invoice", WORDS);
  assert.equal(inv.banner, "INVOICE");
  assert.equal(inv.preparedFor, "Bill to");
  assert.equal(inv.forLabel, "For");
  assert.equal(inv.parentLink, "For agreement");
  assert.equal(inv.totalLabel, "Amount due");
  assert.equal(inv.untitled, "Invoice");
});

test("the standard words read as the documents always have", () => {
  const l = documentLabels(null, STANDARD_WORDS);
  assert.equal(l.untitled, "Estimate");
  assert.equal(l.forLabel, "Project");
  assert.equal(l.depositDue, "Due upon contract signing");
  assert.equal(l.customerParty, "Customer");
  assert.equal(documentLabels("change_order", STANDARD_WORDS).banner, "CHANGE ORDER");
  assert.equal(documentLabels("change_order", STANDARD_WORDS).revisedTotal, "Revised contract total");
});

test("the web copy and the PDF print no document labels of their own", () => {
  // Both read documentLabels(), so a company's words reach both and the
  // two can't disagree (the PDF used to have no INVOICE banner at all).
  for (const file of ["../components/estimate-document.tsx", "./pdf/document-pdf.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const label of [
      /"CHANGE ORDER"/,
      /"PREPARED FOR"|"Prepared for"/,
      /Job location|JOB LOCATION/,
      /Revised contract total/,
      /[Dd]ue upon contract signing/,
      /"This change order"/,
      /\? "Contractor"|"Customer"/,
      /"Payment schedule"|>Payment schedule</,
    ]) {
      assert.doesNotMatch(source, label, `${file}: ${label}`);
    }
  }
});

test("the web copy and the PDF pick the same payment section", () => {
  // The PDF is the signed copy the customer keeps: it must not drop the
  // schedule the web page showed them when they signed.
  for (const file of ["../components/estimate-document.tsx", "./pdf/document-pdf.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /documentPaymentSection\(/, file);
    assert.match(source, /changeOrderScheduleNote\(/, file);
    assert.match(source, /changeOrderOnePaymentLine\(/, file);
    assert.match(source, /paymentPercentLabel\(/, file);
    // The PDF dropped cancelled stages and the web copy listed them.
    assert.match(source, /scheduledPhases\(/, file);
  }
});

test("the Pay card reads its reason from the shared wording", () => {
  const source = readFileSync(new URL("../app/portal/estimates/[id]/deposit-payment.tsx", import.meta.url), "utf8");
  assert.match(source, /depositDueLine\(/);
  assert.doesNotMatch(source, /is due to schedule your/);
});

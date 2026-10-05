import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { documentLabels, documentWord } from "./document-words.ts";
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
    ]) {
      assert.doesNotMatch(source, label, `${file}: ${label}`);
    }
  }
});

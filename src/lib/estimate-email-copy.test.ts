import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultEstimateNarrative,
  documentCallToAction,
  documentQuestionsLine,
  documentSendSms,
  documentSendSubject,
  paragraphsToHtml,
} from "./estimate-email-copy.ts";
import { readFileSync } from "node:fs";
import { STANDARD_WORDS, readCompanyWords } from "./company-words.ts";

const PROPOSAL_AND_JOB = readCompanyWords({
  estimate: { one: "Proposal", many: "Proposals" },
  project: { one: "Job", many: "Jobs" },
  change_order: { one: "Amendment", many: "Amendments" },
});

test("defaultEstimateNarrative: full sentence with title and address", () => {
  const text = defaultEstimateNarrative({
    companyName: "Aloush Contracting",
    docNumber: "EST-1214",
    title: "Kitchen Remodel",
    projectAddress: "482 Alder Way, Portland, OR 97205",
    totalCents: 1436478,
  });
  assert.match(text, /on your Kitchen Remodel project/);
  // The company's word for it -- "Estimate" unless it chose another.
  assert.match(text, /Aloush Contracting has prepared estimate #EST-1214/);
  assert.match(text, /The grand total of the estimate is/);
  assert.match(text, /at 482 Alder Way, Portland, OR 97205/);
  assert.match(text, /\$14,364\.78/);
});

test("defaultEstimateNarrative: drops the project/address clauses whole when absent, not a blank", () => {
  const text = defaultEstimateNarrative({
    companyName: "Aloush Contracting",
    docNumber: "EST-1214",
    title: null,
    projectAddress: null,
    totalCents: 100000,
  });
  assert.match(text, /work with you\./);
  assert.doesNotMatch(text, /on your.*project/);
  assert.match(text, /for your project\. The grand total/);
  assert.doesNotMatch(text, / at \./);
});

test("defaultEstimateNarrative: three paragraphs separated by a blank line", () => {
  const text = defaultEstimateNarrative({
    companyName: "Aloush Contracting",
    docNumber: "EST-1214",
    title: null,
    projectAddress: null,
    totalCents: 100000,
  });
  const paragraphs = text.split(/\n\s*\n/);
  assert.equal(paragraphs.length, 3);
});

test("paragraphsToHtml: wraps each paragraph in its own <p>, escaping HTML", () => {
  const html = paragraphsToHtml("Hello <script>alert(1)</script>\n\nSecond paragraph");
  assert.match(html, /<p>Hello &lt;script&gt;alert\(1\)&lt;\/script&gt;<\/p>/);
  assert.match(html, /<p>Second paragraph<\/p>/);
  assert.doesNotMatch(html, /<script>/);
});

test("paragraphsToHtml: trims stray whitespace and drops empty paragraphs", () => {
  const html = paragraphsToHtml("  First  \n\n\n\n  Second  ");
  assert.equal(html, "<p>First</p>\n<p>Second</p>");
});

// ── One send, one word (DECISIONS #121) ──────────────────────────────
// The text used to say "estimate" and the email "proposal" for the same
// send, and a change order or completion certificate went out as
// "your estimate ... the grand total of the proposal is $0.00".

const base = { companyName: "Summit Builders Co", docNumber: "EST-1012", title: "Kitchen Remodel", projectAddress: null, totalCents: 250000 };

test("the text, the subject and the email all use the company's word", () => {
  const sms = documentSendSms({ ...base, kind: "contract", words: PROPOSAL_AND_JOB, link: "https://x.example.com/l" });
  assert.equal(
    sms,
    "Summit Builders Co: your proposal EST-1012 is ready to review and sign.\nhttps://x.example.com/l\n\nLink expires in 7 days."
  );
  assert.equal(
    documentSendSubject({ ...base, kind: null, words: PROPOSAL_AND_JOB }),
    "Summit Builders Co: your proposal EST-1012 is ready to review"
  );
  const text = defaultEstimateNarrative({ ...base, kind: "contract", words: PROPOSAL_AND_JOB });
  assert.match(text, /on your Kitchen Remodel job\./);
  assert.match(text, /has prepared proposal #EST-1012 for your job\. The grand total of the proposal is \$2,500\.00/);
  assert.doesNotMatch(text, /estimate|project/i);
  assert.match(documentQuestionsLine("contract", PROPOSAL_AND_JOB), /questions about the proposal/);
});

test("a change order is sent as a change order, in the company's word", () => {
  const co = { ...base, docNumber: "EST-1012-CO1", kind: "change_order" };
  assert.match(documentSendSms({ ...co, words: STANDARD_WORDS, link: "L" }), /your change order EST-1012-CO1 is ready to review and sign/);
  assert.match(documentSendSubject({ ...co, words: PROPOSAL_AND_JOB }), /your amendment EST-1012-CO1/);
  const text = defaultEstimateNarrative({ ...co, words: STANDARD_WORDS });
  assert.match(text, /has prepared change order #EST-1012-CO1 for your project/);
  assert.match(text, /The total of this change order is \$2,500\.00/);
  assert.doesNotMatch(text, /estimate|proposal|grand total/i);
});

test("a completion certificate names no price and asks for a sign-off", () => {
  const cert = { ...base, docNumber: "EST-1012-COMP", totalCents: 0, kind: "completion" };
  assert.match(
    documentSendSms({ ...cert, words: STANDARD_WORDS, link: "L" }),
    /your completion certificate EST-1012-COMP is ready to review and sign/
  );
  const text = defaultEstimateNarrative({ ...cert, words: PROPOSAL_AND_JOB });
  assert.match(text, /completion certificate #EST-1012-COMP for your job/);
  assert.doesNotMatch(text, /\$|total|proposal|estimate/i);
  assert.equal(documentCallToAction("completion"), "Review & Sign");
});

test("an invoice is sent to view, not to sign", () => {
  const inv = { ...base, docNumber: "INV-1003", kind: "invoice" };
  const sms = documentSendSms({ ...inv, words: STANDARD_WORDS, link: "L" });
  assert.match(sms, /your invoice INV-1003 is ready to view\./);
  assert.doesNotMatch(sms, /sign/);
  const text = defaultEstimateNarrative({ ...inv, words: STANDARD_WORDS });
  assert.match(text, /The amount due is \$2,500\.00/);
  assert.doesNotMatch(text, /sign/);
  assert.equal(documentCallToAction("invoice"), "View Invoice");
});

test("a text message stays plain: no dashes or emoji that would double its cost", () => {
  for (const kind of ["contract", "change_order", "completion", "invoice"]) {
    const sms = documentSendSms({ ...base, kind, words: PROPOSAL_AND_JOB, link: "https://x.example.com/l" });
    assert.match(sms, /^[\x20-\x7E\n]*$/, kind);
  }
});

test("the send code names no document itself: the words come from here", () => {
  for (const file of ["./actions/estimates.ts", "./actions/portal.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /your (estimate|proposal|change order|project portal)\b/i, file);
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FINANCING_STATUS_LABEL,
  currentFinancing,
  financingEmail,
  financingEventError,
  financingText,
  movesToPendingFinance,
} from "./financing.ts";

/**
 * Customer financing, step 1, part two (DECISIONS #162): on the estimate,
 * the office sends the customer the lender's link and keeps track of
 * where the application stands -- link sent, applied, approved, declined,
 * funded -- by hand, since nothing comes back from the lender yet.
 */

test("where an estimate's financing stands is its newest entry", () => {
  assert.equal(currentFinancing([]), null);
  const now = currentFinancing([
    { status: "sent", amount_cents: null, note: null, created_at: "2026-10-01T17:00:00Z" },
    { status: "approved", amount_cents: 2_000_000, note: "12 months", created_at: "2026-10-04T17:00:00Z" },
    { status: "applied", amount_cents: null, note: null, created_at: "2026-10-02T17:00:00Z" },
  ]);
  assert.equal(now?.status, "approved");
  assert.equal(FINANCING_STATUS_LABEL[now!.status], "Approved");
  assert.equal(FINANCING_STATUS_LABEL.sent, "Link sent");
});

test("what the office records is checked: a real status, an amount only once approved", () => {
  assert.equal(financingEventError({ status: "applied" }), null);
  assert.equal(financingEventError({ status: "approved", amountCents: 2_000_000, note: "12 months same as cash" }), null);
  assert.equal(financingEventError({ status: "funded", amountCents: 2_000_000 }), null);
  assert.match(financingEventError({ status: "maybe" })!, /status/i);
  assert.match(financingEventError({ status: "applied", amountCents: 100 })!, /amount/i);
  assert.match(financingEventError({ status: "approved", amountCents: 0 })!, /amount/i);
  assert.match(financingEventError({ status: "approved", amountCents: -5 })!, /amount/i);
  assert.match(financingEventError({ status: "declined", note: "x".repeat(501) })!, /long/i);
});

test("applied or approved moves the lead to Pending Finance, unless it's further along or do-not-contact", () => {
  assert.equal(movesToPendingFinance("applied", "proposal_sent"), true);
  assert.equal(movesToPendingFinance("approved", "appointment_set"), true);
  // A company's own stage has no tag: it moves too.
  assert.equal(movesToPendingFinance("applied", null), true);
  assert.equal(movesToPendingFinance("applied", "pending_finance"), false);
  assert.equal(movesToPendingFinance("approved", "close_to_sale"), false);
  assert.equal(movesToPendingFinance("approved", "won"), false);
  assert.equal(movesToPendingFinance("applied", "dnc"), false);
  // Sent, declined and funded never move the lead.
  assert.equal(movesToPendingFinance("sent", "proposal_sent"), false);
  assert.equal(movesToPendingFinance("declined", "proposal_sent"), false);
  assert.equal(movesToPendingFinance("funded", "proposal_sent"), false);
});

test("the text and email: the company, the document, the lender's link, and no rate or payment claims", () => {
  const text = financingText({ companyName: "Summit Builders Co", provider: "Wisetack", url: "https://example.com/apply", docNumber: "EST-1047" });
  assert.match(text, /^Summit Builders Co: /);
  assert.match(text, /EST-1047/);
  assert.match(text, /Wisetack/);
  assert.match(text, /https:\/\/example\.com\/apply/);
  // A plain hyphen, never an em dash: one re-encodes the whole text.
  assert.doesNotMatch(text, /[—–]/);

  const mail = financingEmail({
    companyName: "Summit Builders Co",
    customerName: "Jordan <Ellis>",
    provider: "Wisetack",
    url: "https://example.com/apply?a=1&b=2",
    docNumber: "EST-1047",
    title: "Kitchen remodel",
  });
  assert.equal(mail.subject, "Summit Builders Co: apply for financing with Wisetack");
  assert.match(mail.text, /^Hi Jordan <Ellis>,/);
  assert.match(mail.text, /EST-1047 \(Kitchen remodel\)/);
  assert.match(mail.text, /Apply for financing: https:\/\/example\.com\/apply\?a=1&b=2/);
  assert.match(mail.html, /Jordan &lt;Ellis&gt;/);
  assert.match(mail.html, /href="https:\/\/example\.com\/apply\?a=1&amp;b=2"/);
  for (const s of [text, mail.text, mail.html]) {
    assert.doesNotMatch(s, /APR|%|\/mo|per month|a month|as low as|credit score/i);
  }
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("each step is kept, in the database, by the people who work estimates", () => {
  const sql = source("../../supabase/migrations/0215_estimate_financing.sql");
  assert.match(sql, /create table if not exists public\.estimate_financing_events/);
  assert.match(sql, /status text not null check \(status in \('sent', 'applied', 'approved', 'declined', 'funded'\)\)/);
  assert.match(sql, /estimate_id uuid not null references public\.estimates \(id\) on delete cascade/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /select public\.apply_billing_lock_policies\(\);/);
  assert.match(sql, /as estimate_financing_ready;/);

  const actions = source("./actions/financing.ts");
  for (const fn of ["recordFinancingStatus", "sendFinancingLink"]) {
    const body = actions.slice(actions.indexOf(`export async function ${fn}(`));
    assert.match(body, /canWorkFinancing\(profile\)/, fn);
  }
  assert.match(actions, /const canWorkFinancing = \(p: Profile\) => canCreateEstimates\(p\) \|\| canManageBills\(p\);/);
  // Sending is paused for a locked company, and each send is in the contact's messages.
  const send = actions.slice(actions.indexOf("export async function sendFinancingLink("));
  assert.match(send, /lockedServicesError\(/);
  assert.match(send, /\.from\("sms_messages"\)\.insert\(/);
  assert.match(send, /\[Financing link emailed\]/);
  // The stage moves by its tag, like every other automatic move.
  assert.match(actions, /advanceStageOnFinancing\(/);
  assert.match(source("./pipeline/advance-stage.ts"), /export function advanceStageOnFinancing\(/);

  // Kept with the rest of a company's data, and with a deleted contact in Trash.
  assert.match(source("./backup-scope.ts"), /"estimate_financing_events"/);
  assert.match(source("./lead-trash.ts"), /"estimate_financing_events"/);
});

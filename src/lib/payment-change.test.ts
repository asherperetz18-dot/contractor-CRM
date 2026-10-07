import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  openPaymentChange,
  paymentChangeEmail,
  paymentChangeFigures,
  paymentChangeSms,
  signedNameMatches,
} from "./payment-change.ts";

/**
 * Switching a signed contract to financing (DECISIONS #166): the customer
 * signs a one-page payment change; while it's signed, the contract's
 * unpaid payments are paid through the lender -- no bills or reminders
 * for them -- and "Back to the original schedule" ends it.
 */

const stage = (id: string, sort_order: number, amount_cents: number, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Stage ${id}`,
  sort_order,
  amount_cents,
  credit_cents: 0,
  cancelled_at: null as string | null,
  requested_at: null as string | null,
  ...extra,
});
const paid = (estimate_payment_id: string | null, amount_cents: number, extra: Record<string, unknown> = {}) => ({
  estimate_payment_id,
  kind: estimate_payment_id ? "progress" : "deposit",
  status: "succeeded",
  amount_cents,
  stripe_session_id: null as string | null,
  stripe_payment_intent_id: null as string | null,
  ...extra,
});

test("the mockup's contract: $4,200 paid, $37,800 to finance, row by row", () => {
  const f = paymentChangeFigures({
    depositDueCents: 420_000,
    stages: [
      stage("rough", 1, 1_500_000, { name: "Rough-in", requested_at: "2026-10-03T12:00:00Z" }),
      stage("dry", 2, 1_500_000, { name: "Drywall & finish" }),
      stage("final", 3, 780_000, { name: "Final walkthrough" }),
    ],
    payments: [paid(null, 420_000)],
  });
  assert.equal(f.totalCents, 4_200_000);
  assert.equal(f.creditCents, 0);
  assert.equal(f.paidCents, 420_000);
  assert.equal(f.financeCents, 3_780_000);
  assert.deepEqual(
    f.rows.map((r) => [r.label, r.cents, r.owedCents, r.state]),
    [
      ["Deposit", 420_000, 0, "paid"],
      ["Rough-in", 1_500_000, 1_500_000, "billed"],
      ["Drywall & finish", 1_500_000, 1_500_000, "open"],
      ["Final walkthrough", 780_000, 780_000, "open"],
    ]
  );
});

test("an unpaid deposit is financed too; credits, part payments and cancelled stages count as they do everywhere", () => {
  const f = paymentChangeFigures({
    depositDueCents: 100_000,
    stages: [
      stage("a", 1, 500_000, { credit_cents: 50_000, requested_at: "2026-10-01T00:00:00Z" }),
      stage("b", 2, 400_000),
      stage("gone", 3, 999_999, { cancelled_at: "2026-10-02T00:00:00Z" }),
    ],
    payments: [
      paid("a", 150_000),
      // A checkout opened and left is nothing.
      paid("b", 400_000, { status: "pending", stripe_session_id: "cs_1" }),
    ],
  });
  assert.equal(f.totalCents, 1_000_000);
  assert.equal(f.creditCents, 50_000);
  assert.equal(f.financeCents, 100_000 + 300_000 + 400_000);
  assert.equal(f.paidCents, 150_000);
  assert.deepEqual(
    f.rows.map((r) => [r.label, r.owedCents, r.state]),
    [
      ["Deposit", 100_000, "open"],
      ["Stage a", 300_000, "billed"],
      ["Stage b", 400_000, "open"],
    ]
  );
});

test("nothing left to pay: nothing to finance", () => {
  const f = paymentChangeFigures({
    depositDueCents: 0,
    stages: [stage("a", 1, 200_000)],
    payments: [paid("a", 200_000)],
  });
  assert.equal(f.financeCents, 0);
  assert.equal(f.paidCents, 200_000);
  assert.equal(f.rows[0].state, "paid");
});

test("the open change is the one sent or signed; ended ones don't count", () => {
  assert.equal(openPaymentChange([]), null);
  const rows = [
    { id: "1", status: "reverted" },
    { id: "2", status: "cancelled" },
    { id: "3", status: "signed" },
  ];
  assert.equal(openPaymentChange(rows)?.id, "3");
  assert.equal(openPaymentChange([{ id: "4", status: "sent" }])?.id, "4");
  assert.equal(openPaymentChange([{ id: "5", status: "reverted" }]), null);
});

test("signing: the name typed is the contract's signer's, ignoring case and spaces", () => {
  assert.equal(signedNameMatches("maria  lopez ", "Maria Lopez"), true);
  assert.equal(signedNameMatches("Mario Lopez", "Maria Lopez"), false);
  // Signed on paper, or no name on file: any full name of two letters or more.
  assert.equal(signedNameMatches("Maria Lopez", null), true);
  assert.equal(signedNameMatches(" M ", null), false);
  assert.equal(signedNameMatches("", "Maria Lopez"), false);
});

test("the text: plain characters, the amount, the lender, the link; the lender's link only when asked", () => {
  const base = {
    companyName: "Summit Builders Co",
    docNumber: "EST-1047",
    lender: "Service Finance",
    financeCents: 3_780_000,
    link: "https://crm.example.com/portal/verify?token=abc&next=%2Fportal%2Festimates%2Fe1",
  };
  const plain = paymentChangeSms(base);
  assert.equal(
    plain,
    "Summit Builders Co: please review and sign a payment change for EST-1047 - the rest, $37,800.00, to be paid through Service Finance instead of to us directly:\n" +
      base.link
  );
  // No em dash or emoji: either re-encodes the text and shrinks each part to 70 characters.
  assert.doesNotMatch(plain, /[—–\u{1F300}-\u{1FAFF}]/u);
  const withApply = paymentChangeSms({ ...base, applyUrl: "https://lender.example.com/apply?d=1" });
  assert.ok(withApply.endsWith("\n\nApply with Service Finance here:\nhttps://lender.example.com/apply?d=1"));

  const mail = paymentChangeEmail({ ...base, customerName: "Maria <Lopez>", applyUrl: null });
  assert.equal(mail.subject, "Payment change to sign for EST-1047");
  assert.match(mail.html, /Maria &lt;Lopez&gt;/);
  assert.match(mail.html, /\$37,800\.00/);
  assert.match(mail.text, /Service Finance decides on your application and sets its terms/);
  // Never a rate or a monthly payment: only the lender states those.
  assert.doesNotMatch(mail.text + plain + withApply, /APR|per month|\/mo\b|interest/i);
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the table: one open change per contract, signed once with a name, server-written, locked with the company", () => {
  const sql = source("../../supabase/migrations/0217_contract_payment_changes.sql");
  assert.match(sql, /create table if not exists public\.contract_payment_changes/);
  assert.match(sql, /status in \('sent', 'signed', 'cancelled', 'reverted'\)/);
  assert.match(sql, /contract_payment_changes_one_open\s+on public\.contract_payment_changes \(estimate_id\)\s+where status in \('sent', 'signed'\)/);
  assert.match(sql, /check \(status <> 'signed' or \(signed_name is not null and signed_at is not null\)\)/);
  assert.match(sql, /for select\s+to authenticated/);
  assert.doesNotMatch(sql, /for (insert|update|delete|all)/);
  assert.match(sql, /select public\.apply_billing_lock_policies\(\);/);
  assert.match(sql, /as payment_changes_ready;/);
});

test("while it's signed, nothing bills or reminds the customer for that contract", () => {
  // The reminder job leaves the contract's stages alone.
  const reminders = source("./bill-reminders-run.ts");
  assert.match(reminders, /financedContracts\(admin, companyId\)/);
  assert.match(reminders, /financed\.has\(/);
  // Billing a stage, by hand or from Money to Collect, is refused.
  const billing = source("./actions/progress-billing.ts");
  for (const fn of ["requestProgressPayment", "markProgressPaymentBilled"]) {
    const body = billing.slice(billing.indexOf(`export async function ${fn}(`));
    assert.match(body.slice(0, 4000), /financedBillingError\(/, fn);
  }
  assert.match(source("./actions/receivables.ts"), /financedBillingError\(/);
  // A completion certificate signed later doesn't bill the financed stages.
  assert.match(source("./estimate-signing.ts"), /financedLender\(admin, estimate\.parent_estimate_id\)/);
  // The customer page asks for none of it, and its checkouts refuse.
  const portal = source("./actions/portal-payments.ts");
  for (const fn of ["startPhaseCheckout", "startDepositCheckout"]) {
    const body = portal.slice(portal.indexOf(`export async function ${fn}(`));
    assert.match(body.slice(0, 5000), /financedLender\(/, fn);
  }
});

test("the office's switch, the customer's signature, and the way back", () => {
  const actions = source("./actions/payment-change.ts");
  for (const fn of ["sendPaymentChange", "cancelPaymentChange", "revertPaymentChange"]) {
    assert.match(actions, new RegExp(`export async function ${fn}\\(`), fn);
  }
  const send = actions.slice(actions.indexOf("export async function sendPaymentChange("));
  assert.match(send, /lockedServicesError\(/);
  assert.match(send, /doc\.status !== "Signed"/);
  assert.match(send, /createLoginToken\(/);
  assert.match(send, /&next=\$\{encodeURIComponent\(`\/portal\/estimates\/\$\{doc\.id\}`\)\}/);
  assert.match(send, /\.from\("sms_messages"\)\.insert\(/);
  const revert = actions.slice(actions.indexOf("export async function revertPaymentChange("));
  assert.match(revert, /\.eq\("status", "signed"\)/);
  assert.match(revert, /status: "reverted"/);

  const portal = source("./actions/portal-estimates.ts");
  const sign = portal.slice(portal.indexOf("export async function signPaymentChange("));
  assert.match(sign, /getPortalViewer\(\)|loadForViewer\(/);
  assert.match(sign, /signedNameMatches\(/);
  assert.match(sign, /collectSignatureEvidence\(/);
  // Signed once: the update only takes a change still waiting.
  assert.match(sign, /\.eq\("status", "sent"\)/);

  assert.match(source("../app/(app)/estimates/[id]/financing-panel.tsx"), /Switch to financing with/);
  assert.match(source("../app/(app)/estimates/[id]/financing-panel.tsx"), /Back to the original schedule/);
  assert.match(source("../app/portal/estimates/[id]/payment-change-card.tsx"), /Sign payment change/);
});

test("kept with the contract: Trash, backups and the database check know the table", () => {
  assert.match(source("./lead-trash.ts"), /"contract_payment_changes"/);
  assert.match(source("./backup-scope.ts"), /"contract_payment_changes"/);
  assert.match(
    source("./schema-drift.ts"),
    /table: "contract_payment_changes", column: "status", migration: "0217_contract_payment_changes\.sql"/
  );
});

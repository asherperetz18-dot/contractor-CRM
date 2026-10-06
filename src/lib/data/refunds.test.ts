import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  depositNetCents,
  depositPayment,
  isRefund,
  paidTotalCents,
  pendingPayment,
  phaseCheckoutCents,
  phaseOwedCents,
  phaseState,
  refundableCents,
} from "./types.ts";
import { buildInvoiceRows, invoiceSummary } from "./invoice-rows.ts";
import { buildStatement } from "./customer-statement.ts";

/**
 * Step 6 of full invoicing, part two (DECISIONS #155): a refund is money
 * going back to the customer. It's a payment row of its own, negative,
 * pointing at the payment it returns -- so every sum of money in (Paid,
 * Collected, P&L, commissions, the dashboard) nets it with no change,
 * and only the places that look at single rows learn what it is.
 */

const pay = (cents: number, extra: Record<string, unknown> = {}) => ({
  id: `p${cents}`,
  estimate_id: "c1",
  estimate_payment_id: "s1",
  kind: "progress" as const,
  status: "succeeded" as const,
  amount_cents: cents,
  method: "card",
  paid_at: "2026-09-10T17:00:00Z",
  created_at: "2026-09-10T17:00:00Z",
  stripe_session_id: null,
  stripe_payment_intent_id: null,
  ...extra,
});
const refund = (cents: number, extra: Record<string, unknown> = {}) =>
  pay(-cents, { id: `r${cents}`, refund_of: "p1000000", paid_at: "2026-09-20T17:00:00Z", created_at: "2026-09-20T17:00:00Z", ...extra });

const stage = { id: "s1", amount_cents: 1_000_000, requested_at: "2026-09-01T17:00:00Z", due_date: "2026-09-15" };

test("a refund is money back out: sums of money in net it", () => {
  assert.equal(isRefund(refund(100_000)), true);
  assert.equal(isRefund(pay(100_000)), false);
  assert.equal(paidTotalCents([pay(1_000_000), refund(100_000)]), 900_000);
});

test("a refund the customer still owes leaves the bill owed again; with its credit, it doesn't", () => {
  const at = new Date("2026-10-01T12:00:00");
  // Refunded and still owed (a bounced check): $1,000 owed again, late.
  assert.equal(phaseOwedCents(stage, [pay(1_000_000), refund(100_000)]), 100_000);
  assert.equal(phaseState(stage, [pay(1_000_000), refund(100_000)], at), "overdue");
  // Refunded and no longer owed: the credit that goes with it.
  const credited = { ...stage, credit_cents: 100_000 };
  assert.equal(phaseOwedCents(credited, [pay(1_000_000), refund(100_000)]), 0);
  assert.equal(phaseState(credited, [pay(1_000_000), refund(100_000)], at), "paid");
});

test("a refund still going through at Stripe is not money yet, either way", () => {
  const pendingRefund = refund(100_000, { status: "pending" });
  assert.equal(paidTotalCents([pay(1_000_000), pendingRefund]), 1_000_000);
  // Not money "on its way" in: it doesn't lower what the Pay button may charge.
  assert.equal(phaseCheckoutCents({ ...stage, amount_cents: 1_200_000 }, [pay(1_000_000), pendingRefund]), 200_000);
  assert.equal(phaseState({ ...stage, amount_cents: 1_200_000 }, [pay(1_000_000), pendingRefund], new Date("2026-09-10T12:00:00")), "partial");
  // Nor is it the deposit clearing.
  assert.equal(pendingPayment([pendingRefund]), null);
});

test("how much of a payment can still be refunded", () => {
  const original = pay(1_000_000, { id: "p1000000" });
  assert.equal(refundableCents(original, [original]), 1_000_000);
  assert.equal(refundableCents(original, [original, refund(100_000)]), 900_000);
  // A refund still going through counts against it; a failed one doesn't.
  assert.equal(refundableCents(original, [original, refund(100_000), refund(50_000, { id: "r2", status: "pending" })]), 850_000);
  assert.equal(refundableCents(original, [original, refund(100_000, { status: "failed" })]), 1_000_000);
  // A refund, or money not yet in, can't be refunded.
  assert.equal(refundableCents(refund(100_000), []), 0);
  assert.equal(refundableCents(pay(1_000_000, { status: "pending" }), []), 0);
});

test("a deposit refunded in full is no longer paid", () => {
  const deposit = pay(100_000, { id: "d1", kind: "deposit", estimate_payment_id: null });
  const back = pay(-100_000, { id: "d2", kind: "deposit", estimate_payment_id: null, refund_of: "d1" });
  assert.equal(depositNetCents([deposit]), 100_000);
  assert.equal(depositPayment([deposit])?.amount_cents, 100_000);
  assert.equal(depositNetCents([deposit, back]), 0);
  assert.equal(depositPayment([back, deposit]), null);
  // Part refunded: still paid, and the stamp is the deposit, never the refund.
  const part = pay(-40_000, { id: "d3", kind: "deposit", estimate_payment_id: null, refund_of: "d1" });
  assert.equal(depositPayment([part, deposit])?.amount_cents, 100_000);
});

test("Invoices: Paid in the last 30 days is net of refunds and counts payments, not refunds", () => {
  const docs = [{ id: "c1", lead_id: "l", doc_number: "EST-1", title: "Kitchen", kind: "contract", status: "Signed", signed_at: "2026-08-01T00:00:00Z", created_at: "2026-08-01T00:00:00Z", total_cents: 1 }];
  const stages = [{ id: "s1", estimate_id: "c1", sort_order: 0, name: "A", amount_cents: 1_000_000, requested_at: "2026-10-01T00:00:00Z", due_date: "2026-10-30", cancelled_at: null }];
  const payments = [
    { estimate_payment_id: "s1", status: "succeeded" as const, amount_cents: 1_000_000, paid_at: "2026-10-02T00:00:00Z" },
    { estimate_payment_id: "s1", status: "succeeded" as const, amount_cents: -100_000, paid_at: "2026-10-03T00:00:00Z" },
  ];
  const rows = buildInvoiceRows(docs, stages, payments, new Map(), "2026-10-06");
  const s = invoiceSummary(rows, payments, new Date("2026-10-06T12:00:00Z"));
  assert.deepEqual(s.paid30, { cents: 900_000, count: 1 });
});

test("the statement: a refund is its own line, and puts the balance back up", () => {
  const s = buildStatement(
    [{ id: "c1", lead_id: "l1", doc_number: "EST-1047", title: "Kitchen remodel", kind: "contract", status: "Signed", signed_at: "2026-08-01T17:00:00Z", created_at: "2026-07-20T17:00:00Z", total_cents: 2_500_000, deposit_cents: 0 }],
    [{ id: "s1", estimate_id: "c1", sort_order: 0, name: "Rough-in complete", amount_cents: 1_000_000, requested_at: "2026-09-01T17:00:00Z", due_date: "2026-09-15", cancelled_at: null, credit_cents: 100_000 }],
    [
      { estimate_id: "c1", estimate_payment_id: "s1", kind: "progress", status: "succeeded", amount_cents: 1_000_000, method: "card", reference: null, paid_at: "2026-09-10T17:00:00Z", created_at: "2026-09-10T17:00:00Z" },
      { estimate_id: "c1", estimate_payment_id: "s1", kind: "progress", status: "succeeded", amount_cents: -100_000, method: "card", reference: null, paid_at: "2026-09-20T17:00:00Z", created_at: "2026-09-20T17:00:00Z" },
      // A refund still going through: not on it yet.
      { estimate_id: "c1", estimate_payment_id: "s1", kind: "progress", status: "pending", amount_cents: -5_000, method: "card", reference: null, paid_at: null, created_at: "2026-09-21T17:00:00Z" },
    ],
    { today: "2026-10-06", zone: "America/Los_Angeles" },
    [{ estimate_payment_id: "s1", amount_cents: 100_000, reason: "Refunded: cabinet delay", created_at: "2026-09-20T17:00:00Z" }]
  );
  assert.deepEqual(
    s.lines.map((l) => [l.kind, l.label, l.detail, l.amountCents, l.balanceCents]),
    [
      ["charge", "Rough-in complete — EST-1047", "Kitchen remodel · due Sep 15, 2026 · Paid", 1_000_000, 1_000_000],
      ["payment", "Payment — Rough-in complete — EST-1047", "Card", 1_000_000, 0],
      ["refund", "Refund — Rough-in complete — EST-1047", "Card", 100_000, 100_000],
      ["credit", "Credit — Rough-in complete — EST-1047", "Refunded: cabinet delay", -100_000, 0],
    ]
  );
  assert.equal(s.paidCents, 900_000);
  assert.equal(s.balanceCents, 0);
  assert.deepEqual(s.clearing, { cents: 0, count: 0 });
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the database: a refund points at its payment, never more than was paid, written with its credit", () => {
  const sql = source("../../../supabase/migrations/0210_payment_refunds.sql");
  assert.match(sql, /add column if not exists refund_of uuid references public\.portal_payments \(id\) on delete restrict/);
  assert.match(sql, /drop constraint if exists portal_payments_amount_cents_check/);
  assert.match(sql, /check \(amount_cents <> 0 and \(\(amount_cents > 0\) = \(refund_of is null\)\)\)/);
  assert.match(sql, /create or replace function public\.record_refund\(/);
  assert.match(sql, /That is more than is left to refund on this payment\./);
  assert.match(sql, /perform public\.give_bill_credit\(/);
  assert.match(sql, /create or replace function public\.decide_refund\(/);
  assert.match(sql, /create or replace function public\.remove_refund\(/);
  for (const fn of ["record_refund", "decide_refund", "remove_refund"]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`), fn);
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role;`), fn);
  }
});

test("Stripe: refunds made there are recorded here, once each, and the Stripe check asks for the events", () => {
  const webhook = source("../stripe/handle-webhook.ts");
  assert.match(webhook, /event\.type === "charge\.refunded" \|\| event\.type === "charge\.refund\.updated"/);
  assert.match(webhook, /await syncStripeRefunds\(/);
  const sync = source("../stripe/sync-refunds.ts");
  assert.match(sync, /stripe\.refunds\.list\(\{ payment_intent: /);
  assert.match(sync, /\.eq\("stripe_refund_id", r\.id\)/);
  assert.match(sync, /p_still_owed: null/);
  const admin = source("../actions/stripe-admin.ts");
  assert.match(admin, /"charge\.refunded",\s*"charge\.refund\.updated",/);
});

test("the places that look at single rows know a refund when they see one", () => {
  // Never a "payment received" receipt, alert or bell for money going out.
  assert.match(source("../send-receipt.ts"), /payment\.amount_cents <= 0/);
  assert.match(source("../actions/popup-alerts.ts"), /\.gt\("amount_cents", 0\)/);
  assert.match(source("../actions/notifications.ts"), /\.gt\("amount_cents", 0\)/);
  // "Already paid" is what's owed, never "a paid row exists".
  assert.doesNotMatch(source("../actions/progress-billing.ts"), /\.eq\("status", "succeeded"\)\s*\.maybeSingle\(\)/);
  assert.doesNotMatch(source("../actions/portal-payments.ts"), /\.eq\("status", "succeeded"\)\s*\.maybeSingle/);
  // A payment with refunds against it isn't removed or cut below them by hand.
  const manual = source("../actions/manual-payments.ts");
  assert.match(manual, /export async function recordRefund\(/);
  assert.match(manual, /export async function decideRefund\(/);
  assert.match(manual, /\.rpc\("record_refund"/);
  assert.match(manual, /\.rpc\("remove_refund"/);
  // Trash puts a refund back after the payment it points at, and a
  // credit after the refund it came with.
  const trash = source("../lead-trash.ts");
  assert.match(trash, /\(a\.refund_of \? 1 : 0\) - \(b\.refund_of \? 1 : 0\)/);
  assert.match(trash, /if \(table !== "bill_credits"\)/);
  assert.match(trash, /await put\("bill_credits", payload\.children\.bill_credits\);/);
});

test("no reminder asks for money that just went back until someone says it's still owed", () => {
  const run = source("../bill-reminders-run.ts");
  assert.match(run, /\.is\("refund_still_owed", null\)/);
  assert.match(run, /if \(awaitingDecision\.has\(row\.id\)\) continue;/);
});

test("the Payments page: Refund on money that's in, the still-owed question on bills, none of a payment's tools on a refund", () => {
  const view = source("../../app/(app)/payments/payments-view.tsx");
  assert.match(view, /const editable = r\.manual && showTools && !r\.isRefund;/);
  assert.match(view, /r\.status === "succeeded" && !r\.isRefund && \(\s*<ReceiptButton/);
  assert.match(view, /r\.refundUndecided && r\.status === "succeeded" && <DecideRefund/);
  const form = source("../../app/(app)/payments/refund-payment.tsx");
  assert.match(form, /Does the customer still owe this amount\?/);
  assert.match(form, /stillOwed: !onBill \|\| stillOwed === "yes"/);
  // The deposit-paid checks count money kept, not "a paid row".
  assert.match(source("../../app/(app)/payments/page.tsx"), /depositPayment\(payments\.filter/);
  assert.match(source("../../app/portal/home/page.tsx"), /p\.kind === "deposit"\)\) > 0/);
});

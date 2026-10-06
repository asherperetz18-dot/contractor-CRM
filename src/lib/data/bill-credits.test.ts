import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { creditableCents, phaseCheckoutCents, phaseOwedCents, phaseReceivableCents, phaseState } from "./types.ts";
import { buildInvoiceRows } from "./invoice-rows.ts";
import { buildStatement } from "./customer-statement.ts";

/**
 * Step 6 of full invoicing, part one (DECISIONS #154): a credit lowers
 * what a customer owes on a bill without money moving -- a discount
 * after the fact, goodwill, or what's left when money is refunded and
 * they no longer owe it. The bill's own amount never changes (it's what
 * the customer signed or was sent); the credit sits beside it and every
 * "still owed" sum takes it off.
 */

const billed = { id: "s1", amount_cents: 1_000_000, requested_at: "2026-09-01T17:00:00Z", due_date: "2026-09-15" };
const paid = (cents: number, stage = "s1") => ({
  estimate_payment_id: stage,
  status: "succeeded" as const,
  amount_cents: cents,
  stripe_session_id: null,
  stripe_payment_intent_id: null,
});

test("a credit comes off what's owed, wherever it's worked out", () => {
  const stage = { ...billed, credit_cents: 100_000 };
  assert.equal(phaseOwedCents(stage, [paid(600_000)]), 300_000);
  assert.equal(phaseCheckoutCents(stage, [paid(600_000)]), 300_000);
  assert.equal(phaseReceivableCents([stage], [paid(600_000)]), 300_000);
  assert.equal(phaseState(stage, [paid(600_000)], new Date("2026-09-10T12:00:00")), "partial");
  // Paid what's left after the credit: paid.
  assert.equal(phaseState(stage, [paid(900_000)], new Date("2026-10-01T12:00:00")), "paid");
  assert.equal(phaseOwedCents(stage, [paid(900_000)]), 0);
});

test("a bill credited in full owes nothing and reads Paid", () => {
  const stage = { ...billed, credit_cents: 1_000_000 };
  assert.equal(phaseOwedCents(stage, []), 0);
  assert.equal(phaseState(stage, [], new Date("2026-10-01T12:00:00")), "paid");
  assert.equal(phaseCheckoutCents(stage, []), 0);
});

test("no credit, nothing changes", () => {
  assert.equal(phaseOwedCents(billed, [paid(600_000)]), 400_000);
  assert.equal(phaseState(billed, [], new Date("2026-10-01T12:00:00")), "overdue");
});

test("you can credit up to what's still owed on a billed bill, and nothing on an unbilled one", () => {
  assert.equal(creditableCents({ ...billed, credit_cents: 100_000 }, [paid(600_000)]), 300_000);
  assert.equal(creditableCents(billed, [paid(1_000_000)]), 0);
  assert.equal(creditableCents({ ...billed, requested_at: null }, []), 0);
});

const docs = [
  { id: "c1", lead_id: "l1", doc_number: "EST-1047", title: "Kitchen remodel", kind: "contract", status: "Signed", signed_at: "2026-08-01T17:00:00Z", created_at: "2026-07-20T17:00:00Z", total_cents: 2_500_000, deposit_cents: 0 },
];
const stages = [
  { id: "s1", estimate_id: "c1", sort_order: 0, name: "Rough-in complete", amount_cents: 1_000_000, requested_at: "2026-09-01T17:00:00Z", due_date: "2026-09-15", cancelled_at: null, credit_cents: 100_000 },
];

test("the Invoices page: the bill keeps its amount, owes less, and is Paid once the rest is in", () => {
  const rows = buildInvoiceRows(docs, stages, [{ ...paid(600_000), paid_at: "2026-09-10T17:00:00Z" }], new Map(), "2026-10-06");
  assert.equal(rows[0].amountCents, 1_000_000);
  assert.equal(rows[0].owedCents, 300_000);
  assert.equal(rows[0].status, "overdue");
  const settled = buildInvoiceRows(docs, stages, [{ ...paid(900_000), paid_at: "2026-09-10T17:00:00Z" }], new Map(), "2026-10-06");
  assert.equal(settled[0].status, "paid");
});

test("the statement: the bill at its full amount, then the credit with its reason", () => {
  const s = buildStatement(
    docs,
    stages,
    [{ estimate_id: "c1", estimate_payment_id: "s1", kind: "progress", status: "succeeded", amount_cents: 600_000, method: "card", reference: null, paid_at: "2026-09-10T17:00:00Z", created_at: "2026-09-10T17:00:00Z" }],
    { today: "2026-10-06", zone: "America/Los_Angeles" },
    [{ estimate_payment_id: "s1", amount_cents: 100_000, reason: "Cabinet delay", created_at: "2026-09-20T17:00:00Z" }]
  );
  assert.deepEqual(
    s.lines.map((l) => [l.day, l.kind, l.label, l.detail, l.amountCents, l.balanceCents]),
    [
      ["2026-09-01", "charge", "Rough-in complete — EST-1047", "Kitchen remodel · due Sep 15, 2026 · Overdue", 1_000_000, 1_000_000],
      ["2026-09-10", "payment", "Payment — Rough-in complete — EST-1047", "Card", 600_000, 400_000],
      ["2026-09-20", "credit", "Credit — Rough-in complete — EST-1047", "Cabinet delay", -100_000, 300_000],
    ]
  );
  assert.equal(s.balanceCents, 300_000);
  assert.equal(s.overdueCents, 300_000);
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("giving a credit: checked and written together in the database, by the people who record payments", () => {
  const sql = source("../../../supabase/migrations/0209_bill_credits.sql");
  assert.match(sql, /add column if not exists credit_cents bigint not null default 0/);
  assert.match(sql, /create table if not exists public\.bill_credits/);
  assert.match(sql, /create or replace function public\.give_bill_credit\(/);
  // Never more than what's still owed, and only on a billed bill of a signed document.
  assert.match(sql, /if p_amount > v_owed then/);
  assert.match(sql, /for update/);
  assert.match(sql, /grant execute on function public\.give_bill_credit\([^)]*\) to service_role;/);
  assert.match(sql, /revoke all on function public\.give_bill_credit\([^)]*\) from public, anon, authenticated;/);
  assert.match(sql, /select public\.apply_billing_lock_policies\(\);/);
  // The dashboard's owed figures take credits off too.
  assert.match(sql, /ph\.amount_cents - ph\.credit_cents as amount_cents/);

  const action = source("../actions/bill-credits.ts");
  assert.match(action, /export async function giveBillCredit\(/);
  assert.match(action, /canManageBills\(profile\)/);
  assert.match(action, /\.rpc\("give_bill_credit"/);

  // Every read that works out what's owed gets the credit (and keeps
  // working before 0209 has run: no column named that may not exist).
  for (const path of [
    "./load-invoice-rows.ts",
    "./load-customer-statement.ts",
    "../bill-reminders-run.ts",
    "../actions/portal-payments.ts",
    "../../app/(app)/payments/page.tsx",
    "../../app/(app)/projects/project-data.ts",
  ]) {
    assert.doesNotMatch(source(path), /credit_cents"/, path);
  }
  assert.match(source("./invoice-rows.ts"), /export const INVOICE_STAGE_COLUMNS = "\*"/);
});

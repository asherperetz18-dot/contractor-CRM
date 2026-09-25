import { test } from "node:test";
import assert from "node:assert/strict";
import { jobLedger, ledgerCounts, ledgerFilter, toggleLedger, type JobLedgerInput } from "./job-ledger.ts";
import { computeProjectRollup, phaseReceivableCents } from "./types.ts";

/**
 * The Transactions list under a Projects row itemizes the row's own
 * numbers: Collected, Owed, Spent and Bills unpaid. These tests pin that
 * the lines add up to exactly what the row shows, built from the same
 * rules, so the list can never contradict the figures above it.
 */

const CONTRACT = "est-1";
const base = (): JobLedgerInput => ({
  contractId: CONTRACT,
  docs: [
    { id: CONTRACT, kind: "contract", status: "Signed", doc_number: "EST-1098", title: "Pool & Spa", total_cents: 13_000_000 },
    { id: "co-1", kind: "change_order", status: "Signed", doc_number: "EST-1098-CO1", title: "Pool light", total_cents: 400_000 },
    { id: "inv-1", kind: "invoice", status: "Signed", doc_number: "INV-1124", title: "Permit fees", total_cents: 110_100 },
    { id: "inv-void", kind: "invoice", status: "Void", doc_number: "INV-1120", title: "Wrong", total_cents: 5_000 },
  ],
  phases: [
    { id: "ph-1", estimate_id: CONTRACT, name: "Phase 1 · Excavation", sort_order: 0, amount_cents: 3_250_000, requested_at: "2026-06-18T17:00:00Z", due_date: "2026-06-25" },
    { id: "ph-4", estimate_id: CONTRACT, name: "Phase 4 · Plaster", sort_order: 3, amount_cents: 1_500_000, requested_at: "2026-09-18T17:00:00Z", due_date: "2026-09-25" },
    { id: "ph-5", estimate_id: CONTRACT, name: "Final", sort_order: 4, amount_cents: 900_000, requested_at: null, due_date: null },
    { id: "ph-co", estimate_id: "co-1", name: "Pool light", sort_order: 0, amount_cents: 400_000, requested_at: "2026-09-10T17:00:00Z", due_date: null },
    { id: "ph-inv", estimate_id: "inv-1", name: "Permit fees", sort_order: 0, amount_cents: 110_100, requested_at: "2026-09-20T17:00:00Z", due_date: "2026-09-20" },
    { id: "ph-void", estimate_id: "inv-void", name: "Wrong", sort_order: 0, amount_cents: 5_000, requested_at: null, due_date: null },
  ],
  payments: [
    { id: "p-dep", estimate_id: CONTRACT, estimate_payment_id: null, kind: "deposit", amount_cents: 100_000, status: "succeeded", method: "card", reference: null, paid_at: "2026-06-02T18:00:00Z", created_at: "2026-06-02T18:00:00Z" },
    { id: "p-1", estimate_id: CONTRACT, estimate_payment_id: "ph-1", kind: "progress", amount_cents: 3_250_000, status: "succeeded", method: "check", reference: "1042", paid_at: "2026-06-20T18:00:00Z", created_at: "2026-06-20T18:00:00Z" },
    { id: "p-co", estimate_id: "co-1", estimate_payment_id: "ph-co", kind: "progress", amount_cents: 400_000, status: "succeeded", method: "card", reference: null, paid_at: "2026-09-12T18:00:00Z", created_at: "2026-09-12T18:00:00Z" },
    { id: "p-pend", estimate_id: CONTRACT, estimate_payment_id: "ph-4", kind: "progress", amount_cents: 200_000, status: "pending", method: "us_bank_account", reference: null, paid_at: null, created_at: "2026-09-19T18:00:00Z" },
    { id: "p-fail", estimate_id: CONTRACT, estimate_payment_id: "ph-4", kind: "progress", amount_cents: 200_000, status: "failed", method: "card", reference: null, paid_at: null, created_at: "2026-09-19T18:00:00Z" },
  ],
  costs: [
    { id: "c-permit", description: "Building permit", category: null, vendorName: "City of Los Angeles", amount_cents: 110_100, spent_on: "2026-09-11", estimate_payment_id: "ph-4", receipt_url: "https://x/permit.pdf", receipt_path: "receipts/l/1-permit.pdf", source: "manual" },
    { id: "c-gunite", description: null, category: "Gunite", vendorName: "Shotcrete Pros", amount_cents: 1_840_000, spent_on: "2026-08-20", estimate_payment_id: null, receipt_url: null, receipt_path: null, source: "bill" },
  ],
  contractsOnLead: 1,
  openBills: [
    { id: "b-1", estimate_payment_id: null, vendorName: "Pool Supply Co.", reference: "Equipment package", amount_cents: 625_000, remaining_cents: 625_000, bill_date: "2026-09-03", due_date: "2026-10-03", receipt_url: null, receipt_path: null },
    { id: "b-paid", estimate_payment_id: null, vendorName: "Paid Co.", reference: null, amount_cents: 10_000, remaining_cents: 0, bill_date: "2026-09-01", due_date: null, receipt_url: null, receipt_path: null },
  ],
  billedOn: { "c-permit": "INV-1124" },
});

test("the lines add up to the row's Collected, Owed, Spent and Bills unpaid", () => {
  const input = base();
  const { entries, totals } = jobLedger(input);
  const sum = (kind: string) =>
    entries.filter((e) => e.kind === kind).reduce((s, e) => s + e.amountCents, 0);

  // What the Projects row computes from the same documents.
  const own = new Set([CONTRACT, "co-1", "inv-1"]);
  const phases = input.phases.filter((p) => own.has(p.estimate_id));
  const payments = input.payments.filter((p) => own.has(p.estimate_id));
  const rollup = computeProjectRollup({
    contractTotalCents: 13_000_000,
    signedChangeOrderCents: 400_000,
    invoicedCents: 110_100,
    payments,
    receivableCents: phaseReceivableCents(phases, payments),
    filedCostCents: 110_100,
    unfiledCostCents: 1_840_000,
    ownsUnfiledCosts: true,
  });

  assert.equal(totals.collectedCents, rollup.collectedCents);
  assert.equal(sum("in"), rollup.collectedCents);
  assert.equal(totals.owedCents, rollup.receivableCents);
  assert.equal(sum("owed"), rollup.receivableCents);
  assert.equal(totals.spentCents, rollup.costCents);
  assert.equal(sum("out"), rollup.costCents);
  assert.equal(totals.billsUnpaidCents, 625_000);
  assert.equal(sum("unpaid_bill"), 625_000);
});

test("newest first, and each line says what it is", () => {
  const { entries } = jobLedger(base());
  const dates = entries.map((e) => e.date);
  assert.deepEqual(dates, [...dates].sort().reverse());
  const byId = new Map(entries.map((e) => [e.id, e]));
  assert.equal(byId.get("pay-p-dep")?.title, "Deposit");
  assert.equal(byId.get("pay-p-1")?.detail, "Check #1042");
  // A payment on a change order names the change order.
  assert.equal(byId.get("pay-p-co")?.title, "EST-1098-CO1 · Pool light");
  // The invoice owes in full; it reads as an invoice.
  const inv = byId.get("owed-ph-inv");
  assert.equal(inv?.amountCents, 110_100);
  assert.equal(inv?.isInvoice, true);
  assert.equal(inv?.title, "INV-1124 · Permit fees");
  assert.equal(inv?.detail, "invoice · due Sep 20");
  assert.equal(byId.get("bill-b-1")?.detail, "Pool Supply Co. · due Oct 3");
  // A bill paid back to the customer says where.
  assert.equal(byId.get("cost-c-permit")?.billedOn, "INV-1124");
  assert.equal(byId.get("cost-c-gunite")?.title, "Gunite");
});

test("money on its way is shown but not counted; a failed payment isn't shown", () => {
  const { entries, totals } = jobLedger(base());
  const pending = entries.find((e) => e.id === "pay-p-pend");
  assert.equal(pending?.kind, "clearing");
  assert.ok(!entries.some((e) => e.id === "pay-p-fail"));
  // Deposit $1,000 + phase 1 $32,500 + the change order's $4,000.
  assert.equal(totals.collectedCents, 3_750_000);
});

test("an unbilled phase and a cancelled invoice aren't owed; a paid-off bill isn't unpaid", () => {
  const { entries } = jobLedger(base());
  assert.ok(!entries.some((e) => e.id === "owed-ph-5"));
  assert.ok(!entries.some((e) => e.id === "owed-ph-void"));
  assert.ok(!entries.some((e) => e.id === "bill-b-paid"));
});

test("a customer with two contracts: unfiled costs belong to neither, and are listed apart", () => {
  const { entries, totals, unassigned } = jobLedger({ ...base(), contractsOnLead: 2 });
  assert.ok(!entries.some((e) => e.id === "cost-c-gunite"));
  assert.deepEqual(unassigned.map((c) => c.id), ["c-gunite"]);
  assert.equal(totals.spentCents, 110_100);
  // An unfiled open bill is the customer's, not this contract's.
  assert.equal(totals.billsUnpaidCents, 0);
});

test("a cost filed to another contract's phase isn't this job's", () => {
  const input = base();
  input.phases.push({ id: "other-ph", estimate_id: "other-contract", name: "x", sort_order: 0, amount_cents: 1, requested_at: null, due_date: null });
  input.costs.push({ id: "c-other", description: "Other", category: null, vendorName: null, amount_cents: 999, spent_on: "2026-09-01", estimate_payment_id: "other-ph", receipt_url: null, receipt_path: null, source: "manual" });
  const { entries } = jobLedger(input);
  assert.ok(!entries.some((e) => e.id === "cost-c-other"));
});

test("the filters split the list the way the chips count it", () => {
  const { entries } = jobLedger(base());
  const counts = ledgerCounts(entries);
  assert.equal(counts.all, entries.length);
  assert.equal(counts.in, 4); // three settled + one clearing
  assert.equal(counts.out, 2);
  assert.equal(counts.owed, 3); // phase 4, the invoice, one unpaid bill
  assert.equal(ledgerFilter(entries, "in").length, counts.in);
  assert.equal(ledgerFilter(entries, "out").length, counts.out);
  assert.equal(ledgerFilter(entries, "owed").length, counts.owed);
  assert.equal(ledgerFilter(entries, "all").length, counts.all);
});

test("opening a row's list: a click opens it on that filter, the same click again closes it", () => {
  let open = toggleLedger({}, "job-1", "in");
  assert.deepEqual(open, { "job-1": "in" });
  // A different number on the same row switches the filter, stays open.
  open = toggleLedger(open, "job-1", "out");
  assert.deepEqual(open, { "job-1": "out" });
  open = toggleLedger(open, "job-1", "out");
  assert.deepEqual(open, {});
  // Other rows are left alone.
  open = toggleLedger({ "job-2": "all" }, "job-1", "all");
  assert.deepEqual(open, { "job-2": "all", "job-1": "all" });
});

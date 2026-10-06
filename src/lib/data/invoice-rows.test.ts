import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  agingBucket,
  billedWithin,
  buildInvoiceRows,
  daysLate,
  inStatusGroup,
  invoiceSummary,
  parseInvoiceQuery,
  invoiceQueryString,
  type InvoiceDocLite,
  type InvoicePaymentLite,
  type InvoiceStageLite,
} from "./invoice-rows.ts";

/**
 * The Invoices page (DECISIONS #148): everything the company has billed a
 * customer -- an invoice, or a stage of a contract or change order -- in
 * one list, each with the status a person would give it. Money to
 * Collect reads the same rows, so the two can never disagree, and now
 * ages them by when they were due rather than when they were billed.
 */

const TODAY = "2026-10-06";

const doc = (over: Partial<InvoiceDocLite> = {}): InvoiceDocLite => ({
  id: "c1",
  lead_id: "lead1",
  doc_number: "EST-1047",
  title: "Kitchen remodel",
  kind: "contract",
  status: "Signed",
  signed_at: "2026-08-01T15:00:00Z",
  created_at: "2026-07-20T15:00:00Z",
  total_cents: 1_600_000,
  ...over,
});

const stage = (over: Partial<InvoiceStageLite> = {}): InvoiceStageLite => ({
  id: "s1",
  estimate_id: "c1",
  sort_order: 1,
  name: "Rough-in complete",
  amount_cents: 600_000,
  requested_at: "2026-09-25T16:00:00Z",
  due_date: "2026-10-02",
  cancelled_at: null,
  ...over,
});

const pay = (over: Partial<InvoicePaymentLite> = {}): InvoicePaymentLite => ({
  estimate_payment_id: "s1",
  status: "succeeded",
  amount_cents: 600_000,
  paid_at: "2026-10-01T12:00:00Z",
  ...over,
});

const one = (
  docs: InvoiceDocLite[],
  stages: InvoiceStageLite[],
  payments: InvoicePaymentLite[] = [],
  views: Record<string, string> = {}
) => {
  const rows = buildInvoiceRows(docs, stages, payments, new Map(Object.entries(views)), TODAY);
  assert.equal(rows.length, 1, JSON.stringify(rows));
  return rows[0];
};

test("a billed stage reads the way a person would describe it", () => {
  // Billed, not yet due, nothing paid, never opened.
  const fresh = stage({ due_date: "2026-10-09" });
  assert.equal(one([doc()], [fresh]).status, "billed");
  // Opened by the customer after it was billed.
  assert.equal(one([doc()], [fresh], [], { c1: "2026-09-26T10:00:00Z" }).status, "viewed");
  // An opening from before it was billed says nothing about this bill.
  assert.equal(one([doc()], [fresh], [], { c1: "2026-09-20T10:00:00Z" }).status, "billed");
  // Due today is not late today; due yesterday is.
  assert.equal(one([doc()], [stage({ due_date: TODAY })]).status, "billed");
  assert.equal(one([doc()], [stage({ due_date: "2026-10-05" })]).status, "overdue");
  // Part paid, not yet due.
  const part = one([doc()], [fresh], [pay({ amount_cents: 200_000 })]);
  assert.equal(part.status, "partial");
  assert.equal(part.paidCents, 200_000);
  assert.equal(part.owedCents, 400_000);
  // Money on its way that covers the rest is clearing, not overdue.
  assert.equal(one([doc()], [stage()], [pay({ status: "pending" })]).status, "clearing");
  // Paid in full is paid, whatever the due date said.
  const paid = one([doc()], [stage()], [pay()]);
  assert.equal(paid.status, "paid");
  assert.equal(paid.owedCents, 0);
  // A failed or cancelled payment is not money.
  assert.equal(one([doc()], [stage()], [pay({ status: "failed" })]).status, "overdue");
});

test("invoices, contracts and change orders are all listed; drafts and unbilled stages are not", () => {
  const invoice = doc({ id: "i1", kind: "invoice", doc_number: "INV-1052", title: "Permit fee" });
  const co = doc({ id: "co1", kind: "change_order", doc_number: "EST-1047-CO1", title: "Extra outlet" });
  const draft = doc({ id: "d1", status: "Draft" });
  const rows = buildInvoiceRows(
    [doc(), invoice, co, draft],
    [
      stage(),
      stage({ id: "s2", estimate_id: "i1", name: "Invoice", sort_order: 0 }),
      stage({ id: "s3", estimate_id: "co1", name: "Deposit", sort_order: 0 }),
      stage({ id: "s4", estimate_id: "d1" }),
      stage({ id: "s5", requested_at: null, due_date: null }),
      stage({ id: "s6", cancelled_at: "2026-09-30T00:00:00Z" }),
      stage({ id: "s7", estimate_id: "missing" }),
    ],
    [],
    new Map(),
    TODAY
  );
  assert.deepEqual(rows.map((r) => r.id).sort(), ["s1", "s2", "s3"]);
  const inv = rows.find((r) => r.id === "s2")!;
  assert.equal(inv.isInvoice, true);
  assert.equal(inv.stage, null); // an invoice is one bill, not a stage of one
  assert.equal(rows.find((r) => r.id === "s1")!.stage, "Rough-in complete");
  assert.equal(rows.find((r) => r.id === "s3")!.docNumber, "EST-1047-CO1");
});

test("cancelled documents show as void, and a cancelled invoice still shows once", () => {
  // A voided contract keeps the stages it had billed (the request went out).
  const voided = one([doc({ status: "Void" })], [stage()]);
  assert.equal(voided.status, "void");
  assert.equal(voided.owedCents, 0);
  // Cancelling an invoice un-bills its stage; the invoice itself is still
  // listed once, as void, so it doesn't vanish from the record.
  const cancelled = one(
    [doc({ id: "i1", kind: "invoice", status: "Void", doc_number: "INV-1052", total_cents: 45_000 })],
    [stage({ estimate_id: "i1", requested_at: null, due_date: null, cancelled_at: "2026-09-30T00:00:00Z" })]
  );
  assert.equal(cancelled.status, "void");
  assert.equal(cancelled.id, "void-i1");
  assert.equal(cancelled.amountCents, 45_000);
  assert.equal(cancelled.billedAt, "2026-08-01T15:00:00Z");
});

test("a billed credit is listed as a credit, never as money owed", () => {
  const credit = one([doc()], [stage({ amount_cents: -50_000 })]);
  assert.equal(credit.status, "credit");
  assert.equal(credit.owedCents, 0);
});

test("the status groups the page filters by", () => {
  for (const s of ["billed", "viewed", "partial", "overdue", "clearing"] as const) {
    assert.ok(inStatusGroup(s, "open"), s);
    assert.ok(inStatusGroup(s, "all"), s);
  }
  assert.ok(inStatusGroup("overdue", "overdue"));
  assert.ok(!inStatusGroup("billed", "overdue"));
  assert.ok(inStatusGroup("paid", "paid"));
  assert.ok(!inStatusGroup("paid", "open"));
  assert.ok(inStatusGroup("void", "void"));
  assert.ok(!inStatusGroup("void", "open"));
  assert.ok(!inStatusGroup("credit", "open"));
  assert.ok(inStatusGroup("credit", "all"));
});

test("ageing counts from the due date, not the day it was billed", () => {
  assert.equal(daysLate(null, TODAY), 0);
  assert.equal(daysLate(TODAY, TODAY), 0);
  assert.equal(daysLate("2026-10-09", TODAY), -3);
  assert.equal(daysLate("2026-10-05", TODAY), 1);
  assert.equal(daysLate("2026-09-30", "2026-10-30"), 30);
  assert.equal(daysLate("2026-02-28", "2026-03-01"), 1); // month ends
  assert.equal(agingBucket(null, TODAY), "not_due");
  assert.equal(agingBucket(TODAY, TODAY), "not_due");
  assert.equal(agingBucket("2026-10-05", TODAY), "late_1_30");
  assert.equal(agingBucket("2026-09-06", TODAY), "late_1_30"); // 30 days
  assert.equal(agingBucket("2026-09-05", TODAY), "late_31_90"); // 31 days
  assert.equal(agingBucket("2026-07-08", TODAY), "late_31_90"); // 90 days
  assert.equal(agingBucket("2026-07-07", TODAY), "late_90_plus"); // 91 days
});

test("the billed-date period: whole days back from now; any time has no edge", () => {
  const now = new Date("2026-10-06T12:00:00Z");
  assert.ok(billedWithin("2026-09-07T12:00:01Z", "30", now));
  assert.ok(!billedWithin("2026-09-06T11:59:59Z", "30", now));
  assert.ok(billedWithin("2020-01-01T00:00:00Z", "all", now));
  assert.ok(billedWithin("2025-10-07T00:00:00Z", "365", now));
});

test("the address is read strictly and carries only what differs", () => {
  assert.deepEqual(parseInvoiceQuery({}), { status: "open", period: "all" });
  assert.deepEqual(parseInvoiceQuery({ status: "paid", period: "90" }), { status: "paid", period: "90" });
  assert.deepEqual(parseInvoiceQuery({ status: "everything", period: "7" }), { status: "open", period: "all" });
  assert.equal(invoiceQueryString({ status: "open", period: "all" }), "");
  assert.equal(invoiceQueryString({ status: "overdue", period: "all" }), "?status=overdue");
  assert.equal(invoiceQueryString({ status: "all", period: "365" }), "?status=all&period=365");
  for (const status of ["open", "overdue", "paid", "draft", "void", "all"] as const) {
    for (const period of ["all", "30", "90", "365"] as const) {
      const qs = invoiceQueryString({ status, period });
      assert.deepEqual(parseInvoiceQuery(Object.fromEntries(new URLSearchParams(qs.slice(1)))), { status, period }, qs);
    }
  }
});

test("the cards: what's owed, what's late, and the last 30 days billed and paid", () => {
  const now = new Date("2026-10-06T12:00:00Z");
  const rows = buildInvoiceRows(
    [doc(), doc({ id: "i1", kind: "invoice", status: "Void", total_cents: 9_999 })],
    [
      stage({ id: "a", due_date: "2026-10-09" }), // billed, not due
      stage({ id: "b" }), // overdue
      stage({ id: "c", requested_at: "2026-08-01T00:00:00Z" }), // paid, billed long ago
    ],
    [pay({ estimate_payment_id: "c", paid_at: "2026-09-20T00:00:00Z" }), pay({ estimate_payment_id: "b", amount_cents: 100_000, paid_at: "2026-08-01T00:00:00Z" })],
    new Map(),
    TODAY
  );
  const sum = invoiceSummary(rows, [pay({ estimate_payment_id: "c", paid_at: "2026-09-20T00:00:00Z" }), pay({ estimate_payment_id: "b", amount_cents: 100_000, paid_at: "2026-08-01T00:00:00Z" })], now);
  assert.deepEqual(sum.outstanding, { cents: 600_000 + 500_000, count: 2 });
  assert.deepEqual(sum.overdue, { cents: 500_000, count: 1 });
  // Billed in the last 30 days: a and b, never the cancelled invoice.
  assert.deepEqual(sum.billed30, { cents: 1_200_000, count: 2 });
  // Paid in the last 30 days, by when the money landed.
  assert.deepEqual(sum.paid30, { cents: 600_000, count: 1 });
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Invoices sits in Accounting, before Money to Collect, for the people who see receivables", () => {
  const types = source("./types.ts");
  assert.match(types, /\| "invoices"/);
  assert.match(
    types,
    /\{ key: "invoices", label: "Invoices", href: "\/invoices", group: "Accounting" \},\s*\{ key: "collect"/
  );
  // Same footing as Money to Collect: company-wide money.
  assert.match(types, /if \(\(pageKey === "collect" \|\| pageKey === "invoices"\) && \(role === "Field" \|\| role === "Sales"\)\) return false;/);
  assert.match(types, /const BOOKKEEPING_DEFAULT_PAGES: PageKey\[\] = \[[^\]]*"invoices",/);
  // The menu hides it from anyone the page itself would turn away.
  assert.match(source("../nav.ts"), /href === "\/invoices"/);
  const page = source("../../app/(app)/invoices/page.tsx");
  assert.match(page, /if \(!canViewFinancials\(profile\)\)/);
});

test("both pages read the same rows; Money to Collect ages them by due date", () => {
  const loader = source("./load-invoice-rows.ts");
  assert.match(loader, /buildInvoiceRows\(/);
  assert.doesNotMatch(loader, /\.select\("\*"\)/);
  // A stable order, so paging past 1,000 rows neither repeats nor skips one.
  assert.equal((loader.match(/\.order\("id"\)/g) ?? []).length, 3);
  for (const page of ["../../app/(app)/invoices/page.tsx", "../../app/(app)/collect/page.tsx"]) {
    const src = source(page);
    assert.match(src, /loadInvoiceRows\(supabase, /, page);
    assert.doesNotMatch(src, /\.select\("\*"\)/, page);
  }
  const view = source("../../app/(app)/collect/collect-view.tsx");
  assert.match(view, /agingBucket\(r\.dueDate, today\)/);
  assert.doesNotMatch(view, /ageDays\(r\.requestedAt\)/);
});

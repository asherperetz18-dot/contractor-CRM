import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  INVOICE_STATUS_LABEL,
  buildInvoiceRows,
  inStatusGroup,
  invoiceSummary,
  type InvoiceDocLite,
  type InvoicePaymentLite,
  type InvoiceStageLite,
} from "./data/invoice-rows.ts";
import { REMINDER_STATUSES } from "./bill-reminder.ts";

/**
 * A contract paying with financing (DECISIONS #166, #167): its bills read
 * "Financing" on Invoices and Money to Collect -- still owed, by the
 * lender -- never Overdue, and nothing ages, alerts or reminds about them.
 */

const doc = (id: string, status = "Signed"): InvoiceDocLite => ({
  id,
  lead_id: `lead-${id}`,
  doc_number: id.toUpperCase(),
  title: null,
  kind: "contract",
  status,
  signed_at: "2026-09-01T12:00:00Z",
  created_at: "2026-09-01T12:00:00Z",
  total_cents: 1_000_000,
});
const stage = (id: string, estimate_id: string, due_date: string, amount_cents = 500_000): InvoiceStageLite => ({
  id,
  estimate_id,
  sort_order: 0,
  name: `Stage ${id}`,
  amount_cents,
  requested_at: "2026-09-10T12:00:00Z",
  due_date,
  cancelled_at: null,
  credit_cents: 0,
});
const pay = (estimate_payment_id: string, amount_cents: number, status: InvoicePaymentLite["status"] = "succeeded"): InvoicePaymentLite => ({
  estimate_payment_id,
  amount_cents,
  status,
  paid_at: "2026-09-20T12:00:00Z",
});

const TODAY = "2026-10-07";
const financed = new Map([["fin", "Service Finance"]]);

test("a financed contract's bill still owed reads Financing, with its lender -- however late its date", () => {
  const rows = buildInvoiceRows(
    [doc("fin"), doc("cash")],
    [stage("late", "fin", "2026-09-15"), stage("part", "fin", "2026-10-20"), stage("cashlate", "cash", "2026-09-15")],
    [pay("part", 100_000)],
    new Map(),
    TODAY,
    new Map(),
    financed
  );
  const by = new Map(rows.map((r) => [r.id, r]));
  assert.equal(by.get("late")!.status, "financing");
  assert.equal(by.get("late")!.financedBy, "Service Finance");
  assert.equal(by.get("late")!.owedCents, 500_000);
  assert.equal(by.get("part")!.status, "financing");
  assert.equal(by.get("part")!.owedCents, 400_000);
  // Another contract is untouched.
  assert.equal(by.get("cashlate")!.status, "overdue");
  assert.equal(by.get("cashlate")!.financedBy, undefined);
});

test("paid, clearing and cancelled bills keep what they are", () => {
  const rows = buildInvoiceRows(
    [doc("fin"), doc("gone", "Void")],
    [stage("paid", "fin", "2026-09-15"), stage("clr", "fin", "2026-09-15"), stage("v", "gone", "2026-09-15")],
    [pay("paid", 500_000), pay("clr", 500_000, "pending")],
    new Map(),
    TODAY,
    new Map(),
    new Map([...financed, ["gone", "Service Finance"]])
  );
  const by = new Map(rows.map((r) => [r.id, r.status]));
  assert.equal(by.get("paid"), "paid");
  assert.equal(by.get("clr"), "clearing");
  assert.equal(by.get("v"), "void");
});

test("Financing is open money, never overdue, and never reminded", () => {
  assert.equal(INVOICE_STATUS_LABEL.financing, "Financing");
  assert.equal(inStatusGroup("financing", "open"), true);
  assert.equal(inStatusGroup("financing", "overdue"), false);
  assert.equal(REMINDER_STATUSES.has("financing"), false);

  const rows = buildInvoiceRows([doc("fin")], [stage("late", "fin", "2026-09-15")], [], new Map(), TODAY, new Map(), financed);
  const s = invoiceSummary(rows, [], new Date("2026-10-07T12:00:00Z"));
  assert.equal(s.outstanding.cents, 500_000);
  assert.equal(s.overdue.cents, 0);
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Invoices, Money to Collect, the bell and the customer's home page all know", () => {
  // One loader feeds Invoices and Money to Collect.
  const loader = source("./data/load-invoice-rows.ts");
  assert.match(loader, /financedContracts\(supabase, companyId\)/);
  assert.match(loader, /buildInvoiceRows\(docs, stages, payments, new Map\(\), today, sentByStage, financed\)/);
  assert.match(source("../app/(app)/invoices/invoices-view.tsx"), /financing: "#/);

  // Money to Collect: not aged as late, said plainly, last in the list,
  // and never offered to bill.
  const collect = source("../app/(app)/collect/page.tsx");
  assert.match(collect, /financedBy: r\.financedBy \?\? null/);
  assert.match(collect, /!financed\.has\(ph\.estimate_id\)/);
  const view = source("../app/(app)/collect/collect-view.tsx");
  assert.match(view, /agingBucket\(r\.financedBy \? null : r\.dueDate, today\)/);
  assert.match(view, /Financing · \$\{r\.financedBy\}/);

  // The bell's overdue invoices skip it.
  assert.match(source("./actions/notifications.ts"), /financed\.has\(p\.estimate_id\)/);
  // The customer's home page asks for nothing on it.
  assert.match(source("../app/portal/home/page.tsx"), /financedBy: financed\.get\(e\.id\) \?\? null/);
});

test("the customer's home page: Financing with the lender, not an amount due", async () => {
  const { estimateMoneyChip } = await import("./portal/portal-display.ts");
  assert.deepEqual(estimateMoneyChip({ depositPaid: true, amountDueCents: 0, phaseDueCents: 1_500_000, financedBy: "Service Finance" }), {
    label: "Financing · Service Finance",
    tone: "blue",
  });
  // Nothing left: as before.
  assert.deepEqual(estimateMoneyChip({ depositPaid: true, amountDueCents: 0, phaseDueCents: 0, financedBy: "Service Finance" }), {
    label: "Deposit paid",
    tone: "green",
  });
});

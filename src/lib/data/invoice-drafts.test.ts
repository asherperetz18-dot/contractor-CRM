import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  INVOICE_TERMS_DAYS,
  invoiceEditError,
  invoiceEditTotals,
  paymentTermsLabel,
  type InvoiceEditLine,
} from "./invoices.ts";
import { buildInvoiceRows, inStatusGroup, invoiceSummary } from "./invoice-rows.ts";

/**
 * Step 2 of full invoicing (DECISIONS #149): an invoice can be saved as
 * a draft, edited -- quantities, tax at the company's rate, payment
 * terms, a note to the customer -- and sent when it's right. Invoices
 * count on their own (INV-1001, INV-1002, ...), and once one is issued
 * it is a record: a mistake is cancelled and re-issued, never edited.
 */

const line = (over: Partial<InvoiceEditLine> = {}): InvoiceEditLine => ({
  name: "Dumpster rental",
  description: "",
  quantity: 1,
  unitPriceCents: 62_500,
  taxable: false,
  sourceExpenseId: null,
  showReceipt: false,
  ...over,
});

test("payment terms read the way a contractor writes them", () => {
  assert.deepEqual([...INVOICE_TERMS_DAYS], [0, 7, 15, 30]);
  assert.equal(paymentTermsLabel(0), "Due on receipt");
  assert.equal(paymentTermsLabel(15), "Net 15");
  assert.equal(paymentTermsLabel(null), null);
  assert.equal(paymentTermsLabel(undefined), null);
});

test("lines are priced quantity times unit price, and tax only on the taxable ones", () => {
  const totals = invoiceEditTotals(
    [line({ quantity: 3, unitPriceCents: 12_000, taxable: true }), line({ unitPriceCents: 44_750 })],
    725 // 7.25%
  );
  assert.equal(totals.subtotalCents, 36_000 + 44_750);
  assert.equal(totals.taxCents, 2_610); // 7.25% of 360.00
  assert.equal(totals.totalCents, 36_000 + 44_750 + 2_610);
  // Fractional quantities (hours, yards) price to the cent.
  assert.equal(invoiceEditTotals([line({ quantity: 2.5, unitPriceCents: 8_500 })], 0).totalCents, 21_250);
  // No rate, no tax, whatever is ticked.
  assert.equal(invoiceEditTotals([line({ taxable: true })], 0).taxCents, 0);
});

test("a draft can't be saved with a line that bills nothing or names nothing", () => {
  assert.equal(invoiceEditError([line()]), null);
  assert.equal(invoiceEditError([]), "Add at least one line.");
  assert.equal(invoiceEditError([line({ name: "  " })]), "Every line needs a description.");
  assert.equal(invoiceEditError([line({ quantity: 0 })]), "Every line needs a quantity greater than zero.");
  assert.equal(invoiceEditError([line({ unitPriceCents: 0 })]), "Every line needs a price greater than zero.");
  assert.equal(invoiceEditError([line({ unitPriceCents: 10.5 })]), "Every line needs a price greater than zero.");
  assert.equal(invoiceEditError([line({ quantity: Number.NaN })]), "Every line needs a quantity greater than zero.");
});

test("a draft invoice is listed as a draft, owes nothing yet, and counts in no total", () => {
  const rows = buildInvoiceRows(
    [
      {
        id: "d1",
        lead_id: "lead1",
        doc_number: "INV-1004",
        title: "Permit fee",
        kind: "invoice",
        status: "Draft",
        signed_at: null,
        created_at: "2026-10-05T15:00:00Z",
        total_cents: 44_750,
      },
      // A draft contract is not a bill of any kind.
      {
        id: "c1",
        lead_id: "lead1",
        doc_number: "EST-1050",
        title: "Kitchen",
        kind: "contract",
        status: "Draft",
        signed_at: null,
        created_at: "2026-10-05T15:00:00Z",
        total_cents: 1_000_000,
      },
    ],
    [{ id: "s1", estimate_id: "d1", sort_order: 0, name: "Permit fee", amount_cents: 44_750, requested_at: null, due_date: null, cancelled_at: null }],
    [],
    new Map(),
    "2026-10-06"
  );
  assert.equal(rows.length, 1);
  const [draft] = rows;
  assert.equal(draft.status, "draft");
  assert.equal(draft.id, "draft-d1");
  assert.equal(draft.owedCents, 0);
  assert.equal(draft.amountCents, 44_750);
  assert.ok(inStatusGroup("draft", "draft"));
  assert.ok(inStatusGroup("draft", "all"));
  assert.ok(!inStatusGroup("draft", "open"));
  const sum = invoiceSummary(rows, [], new Date("2026-10-06T12:00:00Z"));
  assert.deepEqual(sum.billed30, { cents: 0, count: 0 });
  assert.deepEqual(sum.outstanding, { cents: 0, count: 0 });
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("invoices are numbered from their own counter", () => {
  const actions = source("../actions/invoices.ts");
  assert.match(actions, /supabase\.rpc\("next_invoice_number", \{ check_company_id: guard\.companyId \}\)/);
  assert.doesNotMatch(actions, /next_estimate_number/);
  const sql = source("../../../supabase/migrations/0205_invoice_drafts.sql");
  // Starts above any invoice number the company already has, and skips
  // any number already on a document.
  assert.match(sql, /max\(substring\(e\.doc_number from '\^INV-\(\\d\+\)\$'\)::integer\)/);
  assert.match(sql, /exit when not exists \(/);
  // Only for a company the caller belongs to.
  assert.match(sql, /if not public\.is_member_of_company\(check_company_id\) then/);
  // The approval gate (written for estimates) leaves invoices alone.
  assert.match(sql, /if coalesce\(new\.kind, 'contract'\) = 'invoice' then return new; end if;/);
});

test("only a draft can be edited, issued from draft, or deleted; an issued invoice is cancelled instead", () => {
  const actions = source("../actions/invoices.ts");
  for (const fn of ["saveInvoiceDraft", "issueInvoice", "deleteInvoiceDraft"]) {
    assert.match(actions, new RegExp(`export async function ${fn}\\(`), fn);
  }
  // Every draft action loads through the one guard that refuses anything
  // but a draft invoice of this company.
  assert.equal((actions.match(/await loadDraftInvoice\(/g) ?? []).length, 3);
  assert.match(actions, /if \(!row \|\| row\.kind !== "invoice"\) return \{ error: "Invoice not found\." \};/);
  assert.match(actions, /if \(row\.status !== "Draft"\) return \{ error: "This invoice has already been issued\./);
  // Saving recomputes the money with the estimates' own arithmetic, and
  // keeps the bill (its one stage) equal to the total.
  assert.match(actions, /const totals = invoiceEditTotals\(lines, taxRateBp\);/);
  assert.match(actions, /\.update\(\{ amount_cents: totals\.totalCents, name: title, updated_at: now \}\)/);
  // Cancelling is for issued invoices; a draft is deleted.
  assert.match(actions, /if \(invoice\.status === "Draft"\) return \{ error: "This is still a draft: delete it instead\." \};/);
});

test("sending a draft always says what happened, including a text that didn't go out", () => {
  const actions = source("../actions/invoices.ts");
  // Past the point of issuing, the result says so, whatever the text did.
  assert.match(actions, /return \{ issued: true, \.\.\.\(await billInvoice\(phase\.id, row\.doc_number, row\.payment_terms_days \?\? 0, delivery\)\) \};/);
  const editor = source("../../app/(app)/estimates/[id]/invoice-draft-editor.tsx");
  // The editor gives way to the issued page, so the outcome is handed to it.
  assert.match(editor, /stashInvoiceNote\(invoice\.id, res\.error \?\? res\.warning \?\? issuedNote\(invoice\.doc_number, res\.sentTo\)\);/);
  const view = source("../../app/(app)/estimates/[id]/invoice-view.tsx");
  assert.match(view, /useState<string \| null>\(\(\) => peekInvoiceNote\(invoice\.id\)\)/);
});

test("the customer's copy says its terms, and a draft never reaches the customer", () => {
  const doc = source("../../components/estimate-document.tsx");
  assert.match(doc, /paymentTermsLabel\(estimate\.payment_terms_days\)/);
  const portal = source("../../app/portal/estimates/[id]/page.tsx");
  assert.match(portal, /if \(estimate\.status === "Draft"\) redirect\("\/portal\/home"\);/);
  // Nor does it wait in the admin's approvals queue, which the gate it
  // stands for never applies to.
  assert.match(source("../actions/estimate-approval.ts"), /\.or\("kind\.is\.null,kind\.neq\.invoice"\)/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { portalCanReadFile, staffCanReadFile } from "./file-access-rules.ts";

/**
 * Who may open a private file (DECISIONS #108).
 *
 * Staff: whoever can see the record that points at the file. The check
 * asks with the person's own signed-in client, so the same row-level
 * security that decides what the screens show decides the file too:
 * another company's member, or a sales-only rep on someone else's lead,
 * gets nothing.
 *
 * Portal customers: only what their portal shows them -- their own
 * job's files, the company documents marked for the portal, and the
 * receipts on their own invoices.
 */

type Row = Record<string, unknown>;

/** A tiny stand-in for the Supabase query builder over in-memory tables. */
function fakeDb(tables: Record<string, Row[]>) {
  const asked: string[] = [];
  const client = {
    from(table: string) {
      asked.push(table);
      let rows = [...(tables[table] ?? [])];
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => ((rows = rows.filter((r) => r[col] === val)), builder),
        neq: (col: string, val: unknown) => ((rows = rows.filter((r) => r[col] !== val)), builder),
        in: (col: string, vals: unknown[]) => ((rows = rows.filter((r) => vals.includes(r[col]))), builder),
        limit: (n: number) => ((rows = rows.slice(0, n)), builder),
        then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: rows, error: null }),
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, asked };
}

const LEAD = "lead-1";
const CO = "co-1";
const viewer = { leadId: LEAD, companyId: CO };

// ---- staff ---------------------------------------------------------------

test("staff open a job file when they can see its row", async () => {
  // What row-level security returned for this person.
  const { client } = fakeDb({ lead_files: [{ id: "f1", file_path: `${LEAD}/1-a.jpg` }] });
  assert.equal(await staffCanReadFile(client, "lead-files", `${LEAD}/1-a.jpg`), true);
  assert.equal(await staffCanReadFile(client, "lead-files", `${LEAD}/2-b.jpg`), false);
});

test("staff open a receipt through the bill or the job cost that holds it", async () => {
  const path = "receipts/_company/co-1/1-fuel.pdf";
  const viaBill = fakeDb({ vendor_bills: [{ id: "b1", receipt_path: path }] });
  assert.equal(await staffCanReadFile(viaBill.client, "lead-files", path), true);
  const viaCost = fakeDb({ job_expenses: [{ id: "e1", receipt_path: path }] });
  assert.equal(await staffCanReadFile(viaCost.client, "lead-files", path), true);
  const neither = fakeDb({});
  assert.equal(await staffCanReadFile(neither.client, "lead-files", path), false);
});

test("staff open a company document only through company_documents", async () => {
  const { client, asked } = fakeDb({ company_documents: [{ id: "d1", file_path: "co-1/1-licence.pdf" }] });
  assert.equal(await staffCanReadFile(client, "company-docs", "co-1/1-licence.pdf"), true);
  assert.deepEqual(asked, ["company_documents"]);
});

// ---- portal --------------------------------------------------------------

test("a customer opens their own job's files, never another job's", async () => {
  const { client } = fakeDb({
    lead_files: [
      { id: "f1", lead_id: LEAD, file_path: `${LEAD}/1-a.jpg` },
      { id: "f2", lead_id: "lead-2", file_path: "lead-2/1-b.jpg" },
    ],
  });
  assert.equal(await portalCanReadFile(client, viewer, "lead-files", `${LEAD}/1-a.jpg`), true);
  assert.equal(await portalCanReadFile(client, viewer, "lead-files", "lead-2/1-b.jpg"), false);
});

test("a customer opens only the company documents marked for the portal", async () => {
  const { client } = fakeDb({
    company_documents: [
      { id: "d1", company_id: CO, file_path: "co-1/1-licence.pdf", show_on_portal: true },
      { id: "d2", company_id: CO, file_path: "co-1/2-w9.pdf", show_on_portal: false },
      { id: "d3", company_id: "co-2", file_path: "co-2/1-licence.pdf", show_on_portal: true },
    ],
  });
  assert.equal(await portalCanReadFile(client, viewer, "company-docs", "co-1/1-licence.pdf"), true);
  assert.equal(await portalCanReadFile(client, viewer, "company-docs", "co-1/2-w9.pdf"), false);
  assert.equal(await portalCanReadFile(client, viewer, "company-docs", "co-2/1-licence.pdf"), false);
});

test("a customer opens a receipt only when their own sent invoice shows it", async () => {
  const path = `receipts/${LEAD}/1-tile.pdf`;
  const base = {
    job_expenses: [{ id: "e1", company_id: CO, lead_id: LEAD, receipt_path: path }],
    estimates: [{ id: "inv1", lead_id: LEAD, status: "Signed" }],
  };
  const shown = fakeDb({ ...base, estimate_items: [{ id: "i1", estimate_id: "inv1", source_expense_id: "e1", show_source_receipt: true }] });
  assert.equal(await portalCanReadFile(shown.client, viewer, "lead-files", path), true);

  // The office switched the receipt off on that line.
  const hidden = fakeDb({ ...base, estimate_items: [{ id: "i1", estimate_id: "inv1", source_expense_id: "e1", show_source_receipt: false }] });
  assert.equal(await portalCanReadFile(hidden.client, viewer, "lead-files", path), false);

  // The invoice is still a draft the customer can't open.
  const draft = fakeDb({
    ...base,
    estimates: [{ id: "inv1", lead_id: LEAD, status: "Draft" }],
    estimate_items: [{ id: "i1", estimate_id: "inv1", source_expense_id: "e1", show_source_receipt: true }],
  });
  assert.equal(await portalCanReadFile(draft.client, viewer, "lead-files", path), false);

  // A cost that was never billed back: internal, not the customer's.
  const internal = fakeDb({ ...base, estimate_items: [] });
  assert.equal(await portalCanReadFile(internal.client, viewer, "lead-files", path), false);
});

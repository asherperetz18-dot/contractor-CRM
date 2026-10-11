import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hiddenWhatsAppFiles, portalCanReadFile, staffCanReadFile } from "./file-access-rules.ts";

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

// ---- WhatsApp group copies (DECISIONS #198) ------------------------------
//
// A photo copied from a job's WhatsApp group is a lead file like any
// other, so the portal would show it. Only a group the office marked as
// the client's own shares its files; a crew group's stay office-only,
// and so do a group's once it's unlinked.

const WA_FILES = {
  lead_files: [
    { id: "crew-photo", lead_id: LEAD, file_path: `${LEAD}/1-crew.jpg` },
    { id: "client-photo", lead_id: LEAD, file_path: `${LEAD}/2-client.jpg` },
    { id: "orphan-photo", lead_id: LEAD, file_path: `${LEAD}/3-unlinked.jpg` },
    { id: "own-upload", lead_id: LEAD, file_path: `${LEAD}/4-upload.jpg` },
  ],
  whatsapp_group_messages: [
    { company_id: CO, lead_file_id: "crew-photo", group_id: "crew@g.us" },
    { company_id: CO, lead_file_id: "client-photo", group_id: "client@g.us" },
    { company_id: CO, lead_file_id: "orphan-photo", group_id: "gone@g.us" },
  ],
  whatsapp_group_links: [
    { company_id: CO, group_id: "crew@g.us", show_to_client: false },
    { company_id: CO, group_id: "client@g.us", show_to_client: true },
  ],
};

test("hiddenWhatsAppFiles: crew-group and unlinked-group copies, nothing else", async () => {
  const { client } = fakeDb(WA_FILES);
  const hidden = await hiddenWhatsAppFiles(client, CO, ["crew-photo", "client-photo", "orphan-photo", "own-upload"]);
  assert.deepEqual([...hidden].sort(), ["crew-photo", "orphan-photo"]);
});

test("hiddenWhatsAppFiles: nothing to check asks nothing", async () => {
  const { client, asked } = fakeDb(WA_FILES);
  assert.equal((await hiddenWhatsAppFiles(client, CO, [])).size, 0);
  assert.deepEqual(asked, []);
});

test("hiddenWhatsAppFiles: another company's groups never decide", async () => {
  const { client } = fakeDb({
    ...WA_FILES,
    whatsapp_group_links: [{ company_id: "co-2", group_id: "crew@g.us", show_to_client: true }],
  });
  assert.ok((await hiddenWhatsAppFiles(client, CO, ["crew-photo"])).has("crew-photo"));
});

test("a customer can't open a crew group's photo, but can open the client group's", async () => {
  const { client } = fakeDb(WA_FILES);
  assert.equal(await portalCanReadFile(client, viewer, "lead-files", `${LEAD}/1-crew.jpg`), false);
  assert.equal(await portalCanReadFile(client, viewer, "lead-files", `${LEAD}/3-unlinked.jpg`), false);
  assert.equal(await portalCanReadFile(client, viewer, "lead-files", `${LEAD}/2-client.jpg`), true);
  assert.equal(await portalCanReadFile(client, viewer, "lead-files", `${LEAD}/4-upload.jpg`), true);
});

test("a crew photo the office attached to a sent document still opens there", async () => {
  const sent = fakeDb({
    ...WA_FILES,
    estimate_files: [{ id: "ef1", estimate_id: "est-1", lead_file_id: "crew-photo" }],
    estimates: [{ id: "est-1", lead_id: LEAD, status: "Sent" }],
  });
  assert.equal(await portalCanReadFile(sent.client, viewer, "lead-files", `${LEAD}/1-crew.jpg`), true);
  const draft = fakeDb({
    ...WA_FILES,
    estimate_files: [{ id: "ef1", estimate_id: "est-1", lead_file_id: "crew-photo" }],
    estimates: [{ id: "est-1", lead_id: LEAD, status: "Draft" }],
  });
  assert.equal(await portalCanReadFile(draft.client, viewer, "lead-files", `${LEAD}/1-crew.jpg`), false);
});

test("staff still open every WhatsApp copy", async () => {
  const { client } = fakeDb(WA_FILES);
  assert.equal(await staffCanReadFile(client, "lead-files", `${LEAD}/1-crew.jpg`), true);
});

// ---- WhatsApp Inbox copies (DECISIONS #204) -------------------------------

test("staff who sort the inbox open its files; a customer never does", async () => {
  const path = "whatsapp-inbox/co-1/msg-1-receipt.jpg";
  // What row-level security returned: a sorter sees the general group's message.
  const sorter = fakeDb({ whatsapp_group_messages: [{ id: "m1", media_path: path }] });
  assert.equal(await staffCanReadFile(sorter.client, "lead-files", path), true);
  // A rep who doesn't sort the inbox gets no row back, so no file.
  const rep = fakeDb({});
  assert.equal(await staffCanReadFile(rep.client, "lead-files", path), false);
  // The portal asks with the service role: the row exists, but an inbox
  // file is nobody's job file until it's filed.
  const portal = fakeDb({ whatsapp_group_messages: [{ id: "m1", company_id: CO, media_path: path }] });
  assert.equal(await portalCanReadFile(portal.client, viewer, "lead-files", path), false);
});

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Snapshot-and-restore for deleted contacts.
 *
 * The delete itself stays a hard delete with its cascades -- nothing in
 * the app's queries or policies changes. What changes is that the
 * moment before deletion, everything the cascade is about to destroy is
 * copied into lead_trash as one JSON payload, and everything the
 * cascade merely orphans (set-null links from events, jobs, texts) is
 * recorded by id so a restore can point it back.
 *
 * Raw rows via select("*") on purpose: the TypeScript Lead type
 * undersells the real table (drive_folder_id, for one), and a snapshot
 * that only kept the typed fields would restore a contact with its
 * Drive folder link quietly missing.
 */

// Tables whose rows die with the lead (on delete cascade, keyed by
// lead_id). portal tokens/sessions and lead_views are deliberately
// absent -- short-lived credentials and page-view pings, same reasoning
// as the nightly backup.
const LEAD_CHILDREN = [
  "lead_tasks",
  "lead_notes",
  "lead_files",
  "setter_contacts",
  "job_expenses",
  "portal_payments",
  "lead_ai_analysis",
  "property_reports",
] as const;

// Tables whose rows die with an estimate (cascade, keyed by estimate_id).
const ESTIMATE_CHILDREN = [
  "estimate_groups",
  "estimate_items",
  "estimate_signers",
  "estimate_payments",
  // Restored after the bills they're on (0209, DECISIONS #154) and the
  // refunds they came with (0210, #155) -- see restoreSnapshot.
  "bill_credits",
  "estimate_views",
  "estimate_files",
  "project_checklist_items",
  // Financing steps on an estimate (0215, DECISIONS #162). Restored
  // after the follow-up tasks they point at (0216, #164).
  "estimate_financing_events",
  // Contracts switched to financing (0217, DECISIONS #166).
  "contract_payment_changes",
] as const;

// Tables that survive the delete but lose their pointer (on delete set
// null). The ids are recorded so restore can point them back.
const RELINK_TABLES: { table: string; column: string }[] = [
  { table: "events", column: "lead_id" },
  { table: "jobs", column: "lead_id" },
  { table: "documents", column: "contact_id" },
  { table: "sms_messages", column: "lead_id" },
  { table: "call_logs", column: "lead_id" },
];

// Estimate children that point at a contact's own rows, so they go in
// after them (restored before them, each failed its foreign key): an
// invoice line at the job cost it bills (0180), a photo on an estimate at
// its lead file (0080, NOT NULL; after the lines, which it can pin to), a
// credit at the refund it came with, a financing step at its follow-up
// task. A Set keeps this order.
const LATER_ESTIMATE_CHILDREN = new Set<string>([
  "estimate_items",
  "estimate_files",
  "bill_credits",
  "estimate_financing_events",
]);

type Row = Record<string, unknown>;

export type LeadTrashPayload = {
  lead: Row;
  children: Record<string, Row[]>;
  relinks: Record<string, string[]>;
};

type Admin = SupabaseClient;

export async function snapshotLead(admin: Admin, lead: Row): Promise<LeadTrashPayload> {
  const leadId = String(lead.id);
  const children: Record<string, Row[]> = {};

  const grab = async (table: string, column: string, value: string) => {
    const { data } = await admin.from(table).select("*").eq(column, value);
    return (data as Row[]) ?? [];
  };

  for (const table of LEAD_CHILDREN) {
    children[table] = await grab(table, "lead_id", leadId);
  }

  const estimates = await grab("estimates", "lead_id", leadId);
  children.estimates = estimates;
  const estimateIds = estimates.map((e) => String(e.id));
  for (const table of ESTIMATE_CHILDREN) {
    if (!estimateIds.length) {
      children[table] = [];
      continue;
    }
    const { data } = await admin.from(table).select("*").in("estimate_id", estimateIds);
    children[table] = (data as Row[]) ?? [];
  }

  // Both sides of the duplicate-dismissal ledger.
  const { data: dups } = await admin
    .from("lead_duplicate_dismissals")
    .select("*")
    .or(`lead_id_a.eq.${leadId},lead_id_b.eq.${leadId}`);
  children.lead_duplicate_dismissals = (dups as Row[]) ?? [];

  const relinks: Record<string, string[]> = {};
  for (const { table, column } of RELINK_TABLES) {
    const { data } = await admin.from(table).select("id").eq(column, leadId);
    relinks[table] = ((data as { id: string }[]) ?? []).map((r) => r.id);
  }

  return { lead, children, relinks };
}

/**
 * Re-inserts a snapshot. The lead row must succeed or the whole restore
 * is off; every child table after that is best-effort with per-row
 * retry, so one odd row (a dismissal whose other lead is gone, a signer
 * referencing a deleted profile) costs itself and not the contact.
 */
export async function restoreSnapshot(
  admin: Admin,
  payload: LeadTrashPayload
): Promise<{ error?: string; issues: string[] }> {
  const issues: string[] = [];
  const leadId = String(payload.lead.id);

  const { error: leadErr } = await admin.from("leads").insert(payload.lead);
  if (leadErr) return { error: `Couldn't restore the contact: ${leadErr.message}`, issues };

  const put = async (table: string, rows: Row[] | undefined) => {
    if (!rows?.length) return;
    const { error } = await admin.from(table).insert(rows);
    if (!error) return;
    // Batch refused -- retry one by one so a single bad row doesn't
    // take the rest of its table down with it.
    for (const row of rows) {
      const { error: rowErr } = await admin.from(table).insert(row);
      if (rowErr) issues.push(`${table}: ${rowErr.message}`);
    }
  };

  // Change orders reference their parent estimate and revisions their
  // predecessor, so parents go first and creation order settles the rest.
  const estimates = [...(payload.children.estimates ?? [])].sort(
    (a, b) =>
      (a.parent_estimate_id ? 1 : 0) - (b.parent_estimate_id ? 1 : 0) ||
      String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""))
  );
  await put("estimates", estimates);
  for (const table of ESTIMATE_CHILDREN) {
    if (!LATER_ESTIMATE_CHILDREN.has(table)) await put(table, payload.children[table]);
  }
  for (const table of LEAD_CHILDREN) {
    // A refund points at the payment it returns (refund_of, 0210), so
    // payments go in before their refunds.
    const rows =
      table === "portal_payments"
        ? [...(payload.children[table] ?? [])].sort((a, b) => (a.refund_of ? 1 : 0) - (b.refund_of ? 1 : 0))
        : payload.children[table];
    await put(table, rows);
  }
  for (const table of LATER_ESTIMATE_CHILDREN) await put(table, payload.children[table]);
  await put("lead_duplicate_dismissals", payload.children.lead_duplicate_dismissals);

  for (const { table, column } of RELINK_TABLES) {
    const ids = payload.relinks?.[table] ?? [];
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await admin
        .from(table)
        .update({ [column]: leadId })
        .in("id", ids.slice(i, i + 200));
      if (error) issues.push(`${table} relink: ${error.message}`);
    }
  }

  return { issues };
}

export const TRASH_RETENTION_DAYS = 30;

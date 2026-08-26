import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Every table worth restoring from, in dependency order -- companies and
 * profiles first so a restore can satisfy foreign keys as it goes.
 *
 * activity_events is deliberately excluded: it's ~19k page-view pings that
 * would dominate the file and that nobody would ever restore. Portal
 * session/token tables are excluded too -- they hold short-lived
 * credentials, are worthless a day later, and shouldn't be copied around.
 */
export const BACKUP_TABLES = [
  "companies",
  "profiles",
  "company_members",
  "company_profile",
  "pipeline_stages",
  "calendars",
  "project_types",
  "lead_sources",
  "call_dispositions",
  "role_page_visibility",
  "sms_quick_texts",
  "leads",
  "events",
  "jobs",
  "documents",
  "contracts",
  "lead_tasks",
  "lead_notes",
  "lead_files",
  "setter_contacts",
  "sms_messages",
  "call_logs",
  "dial_lists",
  "ai_action_proposals",
  // The estimate tables were missing entirely -- the list predates the
  // estimates feature and was never extended, which was discovered the
  // day a deleted contact took a $121k estimate down with it and no
  // backup had ever held a single estimate row. Priced, signed dollar
  // commitments are the last thing a backup should be missing.
  "estimates",
  "estimate_groups",
  "estimate_items",
  "estimate_signers",
  "estimate_files",
  "estimate_payments",
  "estimate_views",
  "portal_payments",
  "contract_templates",
  "scope_templates",
  "company_documents",
  "company_phone_numbers",
  "vendors",
  "job_expenses",
  "lead_duplicate_dismissals",
  "lead_trash",
  "lead_ai_analysis",
  "checklist_templates",
  "project_checklist_items",
] as const;

const PAGE_SIZE = 1000;

export type BackupResult = {
  generatedAt: string;
  tables: Record<string, unknown[]>;
  counts: Record<string, number>;
  skipped: Record<string, string>;
  totalRows: number;
};

/**
 * Reads every backup table in full.
 *
 * Paginates explicitly because PostgREST caps a plain select at 1000 rows
 * and returns the truncated set without complaining -- a backup that
 * silently stops at 1000 leads would be worse than no backup, since it
 * would look fine until the day it was needed.
 */
export async function buildBackup(): Promise<BackupResult> {
  const admin = createAdminClient();
  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  const skipped: Record<string, string> = {};
  let totalRows = 0;

  for (const table of BACKUP_TABLES) {
    const rows: unknown[] = [];
    let from = 0;
    for (;;) {
      const { data, error } = await admin
        .from(table)
        .select("*")
        .range(from, from + PAGE_SIZE - 1);
      if (error) {
        skipped[table] = error.message;
        break;
      }
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    if (skipped[table]) continue;
    tables[table] = rows;
    counts[table] = rows.length;
    totalRows += rows.length;
  }

  return {
    generatedAt: new Date().toISOString(),
    tables,
    counts,
    skipped,
    totalRows,
  };
}

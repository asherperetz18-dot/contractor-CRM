import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { summarizeBackupCounts, type BackupCountSummary } from "@/lib/backup-counts";
import {
  BACKUP_TABLES,
  companyScopeColumn,
  withoutSecrets,
  type BackupScope,
} from "@/lib/backup-scope";

const PAGE_SIZE = 1000;

type HeadCount = { count: "exact"; head: true };

/**
 * A table's rows within the scope. In a company scope, people are read
 * through company_members, so the member list decides who is included --
 * without the seats that exist only because someone is a platform admin
 * (0132), which the company's own roster leaves out too.
 */
function selectScoped(
  admin: ReturnType<typeof createAdminClient>,
  table: string,
  scope: BackupScope,
  head?: HeadCount
) {
  if (scope === "all") return admin.from(table).select("*", head);
  switch (companyScopeColumn(table)) {
    case "id":
      return admin.from(table).select("*", head).eq("id", scope.companyId);
    case "members":
      return admin
        .from("company_members")
        .select("profiles(*)", head)
        .eq("company_id", scope.companyId)
        .eq("granted_via_platform_admin", false);
    case "company_id":
      return admin.from(table).select("*", head).eq("company_id", scope.companyId);
  }
}

/**
 * How many rows a backup would contain, without reading any of them.
 *
 * The Backup settings page only renders counts, but it used to get them
 * from buildBackup() -- a full read of every table. The day 73k leads
 * were imported, that read grew past Vercel's 60-second static-page
 * budget and failed the whole deploy. One head-count query per table
 * keeps the page's cost proportional to the table list, not the data.
 */
export async function countBackupRows(scope: BackupScope): Promise<BackupCountSummary> {
  const admin = createAdminClient();
  const results = [];
  for (const table of BACKUP_TABLES) {
    const { count, error } = await selectScoped(admin, table, scope, { count: "exact", head: true });
    results.push({ table: table as string, count, error: error?.message ?? null });
  }
  return summarizeBackupCounts(results);
}

export type BackupResult = {
  generatedAt: string;
  tables: Record<string, unknown[]>;
  counts: Record<string, number>;
  skipped: Record<string, string>;
  totalRows: number;
};

/**
 * Reads every backup table in full -- every company's rows for the
 * nightly job ("all"), or one company's for its own Settings → Backup,
 * which also leaves out saved keys and tokens (withoutSecrets).
 *
 * Paginates explicitly because PostgREST caps a plain select at 1000 rows
 * and returns the truncated set without complaining -- a backup that
 * silently stops at 1000 leads would be worse than no backup, since it
 * would look fine until the day it was needed.
 */
export async function buildBackup(scope: BackupScope): Promise<BackupResult> {
  const admin = createAdminClient();
  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  const skipped: Record<string, string> = {};
  let totalRows = 0;

  for (const table of BACKUP_TABLES) {
    const rows: unknown[] = [];
    let from = 0;
    for (;;) {
      const { data, error } = await selectScoped(admin, table, scope).range(from, from + PAGE_SIZE - 1);
      if (error) {
        skipped[table] = error.message;
        break;
      }
      const page = (data ?? []) as Record<string, unknown>[];
      if (scope === "all") {
        rows.push(...page);
      } else {
        const own = companyScopeColumn(table) === "members" ? page.map((r) => r.profiles) : page;
        for (const row of own) {
          if (row) rows.push(withoutSecrets(row as Record<string, unknown>));
        }
      }
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

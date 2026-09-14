/**
 * Shapes per-table count answers into what the Backup settings page
 * renders. Pure and separate from the Supabase calls so the
 * error/empty-table judgments are testable without a live database --
 * same split as schema-drift.ts.
 */

export type TableCount = {
  table: string;
  /** The database's count for the table; null when it answered nothing. */
  count: number | null;
  error?: string | null;
};

export type BackupCountSummary = {
  counts: Record<string, number>;
  skipped: Record<string, string>;
  totalRows: number;
};

export function summarizeBackupCounts(results: TableCount[]): BackupCountSummary {
  const counts: Record<string, number> = {};
  const skipped: Record<string, string> = {};
  let totalRows = 0;

  for (const r of results) {
    if (r.error) {
      skipped[r.table] = r.error;
      continue;
    }
    const n = r.count ?? 0;
    counts[r.table] = n;
    totalRows += n;
  }

  return { counts, skipped, totalRows };
}

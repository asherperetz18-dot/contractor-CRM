/**
 * Did every migration that shipped with the deployed code actually get
 * run on the live database?
 *
 * Deploys are automatic (merge → Vercel) but migrations are manual
 * (paste into the Supabase SQL editor), and twice in one day a merged
 * migration was skipped: every lead save failed on leads.phone2, and
 * every call log failed on call_logs.correlation_id. This check probes
 * the live database for the columns recent migrations add, and names
 * the exact migration file to run for anything absent.
 *
 * Deliberately probe-based (a harmless SELECT per column through
 * PostgREST) rather than reading information_schema through an RPC: an
 * RPC would itself need a migration to exist, and a checker that the
 * unapplied migration disables is no checker at all.
 *
 * Covers columns and tables only. A migration that only changes a
 * constraint, policy, or function (e.g. 0146, 0148) can't be seen from
 * a SELECT and is out of scope here.
 */

export type SchemaProbe = {
  table: string;
  column: string;
  /** The migration file in supabase/migrations/ that adds it. */
  migration: string;
};

/**
 * One probe per column added by a recent hand-run migration. Append a
 * row here whenever a new migration adds a column or table (probe a new
 * table via any of its columns); prune entries once they are years old
 * and provably everywhere.
 */
export const EXPECTED_COLUMNS: readonly SchemaProbe[] = [
  { table: "profiles", column: "estimate_funnel_order", migration: "0145_estimate_funnel_order.sql" },
  { table: "screen_shares", column: "kind", migration: "0149_cobrowse_share_kind.sql" },
  { table: "leads", column: "phone2", migration: "0150_lead_phone2_phone3.sql" },
  { table: "leads", column: "phone3", migration: "0150_lead_phone2_phone3.sql" },
  { table: "call_logs", column: "correlation_id", migration: "0151_call_logs_observability_correlation.sql" },
  { table: "call_logs", column: "sentry_event_id", migration: "0151_call_logs_observability_correlation.sql" },
  { table: "portal_payments", column: "source", migration: "0151_portal_payments_manual_columns.sql" },
  { table: "portal_payments", column: "recorded_by", migration: "0151_portal_payments_manual_columns.sql" },
  { table: "portal_payments", column: "reference", migration: "0151_portal_payments_manual_columns.sql" },
  { table: "portal_payments", column: "note", migration: "0151_portal_payments_manual_columns.sql" },
];

export type ProbeError = { code?: string | null; message?: string | null };

export type ProbeOutcome = SchemaProbe & { error: ProbeError | null };

/**
 * Does this probe error mean "the column/table isn't there" -- as
 * opposed to the probe itself failing (network, permissions)? Postgres
 * answers 42703/42P01; PostgREST answers PGRST204/PGRST205 from its
 * schema cache (the exact shape both production incidents wore). The
 * message fallback covers clients that surface no code. Anything else
 * must never be reported as drift -- a flaky probe claiming a missing
 * migration would send someone to re-run SQL that already ran.
 */
export function isMissingSchemaError(error: ProbeError | null | undefined): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (code === "42703" || code === "42P01" || code === "PGRST204" || code === "PGRST205") {
    return true;
  }
  const message = error.message ?? "";
  return (
    /column .* does not exist/i.test(message) ||
    /relation .* does not exist/i.test(message) ||
    /could not find the .* (column|table)/i.test(message)
  );
}

export type DriftReport = {
  /** True only when every probe ran and found its column. */
  ok: boolean;
  checked: number;
  /** Unapplied migrations, in file order, each with the columns it would add. */
  missing: { migration: string; columns: string[] }[];
  /** Probes that failed for a reason other than a missing column -- not drift. */
  failed: { column: string; message: string }[];
};

export function buildDriftReport(outcomes: ProbeOutcome[]): DriftReport {
  const byMigration = new Map<string, string[]>();
  const failed: DriftReport["failed"] = [];

  for (const o of outcomes) {
    if (!o.error) continue;
    const qualified = `${o.table}.${o.column}`;
    if (isMissingSchemaError(o.error)) {
      byMigration.set(o.migration, [...(byMigration.get(o.migration) ?? []), qualified]);
    } else {
      failed.push({ column: qualified, message: o.error.message ?? "Probe failed." });
    }
  }

  const missing = [...byMigration.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([migration, columns]) => ({ migration, columns }));

  return {
    ok: missing.length === 0 && failed.length === 0,
    checked: outcomes.length,
    missing,
    failed,
  };
}

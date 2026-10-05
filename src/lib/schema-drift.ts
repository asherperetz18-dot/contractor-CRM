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
  // Added by hand in production and only written down later (DECISIONS #115).
  { table: "leads", column: "dispatcher_id", migration: "0067_recorded_from_production.sql" },
  { table: "company_profile", column: "twilio_account_sid", migration: "0067_recorded_from_production.sql" },
  { table: "lead_files", column: "event_id", migration: "0067_recorded_from_production.sql" },
  { table: "company_profile", column: "ai_call_notes_enabled", migration: "0138_ai_call_notes.sql" },
  { table: "company_profile", column: "twilio_vi_service_sid", migration: "0138_ai_call_notes.sql" },
  { table: "call_logs", column: "transcript_sid", migration: "0138_ai_call_notes.sql" },
  { table: "call_logs", column: "ai_note_at", migration: "0138_ai_call_notes.sql" },
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
  { table: "profiles", column: "dashboard_panel_order", migration: "0162_dashboard_rollup.sql" },
  { table: "time_clock_settings", column: "tracked_roles", migration: "0174_time_clock.sql" },
  { table: "time_punches", column: "end_reason", migration: "0174_time_clock.sql" },
  { table: "location_pings", column: "accuracy_m", migration: "0174_time_clock.sql" },
  { table: "site_visits", column: "arrived_at", migration: "0174_time_clock.sql" },
  { table: "time_punch_changes", column: "old_punch", migration: "0174_time_clock.sql" },
  { table: "tracking_notices", column: "accepted_at", migration: "0174_time_clock.sql" },
  { table: "company_profile", column: "primecall_domain", migration: "0177_primecall.sql" },
  { table: "call_logs", column: "primecall_call_id", migration: "0177_primecall.sql" },
  { table: "company_members", column: "can_send_without_approval", migration: "0179_send_without_approval.sql" },
  { table: "lead_file_deletions", column: "file_id", migration: "0182_lead_file_deletions.sql" },
  { table: "time_clock_settings", column: "clock_in_check", migration: "0185_clock_in_check.sql" },
  { table: "time_punches", column: "in_check", migration: "0185_clock_in_check.sql" },
  { table: "site_visits", column: "job_id", migration: "0185_clock_in_check.sql" },
  { table: "legacy_shared_recordings", column: "recording_url", migration: "0191_legacy_shared_recordings.sql" },
  { table: "sms_messages", column: "owner_id", migration: "0192_text_privacy.sql" },
  { table: "company_profile", column: "meta_page_access_token_enc", migration: "0193_meta_secrets_encrypted.sql" },
  { table: "leads", column: "stage_key", migration: "0195_stage_tags.sql" },
  { table: "company_profile", column: "wording", migration: "0196_company_wording.sql" },
  { table: "platform_access_log", column: "opened_at", migration: "0197_platform_access_log.sql" },
  { table: "company_billing", column: "trial_ends_at", migration: "0198_billing_trial.sql" },
  { table: "company_usage", column: "month", migration: "0199_company_usage.sql" },
  { table: "company_limits", column: "sms_per_month", migration: "0200_company_limits.sql" },
  { table: "company_closures", column: "closed_at", migration: "0201_company_closures.sql" },
  { table: "company_profile", column: "role_names", migration: "0202_company_role_names.sql" },
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

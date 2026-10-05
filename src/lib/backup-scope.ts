/**
 * What a backup covers, kept free of database calls so it can be tested
 * on its own (backup-scope.test.ts). lib/backup.ts does the reading.
 */

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
  "property_reports",
  "checklist_templates",
  "project_checklist_items",
  // Added with the platform's per-company export (DECISIONS #134): every
  // table a company's business lives in, which the list had fallen behind
  // as features shipped. backup-scope.test.ts now fails when a new
  // company table is neither here nor in BACKUP_LEFT_OUT. Each comes
  // after the tables it points at.
  "payment_accounts",
  "vendor_bills",
  "vendor_bill_payments",
  "rep_commission_payouts",
  "sales_team_changes",
  "marketing_spend",
  "lead_shared_notes",
  "lead_file_deletions",
  "lead_views",
  "ai_receptionist_calls",
  "time_clock_settings",
  "time_punches",
  "time_punch_changes",
  "location_pings",
  "site_visits",
  "tracking_notices",
] as const;

/**
 * Company tables a backup leaves out on purpose, and why. Anything with a
 * company_id must be in BACKUP_TABLES or here (backup-scope.test.ts).
 */
export const BACKUP_LEFT_OUT: Record<string, string> = {
  activity_events: "page-view pings: huge, and nobody restores them",
  portal_login_tokens: "short-lived customer sign-in links",
  portal_sessions: "short-lived customer sign-ins",
  screen_shares: "a live screen-share's one-time token",
  google_drive_connection: "a Google sign-in, not data",
  google_calendar_connections: "a Google sign-in, not data",
  meta_secrets_legacy: "an old Facebook key kept only for a rollback",
  user_devices: "which phones and browsers signed in",
  notification_reads: "which alerts a person has seen",
  signup_invites: "the platform's own sign-up records",
  company_billing: "the platform's own billing record",
  platform_access_log: "the platform's own record of who opened the company",
  company_usage: "the platform's own usage counts",
  company_limits: "the platform's own limits",
  company_closures: "the platform's own record of a closed company",
};

/**
 * "all" is the nightly job's full export, behind the cron secret. A
 * company scope is what Settings → Backup hands that company's Office or
 * Admin: their own rows and nothing else. The export reads with the
 * service role, which RLS never sees, so this narrowing is the boundary.
 */
export type BackupScope = "all" | { companyId: string };

/**
 * How a company-scoped backup narrows each table: the company row by its
 * own id, people through the company's member list, everything else by
 * company_id. profiles.company_id is not used -- it is the legacy first
 * company, which misses anyone who joined later and keeps anyone who left.
 */
export function companyScopeColumn(table: string): "id" | "members" | "company_id" {
  if (table === "companies") return "id";
  if (table === "profiles") return "members";
  return "company_id";
}

// Encrypted keys (*_enc), webhook secrets, access and verify tokens. The
// settings pages never send these back to a browser (only the last four
// characters), so a company's own download doesn't either. The nightly
// full export keeps them: it is the copy a restore is made from.
const SECRET_COLUMN = /(_enc$|secret|token|password|api_key)/i;

export function withoutSecrets<T extends Record<string, unknown>>(row: T): Partial<T> {
  return Object.fromEntries(Object.entries(row).filter(([k]) => !SECRET_COLUMN.test(k))) as Partial<T>;
}

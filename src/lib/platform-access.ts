/**
 * The record of platform admins opening companies (DECISIONS #128).
 *
 * A platform admin holds a seat in every company only so they can look
 * in (migration 0132, `granted_via_platform_admin`). Each time one of
 * those seats is used to open a company, who and when goes on an
 * append-only record (`platform_access_log`, migration 0197). Opening a
 * company the admin genuinely belongs to is not recorded.
 */
import { isMissingSchemaError, type ProbeError } from "./schema-drift.ts";

/**
 * The company someone lands in when none is chosen (no cookie yet, say a
 * new device): their own before any they only look into, so a platform
 * admin never ends up inside a customer's company without opening it.
 */
export function defaultCompanyId(memberships: { company_id: string; look_in: boolean }[]): string | null {
  return (memberships.find((m) => !m.look_in) ?? memberships[0])?.company_id ?? null;
}

/**
 * What writing the record came to. "failed" keeps the company closed:
 * there are no unrecorded visits. "not_ready" means migration 0197 hasn't
 * been run, and opening carries on as it did before it existed.
 */
export function accessRecordOutcome(error: ProbeError | null): "recorded" | "not_ready" | "failed" {
  if (!error) return "recorded";
  return isMissingSchemaError(error) ? "not_ready" : "failed";
}

export type AccessLogRow = {
  id: string;
  company_name: string | null;
  actor_name: string | null;
  actor_email: string | null;
  opened_at: string;
};

export function filterAccessLog(rows: AccessLogRow[], search: string): AccessLogRow[] {
  const q = search.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) =>
    [r.company_name, r.actor_name, r.actor_email].some((s) => (s ?? "").toLowerCase().includes(q))
  );
}

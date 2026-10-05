import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError, logWarn } from "@/lib/observability/logger";
import { accessRecordOutcome, type AccessLogRow } from "@/lib/platform-access";

/**
 * Writes one line on the platform access record (DECISIONS #128): this
 * person opened this company through their platform admin seat. Their
 * name and email are copied in, so the line still reads after the
 * account is gone. Service role: nobody signed in can write the table.
 */
export async function recordPlatformAccess(
  companyId: string,
  profileId: string
): Promise<"recorded" | "not_ready" | "failed"> {
  const admin = createAdminClient();
  const { data: person } = await admin
    .from("profiles")
    .select("name, email")
    .eq("id", profileId)
    .maybeSingle<{ name: string | null; email: string | null }>();

  const { error } = await admin.from("platform_access_log").insert({
    company_id: companyId,
    profile_id: profileId,
    actor_name: person?.name ?? null,
    actor_email: person?.email ?? null,
  });

  const outcome = accessRecordOutcome(error);
  if (outcome === "not_ready") {
    logWarn({ event: "platform_access.not_ready", companyId, migration: "0197_platform_access_log.sql" });
  } else if (outcome === "failed") {
    logError({ event: "platform_access.record_failed", companyId, message: error?.message });
  }
  return outcome;
}

const ACCESS_RECORD_LIMIT = 300;

/**
 * The newest lines of the record, for the Platform Admin page (behind
 * PlatformAdminGate, like the rest of that page's loaders). Empty until
 * migration 0197 has run.
 */
export async function listPlatformAccess(): Promise<AccessLogRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("platform_access_log")
    .select("id, opened_at, actor_name, actor_email, companies(name)")
    .order("opened_at", { ascending: false })
    .limit(ACCESS_RECORD_LIMIT);
  if (error || !data) return [];

  type Raw = Omit<AccessLogRow, "company_name"> & {
    companies: { name: string } | { name: string }[] | null;
  };
  return (data as Raw[]).map((r) => {
    const co = Array.isArray(r.companies) ? r.companies[0] : r.companies;
    return {
      id: r.id,
      opened_at: r.opened_at,
      actor_name: r.actor_name,
      actor_email: r.actor_email,
      company_name: co?.name ?? null,
    };
  });
}

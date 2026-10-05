import "server-only";
import { revalidateTag, unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Whether a platform admin has closed a company (company_closures, 0201;
 * DECISIONS #135). A closed company is locked exactly like a lapsed
 * subscription, through the same checks. Read with the service-role
 * client: only the server reads or writes the table.
 */
export type CompanyClosure = { closedAt: string; reason: string | null };

type ClosureRow = { company_id: string; closed_at: string; reason: string | null };

/** Uncached, for the lock screen and the close/reopen actions. */
export async function readCompanyClosure(companyId: string): Promise<CompanyClosure | null> {
  const { data, error } = await createAdminClient()
    .from("company_closures")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle<ClosureRow>();
  // Before 0201 has run there is no table, and nothing is closed.
  if (error || !data) return null;
  return { closedAt: data.closed_at, reason: data.reason };
}

const closureTag = (companyId: string) => `company-closure:${companyId}`;

/** Cached for the app shell and every send, dropped the moment it changes. */
export function getCompanyClosure(companyId: string): Promise<CompanyClosure | null> {
  return unstable_cache(readCompanyClosure, ["company-closure", companyId], {
    tags: [closureTag(companyId)],
    revalidate: 300,
  })(companyId);
}

export function dropCompanyClosureCache(companyId: string): void {
  revalidateTag(closureTag(companyId), { expire: 0 });
}

/** Every closed company's id, for the scheduled jobs (one read per run). */
export async function closedCompanyIds(): Promise<string[]> {
  const { data, error } = await createAdminClient().from("company_closures").select("company_id");
  if (error || !data) return [];
  return (data as { company_id: string }[]).map((r) => r.company_id);
}

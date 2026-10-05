import "server-only";
import { revalidateTag, unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { usageFromRow, usageMonth, type MonthUsage, type UsageRow } from "@/lib/usage/usage";
import {
  NO_LIMITS,
  limitMessage,
  limitReached,
  limitsFromRow,
  type CompanyLimits,
  type LimitKind,
  type LimitsRow,
} from "@/lib/usage/limits";

const limitsTag = (companyId: string) => `company-limits:${companyId}`;

async function readLimits(companyId: string): Promise<CompanyLimits> {
  const { data, error } = await createAdminClient()
    .from("company_limits")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle<LimitsRow>();
  // Before 0200 has run there is no table, and no limits.
  if (error) return NO_LIMITS;
  return limitsFromRow(data);
}

/**
 * A company's monthly limits (DECISIONS #133), cached: asked before every
 * AI answer, text and email. Setting them drops the cache at once.
 */
export function getCompanyLimits(companyId: string): Promise<CompanyLimits> {
  return unstable_cache(readLimits, ["company-limits", companyId], {
    tags: [limitsTag(companyId)],
    revalidate: 300,
  })(companyId);
}

export function dropCompanyLimitsCache(companyId: string): void {
  revalidateTag(limitsTag(companyId), { expire: 0 });
}

async function readMonthUsage(companyId: string): Promise<MonthUsage> {
  const { data } = await createAdminClient()
    .from("company_usage")
    .select("*")
    .eq("company_id", companyId)
    .eq("month", usageMonth(new Date()))
    .maybeSingle<UsageRow>();
  return usageFromRow(data);
}

/**
 * Why this company can't use `kind` right now -- this month's limit is
 * used up -- or null when it may go ahead. A company with no limit for
 * `kind` (every company, until one is set) costs one cached read and
 * never reads its counts.
 */
export async function usageLimitError(companyId: string, kind: LimitKind): Promise<string | null> {
  const limits = await getCompanyLimits(companyId);
  const limit = limits[kind];
  if (limit === null) return null;
  const usage = await readMonthUsage(companyId);
  return limitReached(usage, limits, kind) ? limitMessage(kind, limit) : null;
}

import "server-only";
import { logError, logWarn } from "@/lib/observability/logger";
import { captureError } from "@/lib/observability/sentry";
import { createAdminClient } from "@/lib/supabase/admin";
import { LOCKED_STATUSES } from "@/lib/billing/subscription";
import { closedCompanyIds } from "@/lib/billing/company-closure";
import { eachCompany, fairOrder, withoutLocked, type EachCompanyResult } from "./each-company";

export { runSummary } from "./each-company";

/**
 * How long a scheduled job keeps starting new companies. The functions
 * run for up to 300 seconds; stopping new work at four minutes leaves the
 * company in progress room to finish rather than being cut off mid-way.
 */
export const CRON_BUDGET_MS = 240_000;

/**
 * Runs a scheduled job's per-company work (DECISIONS #126): each company
 * in its own safety net, the order turned every minute so nobody is
 * always last, and a time budget so the run ends cleanly. A company that
 * fails is logged and sent to Sentry tagged with its company id -- it
 * used to fail the whole run, and every company after it.
 */
export async function runForEachCompany<C, T>(
  route: string,
  items: readonly C[],
  idOf: (item: C) => string,
  run: (item: C) => Promise<T>,
  opts: {
    budgetMs?: number;
    /** The company an item belongs to, when its id is something else (a calendar connection). */
    companyOf?: (item: C) => string;
  } = {}
): Promise<EachCompanyResult<T>> {
  // Locked companies are paused (DECISIONS #131): one read per run, not
  // one per company.
  const { kept, paused } = withoutLocked(items, opts.companyOf ?? idOf, await lockedCompanyIds());
  const stable = [...kept].sort((a, b) => idOf(a).localeCompare(idOf(b)));
  const result = await eachCompany(fairOrder(stable, Math.floor(Date.now() / 60_000)), idOf, run, {
    budgetMs: opts.budgetMs ?? CRON_BUDGET_MS,
    onFailure: (companyId, err) => {
      logError({ event: `${route}.company_failed`, route, companyId });
      captureError(err, { route, companyId, service: "cron" });
    },
  });
  if (result.deferred.length > 0) {
    logWarn({ event: `${route}.deferred`, route });
  }
  return { ...result, paused };
}

/**
 * Companies whose AI Build Pro subscription is locked, or that a platform
 * admin closed (DECISIONS #135). An unreadable
 * table (0175 not run) locks nobody, exactly as the app shell treats it.
 */
async function lockedCompanyIds(): Promise<Set<string>> {
  const [{ data, error }, closed] = await Promise.all([
    createAdminClient().from("company_billing").select("company_id").in("billing_status", [...LOCKED_STATUSES]),
    // Closed companies are paused too (DECISIONS #135).
    closedCompanyIds(),
  ]);
  const lapsed = error || !data ? [] : (data as { company_id: string }[]).map((r) => r.company_id);
  return new Set([...lapsed, ...closed]);
}

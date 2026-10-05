import "server-only";
import { logError, logWarn } from "@/lib/observability/logger";
import { captureError } from "@/lib/observability/sentry";
import { eachCompany, fairOrder, type EachCompanyResult } from "./each-company";

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
  opts: { budgetMs?: number } = {}
): Promise<EachCompanyResult<T>> {
  const stable = [...items].sort((a, b) => idOf(a).localeCompare(idOf(b)));
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
  return result;
}

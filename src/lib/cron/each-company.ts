/**
 * Running a scheduled job across every company (DECISIONS #126).
 *
 * Each company's part runs in its own safety net: a company whose Twilio,
 * CallRail, Google or weather service is down -- or whose data trips a
 * bug -- is reported and skipped, and every company after it still gets
 * its reminders. Before this, one thrown error ended the run for all of
 * them, and the same company failing near the front of the list could
 * starve everyone behind it on every run.
 *
 * Pure: the caller hands in how failures are reported (run-companies.ts
 * logs and sends them to Sentry, tagged with the company).
 */

export type CompanyFailure = { companyId: string; error: string };

export type EachCompanyResult<T> = {
  done: { companyId: string; value: T }[];
  failed: CompanyFailure[];
  /** Not started: the time budget ran out. The next run picks them up. */
  deferred: string[];
  /** Companies whose subscription is locked: paused, not run (DECISIONS #131). */
  paused?: string[];
};

/** The list turned by `seed` places, so no company is always last. */
export function fairOrder<T>(items: readonly T[], seed: number): T[] {
  if (items.length < 2) return [...items];
  const start = ((Math.floor(seed) % items.length) + items.length) % items.length;
  return [...items.slice(start), ...items.slice(0, start)];
}

function message(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "Unknown error";
}

export async function eachCompany<C, T>(
  items: readonly C[],
  idOf: (item: C) => string,
  run: (item: C) => Promise<T>,
  opts: {
    /** Stop starting new companies after this long; the rest wait for the next run. */
    budgetMs?: number;
    now?: () => number;
    onFailure?: (companyId: string, err: unknown) => void;
  } = {}
): Promise<EachCompanyResult<T>> {
  const now = opts.now ?? Date.now;
  const startedAt = now();
  const out: EachCompanyResult<T> = { done: [], failed: [], deferred: [] };

  for (const item of items) {
    const companyId = idOf(item);
    if (opts.budgetMs !== undefined && now() - startedAt > opts.budgetMs) {
      out.deferred.push(companyId);
      continue;
    }
    try {
      out.done.push({ companyId, value: await run(item) });
    } catch (err) {
      out.failed.push({ companyId, error: message(err) });
      opts.onFailure?.(companyId, err);
    }
  }
  return out;
}

/**
 * The run's outcome for the job's JSON answer: which companies failed and
 * why, and how many waited for the next run. Named `failures`, not
 * `failed`: it is spread after a job's own counts, and Google Calendar
 * sync already reports a `failed` count of its own.
 */
export function runSummary(result: EachCompanyResult<unknown>) {
  return {
    failures: result.failed,
    deferred: result.deferred.length,
    paused: result.paused?.length ?? 0,
  };
}

/**
 * Splits a job's companies into those to run and those paused because
 * their subscription is locked (DECISIONS #131): a locked company gets
 * no reminders, alerts or syncs until it renews.
 */
export function withoutLocked<C>(
  items: readonly C[],
  companyOf: (item: C) => string,
  locked: ReadonlySet<string>
): { kept: C[]; paused: string[] } {
  const kept: C[] = [];
  const paused: string[] = [];
  for (const item of items) {
    if (locked.has(companyOf(item))) paused.push(companyOf(item));
    else kept.push(item);
  }
  return { kept, paused };
}

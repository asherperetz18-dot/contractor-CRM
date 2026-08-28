import "server-only";

/**
 * Reads every row of a query, not just the first page.
 *
 * PostgREST caps a select at the project's max-rows setting (1000 here)
 * and returns the truncated set with no error and no indication anything
 * is missing. That silence is the dangerous part: with 1501 leads, pages
 * were rendering 1000 of them and looking perfectly healthy -- contacts
 * vanished from lists, appointments couldn't resolve their customer, and
 * dashboard totals were understated by a third.
 *
 * Callers pass a builder that applies .range(), so filters and ordering
 * stay with the caller and only the paging lives here.
 *
 * Pages after the first are fetched concurrently. They were sequential,
 * and at 2,218 leads that meant three round trips one after another --
 * from the function region to the database region and back, each time,
 * on every page that reads the whole book. The rows do not depend on
 * each other, so waiting for page one before asking for page two bought
 * nothing but latency.
 */
const PAGE_SIZE = 1000;

/**
 * Do not raise PAGE_SIZE past the project's PostgREST max-rows (1000).
 * A larger value is silently capped server-side, and the short page that
 * comes back would read as "this is the last page" and end the loop --
 * truncating exactly the way this helper exists to prevent. Raising the
 * ceiling means raising max-rows first.
 */
const BATCH = 4;

const MAX_ROWS = 100000; // guardrail against an unbounded loop

export async function selectAll<T>(
  build: (from: number, to: number) => PromiseLike<{
    data: unknown[] | null;
    error: { message: string } | null;
  }>
): Promise<T[]> {
  // The first page alone, so the common case -- a table that fits under
  // the cap -- still costs exactly one round trip and issues no
  // speculative queries.
  const first = await build(0, PAGE_SIZE - 1);
  if (first.error) return [];
  const rows = (first.data ?? []) as T[];
  if (rows.length < PAGE_SIZE) return rows;

  for (let from = PAGE_SIZE; from < MAX_ROWS; from += BATCH * PAGE_SIZE) {
    const pages = await Promise.all(
      Array.from({ length: BATCH }, (_, i) => {
        const start = from + i * PAGE_SIZE;
        return build(start, start + PAGE_SIZE - 1);
      })
    );

    // Consumed in order, so the result keeps the caller's ordering. A
    // short page means the end of the data, and any later page in the
    // same batch is empty -- they were all read at the same instant, so
    // there is no gap between them for a row to appear in.
    let done = false;
    for (const { data, error } of pages) {
      if (error) {
        done = true;
        break;
      }
      const page = (data ?? []) as T[];
      rows.push(...page);
      if (page.length < PAGE_SIZE) {
        done = true;
        break;
      }
    }
    if (done) break;
  }

  return rows;
}

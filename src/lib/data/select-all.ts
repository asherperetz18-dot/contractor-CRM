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
 */
const PAGE_SIZE = 1000;
const MAX_ROWS = 100000; // guardrail against an unbounded loop

export async function selectAll<T>(
  build: (from: number, to: number) => PromiseLike<{
    data: unknown[] | null;
    error: { message: string } | null;
  }>
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  while (from < MAX_ROWS) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) break;
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

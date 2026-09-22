/**
 * The Approvals list's dropdown filters.
 *
 * Options come from the rows being filtered, never the roster: everyone
 * with a draft waiting is reachable (the same idea as `repOptionIds` on
 * the estimates funnel), and offering a name with nothing pending would
 * only ever filter to an empty list. The pending set is small -- a
 * handful of drafts, capped at 200 by the action -- so this runs in the
 * browser over rows the screen already holds.
 */
type FilterableApproval = {
  customer: string | null;
  writtenBy: string | null;
  total_cents: number | null;
};

export type ApprovalsSort = "newest" | "value_desc" | "value_asc";

export function approvalFilterOptions<T extends FilterableApproval>(rows: T[]): {
  customers: string[];
  writers: string[];
} {
  const customers = [...new Set(rows.map((r) => r.customer).filter(Boolean))] as string[];
  const writers = [...new Set(rows.map((r) => r.writtenBy).filter(Boolean))] as string[];
  customers.sort((a, b) => a.localeCompare(b));
  writers.sort((a, b) => a.localeCompare(b));
  return { customers, writers };
}

export function filterApprovals<T extends FilterableApproval>(
  rows: T[],
  filter: { customer: string; writtenBy: string; sort: ApprovalsSort }
): T[] {
  const kept = rows.filter(
    (r) =>
      (!filter.customer || r.customer === filter.customer) &&
      (!filter.writtenBy || r.writtenBy === filter.writtenBy)
  );
  if (filter.sort === "newest") return kept;

  // A draft with no price yet sorts last either way: on a list about
  // money, "unknown" is never the biggest or the smallest figure.
  const value = (r: FilterableApproval) => r.total_cents;
  return [...kept].sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return filter.sort === "value_desc" ? bv - av : av - bv;
  });
}

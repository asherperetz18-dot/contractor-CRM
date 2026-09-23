import type { FlowStatusKey } from "./estimate-flow-status";

/**
 * The Estimate Status board's filters. Options come from the rows on
 * screen, never the roster (the approvals list's rule): a closer or rep
 * with nothing in flight would only ever filter to an empty table, and
 * whoever has rows stays reachable whatever their role today.
 */
export type FilterableStatusRow = {
  flowKey: FlowStatusKey;
  customer: string;
  closerId: string | null;
  closerName: string | null;
  rep1Id: string | null;
  rep1Name: string | null;
  rep2Id: string | null;
  rep2Name: string | null;
};

export type EstimateStatusFilter = {
  /** A FlowStatusKey, or "" for all. */
  status: string;
  closer: string;
  /** Matches either rep seat. */
  rep: string;
  search: string;
};

export type PersonOption = { id: string; name: string };

function people(pairs: [string | null, string | null][]): PersonOption[] {
  const byId = new Map<string, string>();
  for (const [id, name] of pairs) {
    if (id && !byId.has(id)) byId.set(id, name || "Unnamed");
  }
  return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

export function estimateStatusFilterOptions<T extends FilterableStatusRow>(rows: T[]) {
  return {
    closers: people(rows.map((r) => [r.closerId, r.closerName])),
    reps: people(rows.flatMap((r) => [[r.rep1Id, r.rep1Name], [r.rep2Id, r.rep2Name]] as [string | null, string | null][])),
  };
}

export function filterEstimateStatusRows<T extends FilterableStatusRow>(
  rows: T[],
  f: EstimateStatusFilter
): T[] {
  const q = f.search.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (!f.status || r.flowKey === f.status) &&
      (!f.closer || r.closerId === f.closer) &&
      (!f.rep || r.rep1Id === f.rep || r.rep2Id === f.rep) &&
      (!q || r.customer.toLowerCase().includes(q))
  );
}

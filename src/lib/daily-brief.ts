import { countsAsLead } from "./lead-or-contact.ts";

export type BriefBreakdown = {
  topSources: { source: string; count: number }[];
  repActivity: { name: string; appts: number; calls: number }[];
};

/**
 * The Daily Brief's two lower tables -- where leads came from, and each
 * rep's appointments booked and calls -- over everything created since
 * `since`. Worked out once per period, so they follow the
 * Today / This Week / This Month chips like the numbers above them.
 */
export function briefBreakdown(
  rows: {
    leads: { created_at: string; source: string | null }[];
    events: { created_at: string; assigned_to: string | null }[];
    calls: { created_at: string; rep_id: string | null }[];
  },
  since: string,
  boughtKeys: string[],
  nameById: Map<string, string>
): BriefBreakdown {
  const sourceTally = new Map<string, number>();
  for (const l of rows.leads) {
    if (l.created_at < since || !countsAsLead(l.source, boughtKeys)) continue;
    const key = l.source as string;
    sourceTally.set(key, (sourceTally.get(key) ?? 0) + 1);
  }
  const topSources = [...sourceTally.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const repTally = new Map<string, { appts: number; calls: number }>();
  for (const e of rows.events) {
    if (e.created_at < since || !e.assigned_to) continue;
    const row = repTally.get(e.assigned_to) ?? { appts: 0, calls: 0 };
    row.appts += 1;
    repTally.set(e.assigned_to, row);
  }
  for (const c of rows.calls) {
    if (c.created_at < since || !c.rep_id) continue;
    const row = repTally.get(c.rep_id) ?? { appts: 0, calls: 0 };
    row.calls += 1;
    repTally.set(c.rep_id, row);
  }
  const repActivity = [...repTally.entries()]
    .map(([id, v]) => ({ name: nameById.get(id) ?? "Unknown", ...v }))
    .sort((a, b) => b.appts + b.calls - (a.appts + a.calls))
    .slice(0, 6);

  return { topSources, repActivity };
}

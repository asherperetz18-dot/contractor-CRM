/**
 * Per-lead call recency for the Power Dialer's already-called warning:
 * how many times a lead was called since a boundary (the rep's local
 * midnight, computed in the browser), and when the very last call was.
 * Pure so the boundary arithmetic is testable without a database.
 */

export type LeadCallInfo = { callsSince: number; lastAt: string | null };

export function summarizeLeadCalls(
  rows: { lead_id: string | null; created_at: string }[],
  sinceIso: string
): Map<string, LeadCallInfo> {
  const map = new Map<string, LeadCallInfo>();
  for (const r of rows) {
    if (!r.lead_id) continue;
    const info = map.get(r.lead_id) ?? { callsSince: 0, lastAt: null };
    if (r.created_at >= sinceIso) info.callsSince += 1;
    if (!info.lastAt || r.created_at > info.lastAt) info.lastAt = r.created_at;
    map.set(r.lead_id, info);
  }
  return map;
}

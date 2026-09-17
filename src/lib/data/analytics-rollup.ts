/**
 * The All Time marketing funnel, reduced to the rows the page renders.
 *
 * The windowed ranges fetch their slice of leads and let the view do
 * this same math client-side; All Time means every lead, and 79k rows
 * have no business in a browser. The database reduces them instead
 * (marketing_funnel_rollup, migration 0157), and this module is that
 * SQL's tested mirror: the buckets here are the contract the SQL must
 * honor, and buildAnalyticsRollup is the server-side fallback until
 * the migration has been run (same posture as rep_lead_stats/0156).
 *
 * Units are the view's own: value and lead_cost in dollars as stored
 * on leads, revenue in cents as summed from estimates.total_cents --
 * the two never mix, exactly as in the view's original client math.
 */

/** The slim lead the funnel math reads; matches actions' AnalyticsLead. */
export type RollupLead = {
  id: string;
  contact_type: string | null;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  source: string | null;
  stage: string;
  value: number | string | null;
  created_at: string;
  won_at: string | null;
  has_appt: boolean | null;
  assigned_to: string | null;
  lead_cost: number | string | null;
  phone: string | null;
};

export type RollupContract = {
  lead_id: string;
  status: string;
  kind: string | null;
  total_cents: number;
};

export type SourceRollup = {
  source: string;
  count: number;
  withAppt: number;
  spend: number;
  costKnown: number;
  sold: number;
  revenue: number;
};

export type RepRollup = {
  assigned_to: string;
  count: number;
  wonCount: number;
  wonValue: number;
};

export type StageRollup = { stage: string; count: number; value: number };

export type AnalyticsRollup = {
  totals: { created: number; createdValue: number; won: number; wonValue: number };
  bySource: SourceRollup[];
  byRep: RepRollup[];
  byStage: StageRollup[];
  recentWon: RollupLead[];
};

const num = (v: unknown) => Number(v) || 0;

export function buildAnalyticsRollup(
  leads: RollupLead[],
  contracts: RollupContract[]
): AnalyticsRollup {
  // Revenue is credited by signed contract, never by stage -- and change
  // orders are excluded by kind, same as the view's signedByLead map.
  const signedByLead = new Map<string, number>();
  for (const c of contracts) {
    if (c.status !== "Signed") continue;
    if ((c.kind ?? "contract") !== "contract") continue;
    signedByLead.set(c.lead_id, (signedByLead.get(c.lead_id) ?? 0) + (c.total_cents || 0));
  }

  // The Won stat cards and Recent Won need a won date; the per-rep rows
  // count by stage alone. That asymmetry is the view's own, kept.
  const won = leads.filter((l) => l.stage === "Won" && !!l.won_at);

  const bySource = new Map<string, SourceRollup>();
  const byRep = new Map<string, RepRollup>();
  const byStage = new Map<string, StageRollup>();
  for (const l of leads) {
    const source = l.source || "Unknown";
    const s =
      bySource.get(source) ??
      { source, count: 0, withAppt: 0, spend: 0, costKnown: 0, sold: 0, revenue: 0 };
    s.count += 1;
    if (l.has_appt) s.withAppt += 1;
    const cost = num(l.lead_cost);
    if (cost > 0) {
      s.spend += cost;
      s.costKnown += 1;
    }
    const signed = signedByLead.get(l.id) ?? 0;
    if (signed > 0) {
      s.sold += 1;
      s.revenue += signed;
    }
    bySource.set(source, s);

    if (l.assigned_to) {
      const r =
        byRep.get(l.assigned_to) ??
        { assigned_to: l.assigned_to, count: 0, wonCount: 0, wonValue: 0 };
      r.count += 1;
      if (l.stage === "Won") {
        r.wonCount += 1;
        r.wonValue += num(l.value);
      }
      byRep.set(l.assigned_to, r);
    }

    const st = byStage.get(l.stage) ?? { stage: l.stage, count: 0, value: 0 };
    st.count += 1;
    st.value += num(l.value);
    byStage.set(l.stage, st);
  }

  return {
    totals: {
      created: leads.length,
      createdValue: leads.reduce((s, l) => s + num(l.value), 0),
      won: won.length,
      wonValue: won.reduce((s, l) => s + num(l.value), 0),
    },
    bySource: [...bySource.values()].sort((a, b) => b.count - a.count),
    byRep: [...byRep.values()],
    byStage: [...byStage.values()],
    recentWon: [...won]
      .sort((a, b) => (b.won_at ?? "").localeCompare(a.won_at ?? ""))
      .slice(0, 8),
  };
}

/**
 * The RPC's jsonb, coerced field by field: aggregates can cross JSON as
 * strings, and one stringly "40" would silently concatenate its way
 * through the view's sums.
 */
export function coerceRollup(raw: unknown): AnalyticsRollup {
  const r = (raw ?? {}) as Record<string, unknown>;
  const totals = (r.totals ?? {}) as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    totals: {
      created: num(totals.created),
      createdValue: num(totals.createdValue),
      won: num(totals.won),
      wonValue: num(totals.wonValue),
    },
    bySource: arr(r.bySource).map((s: Record<string, unknown>) => ({
      source: String(s.source ?? "Unknown"),
      count: num(s.count),
      withAppt: num(s.withAppt),
      spend: num(s.spend),
      costKnown: num(s.costKnown),
      sold: num(s.sold),
      revenue: num(s.revenue),
    })),
    byRep: arr(r.byRep).map((x: Record<string, unknown>) => ({
      assigned_to: String(x.assigned_to ?? ""),
      count: num(x.count),
      wonCount: num(x.wonCount),
      wonValue: num(x.wonValue),
    })),
    byStage: arr(r.byStage).map((x: Record<string, unknown>) => ({
      stage: String(x.stage ?? ""),
      count: num(x.count),
      value: num(x.value),
    })),
    recentWon: arr(r.recentWon) as RollupLead[],
  };
}

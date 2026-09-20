import { isoDay, prevWindow, withinWindow, type DateWindow } from "./date-range.ts";
import { saleCredits, splitCents } from "./sale-credit.ts";

/**
 * Marketing Analytics, reduced to the numbers its tiles, tables and
 * charts render.
 *
 * The page used to ship a window's leads to the browser and let the
 * view do this math, with a separate served-aggregate path for All
 * Time. Now every range is served the same way: the database reduces
 * it in one call (marketing_analytics_rollup, migration 0164) and this
 * module is that SQL's tested mirror -- the contract the SQL must honor,
 * and the server-side fallback until the migration has run (the same
 * posture as dashboard_rollup/0162).
 *
 * The definitions, stated once:
 *
 *   * Money is a signed true contract (status 'Signed', kind
 *     'contract'); change orders and completions never count, and a
 *     lead's pipeline stage never makes revenue. "Won" by stage is
 *     reported beside it only so the gap between the two can be seen.
 *   * The tiles, sources, stages and latest contracts read the
 *     window's COHORT: leads created in it, whatever happened to them
 *     since. That is the marketing question -- what did this period's
 *     leads turn into.
 *   * The team rows follow the rep report: leads by cohort, but
 *     appointments, estimates and contracts DATED in the window. A
 *     signed contract is credited to its Sales team seats -- the
 *     office's own statement of who sold it (sale-credit.ts); until
 *     then a document follows whoever holds the lead.
 *   * The weekly strip is by date -- created day and signed day -- over
 *     twelve Monday-start weeks ending this week, independent of the
 *     range.
 *   * A source named in excludeSources (a bought list) disappears from
 *     every bucket at once, its leads' appointments and documents
 *     included.
 *
 * Units: value and lead_cost stay in the dollars the leads table
 * stores; every *Cents figure is integer cents from estimates. The two
 * never mix.
 */

export type MarketingBoundaries = {
  today: string;
  from: string | null;
  to: string | null;
  prevFrom: string | null;
  prevTo: string | null;
  /** Monday of the week eleven weeks before this week's Monday. */
  weeksFrom: string;
  /** The oldest day the fallback must fetch leads from; null is the whole book. */
  fetchFrom: string | null;
};

/** The Monday on or before a YYYY-MM-DD day (ISO weeks, as date_trunc('week')). */
export function mondayOf(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  const offset = (d.getDay() + 6) % 7;
  return isoDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset));
}

export function marketingBoundaries(win: DateWindow, now: Date = new Date()): MarketingBoundaries {
  const today = isoDay(now);
  const prev = prevWindow(win, now);
  const monday = new Date(`${mondayOf(today)}T00:00:00`);
  const weeksFrom = isoDay(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 77));
  const fetchFrom = win.from
    ? ([weeksFrom, win.from, prev?.from].filter(Boolean) as string[]).sort()[0]
    : null;
  return {
    today,
    from: win.from,
    to: win.to,
    prevFrom: prev?.from ?? null,
    prevTo: prev?.to ?? null,
    weeksFrom,
    fetchFrom,
  };
}

/** The slim lead the funnel math reads. */
export type MarketingLead = {
  id: string;
  contact_type: string | null;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  source: string | null;
  stage: string;
  value: number | string | null;
  has_appt: boolean | null;
  assigned_to: string | null;
  lead_cost: number | string | null;
  created_at: string;
  won_at: string | null;
};

/** The slim document: every status, every kind -- the builder filters. */
export type MarketingEstimate = {
  id: string;
  lead_id: string;
  status: string;
  kind: string | null;
  assigned_to: string | null;
  total_cents: number;
  sent_at: string | null;
  issued_at: string | null;
  created_at: string;
  signed_at: string | null;
  /** The Sales team seats (0086/0135/0163): who a signed contract is credited to. */
  sales_rep_1?: string | null;
  sales_rep_1_bp?: number | null;
  sales_rep_2?: string | null;
  sales_rep_2_bp?: number | null;
};

export type MarketingEvent = {
  assigned_to: string | null;
  status: string;
  date: string;
  lead_id: string | null;
};

export type MarketingRollupInputs = {
  boundaries: MarketingBoundaries;
  /** company_profile.default_lead_cost: the placeholder every new lead is stamped with. */
  defaultCost: number | null;
  /** A source's own default (lead_sources.default_lead_cost, 0166), keyed
   *  by the lowercased, trimmed source name; it stands in for the company
   *  default for that source's leads. */
  sourceDefaultCost?: Record<string, number>;
  /** Source names to drop everywhere (the company's bought lists, when the toggle is on). */
  excludeSources: string[];
  /** Every lead the buckets can touch: created since fetchFrom, plus the
   *  leads the window's documents and appointments reference. */
  leads: MarketingLead[];
  estimates: MarketingEstimate[];
  /** Appointments dated in the window (the builder re-checks the dates). */
  events: MarketingEvent[];
};

export type MarketingTotals = {
  leads: number;
  leadValue: number;
  withAppt: number;
  estimated: number;
  signed: number;
  signedCents: number;
  wonStage: number;
  wonStageValue: number;
  /** Leads at stage Won with no signed contract behind them. */
  wonNoContract: number;
  /** Dollars of lead_cost over the leads that carry one, and how many do. */
  spend: number;
  costKnown: number;
  /** Of the priced leads, how many carry exactly the company default. */
  atDefault: number;
};

export type SourceRow = {
  source: string;
  count: number;
  withAppt: number;
  estimated: number;
  signed: number;
  signedCents: number;
  spend: number;
  costKnown: number;
  atDefault: number;
};

export type RepRow = {
  rep: string;
  leads: number;
  appts: number;
  attended: number;
  noShow: number;
  noOutcome: number;
  estimates: number;
  signed: number;
  signedCents: number;
};

export type StageRow = { stage: string; count: number; value: number };

export type WeekRow = { week: string; leads: number; signed: number; signedCents: number };

export type RecentSigned = {
  estimateId: string;
  leadId: string;
  contact_type: string | null;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  source: string;
  rep: string | null;
  signedAt: string;
  totalCents: number;
  createdAt: string;
};

export type MarketingPrev = { leads: number; withAppt: number; signed: number; signedCents: number };

export type MarketingRollup = {
  totals: MarketingTotals;
  prev: MarketingPrev | null;
  bySource: SourceRow[];
  byRep: RepRow[];
  byStage: StageRow[];
  weeks: WeekRow[];
  recentSigned: RecentSigned[];
};

const num = (v: unknown) => Number(v) || 0;
const sourceOf = (l: { source: string | null }) => l.source || "Unknown";
const isContract = (e: { kind: string | null }) => (e.kind ?? "contract") === "contract";
/** Appointment statuses that are an outcome; anything else past its date is "no result". */
const RESOLVED = new Set(["Showed", "Won", "No-show", "Cancelled"]);
export const WEEKS_SHOWN = 12;

export function emptyMarketingRollup(): MarketingRollup {
  return {
    totals: {
      leads: 0,
      leadValue: 0,
      withAppt: 0,
      estimated: 0,
      signed: 0,
      signedCents: 0,
      wonStage: 0,
      wonStageValue: 0,
      wonNoContract: 0,
      spend: 0,
      costKnown: 0,
      atDefault: 0,
    },
    prev: null,
    bySource: [],
    byRep: [],
    byStage: [],
    weeks: [],
    recentSigned: [],
  };
}

export function buildMarketingRollup(inputs: MarketingRollupInputs): MarketingRollup {
  const { boundaries: B, defaultCost, leads, estimates, events } = inputs;
  const excluded = new Set(inputs.excludeSources);
  const win: DateWindow = { from: B.from, to: B.to };
  const prevWin: DateWindow | null = B.prevFrom ? { from: B.prevFrom, to: B.prevTo } : null;

  const leadById = new Map(leads.map((l) => [l.id, l]));
  const keep = (l: MarketingLead) => !excluded.has(sourceOf(l));
  // A document or appointment goes with its lead: an unknown lead is
  // kept, an excluded one takes its rows away.
  const leadOk = (leadId: string | null) => {
    if (!leadId) return true;
    const l = leadById.get(leadId);
    return !l || keep(l);
  };

  // A lead carrying exactly its default -- the source's own (0166) or the
  // company's -- was never priced by anyone.
  const sourceDefaults = inputs.sourceDefaultCost ?? {};
  const isDefaultCost = (l: MarketingLead, cost: number) => {
    const own = sourceDefaults[sourceOf(l).trim().toLowerCase()];
    const expected = own !== undefined ? own : defaultCost;
    return expected != null && cost === num(expected);
  };

  const cohort = leads.filter((l) => keep(l) && withinWindow(l.created_at, win));
  const prevCohort = prevWin ? leads.filter((l) => keep(l) && withinWindow(l.created_at, prevWin)) : [];

  // ── Contracts per lead: the one revenue rule ────────────────────
  const sawEstimate = new Set<string>();
  const signedByLead = new Map<string, number>();
  for (const e of estimates) {
    if (!isContract(e)) continue;
    if (e.status !== "Draft") sawEstimate.add(e.lead_id);
    if (e.status === "Signed")
      signedByLead.set(e.lead_id, (signedByLead.get(e.lead_id) ?? 0) + (e.total_cents || 0));
  }

  const totalsOf = (rows: MarketingLead[]): MarketingTotals => {
    const t = emptyMarketingRollup().totals;
    for (const l of rows) {
      t.leads += 1;
      t.leadValue += num(l.value);
      if (l.has_appt) t.withAppt += 1;
      if (sawEstimate.has(l.id)) t.estimated += 1;
      const sc = signedByLead.get(l.id) ?? 0;
      if (sc > 0) {
        t.signed += 1;
        t.signedCents += sc;
      }
      if (l.stage === "Won") {
        t.wonStage += 1;
        t.wonStageValue += num(l.value);
        if (!(sc > 0)) t.wonNoContract += 1;
      }
      const cost = num(l.lead_cost);
      if (cost > 0) {
        t.spend += cost;
        t.costKnown += 1;
        if (isDefaultCost(l, cost)) t.atDefault += 1;
      }
    }
    return t;
  };
  const totals = totalsOf(cohort);
  const p = prevWin ? totalsOf(prevCohort) : null;
  const prev: MarketingPrev | null = p
    ? { leads: p.leads, withAppt: p.withAppt, signed: p.signed, signedCents: p.signedCents }
    : null;

  // ── Sources: ranked by the decision they inform ─────────────────
  const bySourceMap = new Map<string, SourceRow>();
  for (const l of cohort) {
    const source = sourceOf(l);
    const s =
      bySourceMap.get(source) ??
      { source, count: 0, withAppt: 0, estimated: 0, signed: 0, signedCents: 0, spend: 0, costKnown: 0, atDefault: 0 };
    s.count += 1;
    if (l.has_appt) s.withAppt += 1;
    if (sawEstimate.has(l.id)) s.estimated += 1;
    const sc = signedByLead.get(l.id) ?? 0;
    if (sc > 0) {
      s.signed += 1;
      s.signedCents += sc;
    }
    const cost = num(l.lead_cost);
    if (cost > 0) {
      s.spend += cost;
      s.costKnown += 1;
      if (isDefaultCost(l, cost)) s.atDefault += 1;
    }
    bySourceMap.set(source, s);
  }
  const bySource = [...bySourceMap.values()].sort(
    (a, b) =>
      b.signedCents - a.signedCents ||
      b.signed - a.signed ||
      b.withAppt - a.withAppt ||
      b.count - a.count ||
      a.source.localeCompare(b.source)
  );

  // ── Team: the rep report's funnel, every rep in one pass ─────────
  const repMap = new Map<string, RepRow>();
  const rep = (id: string) => {
    const r =
      repMap.get(id) ??
      { rep: id, leads: 0, appts: 0, attended: 0, noShow: 0, noOutcome: 0, estimates: 0, signed: 0, signedCents: 0 };
    repMap.set(id, r);
    return r;
  };
  for (const l of cohort) if (l.assigned_to) rep(l.assigned_to).leads += 1;
  for (const ev of events) {
    if (!ev.assigned_to || !withinWindow(ev.date, win) || !leadOk(ev.lead_id)) continue;
    const r = rep(ev.assigned_to);
    r.appts += 1;
    if (ev.status === "Showed" || ev.status === "Won") r.attended += 1;
    if (ev.status === "No-show") r.noShow += 1;
    if (ev.date.slice(0, 10) < B.today && !RESOLVED.has(ev.status)) r.noOutcome += 1;
  }
  for (const e of estimates) {
    if (!isContract(e) || e.status === "Draft" || !leadOk(e.lead_id)) continue;
    // A signed contract counts for its Sales team seats (sale-credit.ts).
    // Until then the document follows whoever holds the lead; a voided
    // one stays with the rep it was stamped with (effectiveEstimateRepId).
    const credits = e.status === "Signed" ? saleCredits(e) : [];
    const holder = leadById.get(e.lead_id)?.assigned_to;
    const owners =
      e.status === "Signed"
        ? credits.map((c) => c.rep)
        : [(e.status !== "Void" && holder) || e.assigned_to].filter((x): x is string => !!x);
    const sentDay = e.sent_at ?? e.issued_at ?? e.created_at;
    if (withinWindow(sentDay, win)) for (const o of owners) rep(o).estimates += 1;
    if (e.status === "Signed" && e.signed_at && withinWindow(e.signed_at, win)) {
      for (const c of credits) {
        const r = rep(c.rep);
        r.signed += 1;
        r.signedCents += splitCents(e.total_cents, c.bp);
      }
    }
  }
  const byRep = [...repMap.values()].sort(
    (a, b) =>
      b.signedCents - a.signedCents ||
      b.signed - a.signed ||
      b.appts - a.appts ||
      b.leads - a.leads ||
      a.rep.localeCompare(b.rep)
  );

  // ── Stages: the cohort, every stage; the page orders them ────────
  const byStageMap = new Map<string, StageRow>();
  for (const l of cohort) {
    const s = byStageMap.get(l.stage) ?? { stage: l.stage, count: 0, value: 0 };
    s.count += 1;
    s.value += num(l.value);
    byStageMap.set(l.stage, s);
  }
  const byStage = [...byStageMap.values()].sort((a, b) => a.stage.localeCompare(b.stage));

  // ── Weeks: by date, twelve Monday buckets ────────────────────────
  const weekMap = new Map<string, WeekRow>();
  {
    const [y, m, d] = B.weeksFrom.split("-").map(Number);
    for (let i = 0; i < WEEKS_SHOWN; i++) {
      const week = isoDay(new Date(y, m - 1, d + 7 * i));
      weekMap.set(week, { week, leads: 0, signed: 0, signedCents: 0 });
    }
  }
  for (const l of leads) {
    if (!keep(l)) continue;
    const w = weekMap.get(mondayOf(l.created_at.slice(0, 10)));
    if (w) w.leads += 1;
  }
  for (const e of estimates) {
    if (!isContract(e) || e.status !== "Signed" || !e.signed_at || !leadOk(e.lead_id)) continue;
    const w = weekMap.get(mondayOf(e.signed_at.slice(0, 10)));
    if (w) {
      w.signed += 1;
      w.signedCents += e.total_cents || 0;
    }
  }

  // ── Latest contracts: the receipts behind the money tile ─────────
  const cohortIds = new Set(cohort.map((l) => l.id));
  const recentSigned: RecentSigned[] = estimates
    .filter((e) => isContract(e) && e.status === "Signed" && !!e.signed_at && cohortIds.has(e.lead_id))
    .map((e) => {
      const l = leadById.get(e.lead_id)!;
      return {
        estimateId: e.id,
        leadId: l.id,
        contact_type: l.contact_type,
        company_name: l.company_name,
        first_name: l.first_name,
        last_name: l.last_name,
        source: sourceOf(l),
        // The salesperson seat, as the panel names it.
        rep: saleCredits(e)[0]?.rep ?? e.assigned_to,
        signedAt: e.signed_at as string,
        totalCents: e.total_cents || 0,
        createdAt: l.created_at,
      };
    })
    .sort((a, b) => b.signedAt.localeCompare(a.signedAt))
    .slice(0, 8);

  return { totals, prev, bySource, byRep, byStage, weeks: [...weekMap.values()], recentSigned };
}

/**
 * The RPC's jsonb, coerced field by field: aggregates can cross JSON as
 * strings, and one stringly "40" would concatenate its way through
 * every sum in the view.
 */
export function coerceMarketingRollup(raw: unknown): MarketingRollup {
  const r = (raw ?? {}) as Record<string, unknown>;
  const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v : []);
  const str = (v: unknown, fallback = "") => (v == null ? fallback : String(v));
  const t = obj(r.totals);
  const p = r.prev == null ? null : obj(r.prev);
  return {
    totals: {
      leads: num(t.leads),
      leadValue: num(t.leadValue),
      withAppt: num(t.withAppt),
      estimated: num(t.estimated),
      signed: num(t.signed),
      signedCents: num(t.signedCents),
      wonStage: num(t.wonStage),
      wonStageValue: num(t.wonStageValue),
      wonNoContract: num(t.wonNoContract),
      spend: num(t.spend),
      costKnown: num(t.costKnown),
      atDefault: num(t.atDefault),
    },
    prev: p
      ? { leads: num(p.leads), withAppt: num(p.withAppt), signed: num(p.signed), signedCents: num(p.signedCents) }
      : null,
    bySource: arr(r.bySource).map((s) => ({
      source: str(s.source, "Unknown"),
      count: num(s.count),
      withAppt: num(s.withAppt),
      estimated: num(s.estimated),
      signed: num(s.signed),
      signedCents: num(s.signedCents),
      spend: num(s.spend),
      costKnown: num(s.costKnown),
      atDefault: num(s.atDefault),
    })),
    byRep: arr(r.byRep).map((x) => ({
      rep: str(x.rep),
      leads: num(x.leads),
      appts: num(x.appts),
      attended: num(x.attended),
      noShow: num(x.noShow),
      noOutcome: num(x.noOutcome),
      estimates: num(x.estimates),
      signed: num(x.signed),
      signedCents: num(x.signedCents),
    })),
    byStage: arr(r.byStage).map((x) => ({ stage: str(x.stage), count: num(x.count), value: num(x.value) })),
    weeks: arr(r.weeks).map((w) => ({
      week: str(w.week),
      leads: num(w.leads),
      signed: num(w.signed),
      signedCents: num(w.signedCents),
    })),
    recentSigned: arr(r.recentSigned).map((x) => ({
      estimateId: str(x.estimateId),
      leadId: str(x.leadId),
      contact_type: x.contact_type == null ? null : String(x.contact_type),
      company_name: x.company_name == null ? null : String(x.company_name),
      first_name: x.first_name == null ? null : String(x.first_name),
      last_name: x.last_name == null ? null : String(x.last_name),
      source: str(x.source, "Unknown"),
      rep: x.rep == null ? null : String(x.rep),
      signedAt: str(x.signedAt),
      totalCents: num(x.totalCents),
      createdAt: str(x.createdAt),
    })),
  };
}

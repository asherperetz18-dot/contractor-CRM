import { isoDay, prevWindow, withinWindow, type DateWindow } from "./date-range.ts";
import { phaseOwedCents, phaseState, type PortalPayment } from "./types.ts";
import { saleCredits, splitCents } from "./sale-credit.ts";

/**
 * The dashboard, reduced to the numbers its cards and graphs render.
 *
 * The old dashboard paged the entire open book through the server on
 * every load just to sum one headline figure. This module is the
 * replacement's contract: the database reduces everything in one call
 * (dashboard_rollup, migration 0162), and buildDashboardRollup is that
 * SQL's tested mirror -- and the server-side fallback until the
 * migration has run (same posture as marketing_funnel_rollup/0157).
 *
 * Every clock-dependent edge arrives precomputed in RollupBoundaries
 * and is passed to the SQL as parameters, so the two sides can never
 * disagree about "today", the window, or a cutoff.
 *
 * Units follow the app's split: signed / collected / owed figures are
 * integer cents (estimates.total_cents, portal_payments.amount_cents);
 * pipeline `value` stays in the dollars the leads table stores. The
 * two never mix.
 */

export type RollupBoundaries = {
  today: string;
  from: string | null;
  to: string | null;
  prevFrom: string | null;
  prevTo: string | null;
  /** First of the month, 11 months back: the 12-month chart's floor. */
  monthsFrom: string;
  d30: string;
  d60: string;
  d90: string;
  /** 13 days back: a 14-day dial strip including today. */
  callsFrom: string;
  /** Earliest date the fallback fetch must cover. */
  fetchFrom: string;
};

export function rollupBoundaries(win: DateWindow, now: Date = new Date()): RollupBoundaries {
  const prev = prevWindow(win, now);
  const daysBack = (n: number) =>
    isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n));
  const monthsFrom = isoDay(new Date(now.getFullYear(), now.getMonth() - 11, 1));
  const candidates = [monthsFrom, win.from, prev?.from].filter(Boolean) as string[];
  return {
    today: isoDay(now),
    from: win.from,
    to: win.to,
    prevFrom: prev?.from ?? null,
    prevTo: prev?.to ?? null,
    monthsFrom,
    d30: daysBack(30),
    d60: daysBack(60),
    d90: daysBack(90),
    callsFrom: daysBack(13),
    fetchFrom: candidates.sort()[0],
  };
}

export type DashboardWindowTotals = {
  leads: number;
  appts: number;
  signedCount: number;
  signedCents: number;
  collectedCents: number;
};

export type StageBucket = { count: number; value: number };

export type DashboardRollup = {
  attention: {
    overdueTasks: number;
    apptsToday: number;
    awaitingCount: number;
    awaitingCents: number;
    overdueOwedCents: number;
    overdueOwedCount: number;
  };
  window: DashboardWindowTotals;
  prev: DashboardWindowTotals;
  months: { month: string; signedCents: number; collectedCents: number }[];
  funnel: { leads: number; withAppt: number; estimated: number; signed: number };
  stages: { stage: string; buckets: Record<"d30" | "d60" | "d90" | "all", StageBucket> }[];
  sources: { source: string; count: number; signedCount: number; signedCents: number }[];
  aging: {
    notYetDueCents: number;
    late1_30Cents: number;
    late31_60Cents: number;
    late61PlusCents: number;
    overdueCount: number;
  };
  team: { rep: string; signedCount: number; signedCents: number; appts: number }[];
  calls: { dials: number; connected: number; talkSeconds: number; perDay: { day: string; dials: number }[] };
  production: { notStarted: number; inProgress: number; onHold: number; completedInWindow: number };
};

/** The rows the fallback fetches; the SQL reads the same tables. */
export type RollupInputs = {
  boundaries: RollupBoundaries;
  /** Leads created in the window (the funnel/source cohort). */
  leadsInWindow: {
    id: string;
    created_at: string;
    stage: string;
    value: number | string | null;
    has_appt: boolean | null;
    source: string | null;
    assigned_to: string | null;
  }[];
  prevLeadCount: number;
  /** Open-stage leads (not Won/Lost/DNC), for the stage panel. */
  openLeads: { stage: string; value: number | string | null; updated_at: string | null }[];
  /** Signed true contracts since fetchFrom (change orders excluded by the reader). */
  signedSinceMonths: {
    assigned_to: string | null;
    signed_at: string | null;
    total_cents: number;
    kind: string | null;
    status: string;
    /** The Sales team seats: who the sale is credited to (sale-credit.ts). */
    sales_rep_1?: string | null;
    sales_rep_1_bp?: number | null;
    sales_rep_2?: string | null;
    sales_rep_2_bp?: number | null;
  }[];
  /** Portal payments since fetchFrom (manual and Stripe alike). */
  paymentsSinceMonths: {
    amount_cents: number;
    status: string;
    paid_at: string | null;
    created_at: string;
  }[];
  /** Contracts belonging to the cohort's leads, any status. */
  estimatesForFunnel: { lead_id: string; status: string; kind: string | null; total_cents: number }[];
  /** Sent/Viewed true contracts: sitting with the customer, unsigned. */
  awaiting: { total_cents: number }[];
  /** Billed phases on currently-signed contracts. */
  billedPhases: {
    id: string;
    amount_cents: number;
    requested_at: string | null;
    due_date: string | null;
  }[];
  /** Payments attached to those phases. */
  phasePayments: { estimate_payment_id: string | null; status: string; amount_cents: number }[];
  eventsInWindow: { date: string; assigned_to: string | null }[];
  prevEventCount: number;
  apptsToday: number;
  overdueTasks: number;
  callsInWindow: { duration_seconds: number; created_at: string }[];
  callsRecent: { created_at: string }[];
  jobs: { status: string; end_date: string | null; updated_at: string | null }[];
};

const num = (v: unknown) => Number(v) || 0;

const CLOSED_STAGES = new Set(["Won", "Lost", "DNC"]);

/** Whole days from `from` to `to` (both YYYY-MM-DD), DST-proof. */
function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000
  );
}

/** True contract that was actually signed -- the app's "a sale" rule. */
const isSale = (e: { kind: string | null; status: string }) =>
  (e.kind ?? "contract") === "contract" && e.status === "Signed";

export function buildDashboardRollup(inputs: RollupInputs): DashboardRollup {
  const B = inputs.boundaries;
  const win: DateWindow = { from: B.from, to: B.to };
  const prev: DateWindow = { from: B.prevFrom, to: B.prevTo };

  // ── Signed / collected, window + previous + monthly ──────────────
  const monthKeys: string[] = [];
  {
    const [y, m] = B.monthsFrom.split("-").map(Number);
    for (let i = 0; i < 12; i++) {
      const d = new Date(y, m - 1 + i, 1);
      monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
  }
  const monthMap = new Map(
    monthKeys.map((month) => [month, { month, signedCents: 0, collectedCents: 0 }])
  );

  const sales = inputs.signedSinceMonths.filter(isSale);
  const signedCur = { count: 0, cents: 0 };
  const signedPrev = { count: 0, cents: 0 };
  for (const s of sales) {
    if (!s.signed_at) continue;
    const m = monthMap.get(s.signed_at.slice(0, 7));
    if (m) m.signedCents += s.total_cents || 0;
    if (withinWindow(s.signed_at, win)) {
      signedCur.count += 1;
      signedCur.cents += s.total_cents || 0;
    } else if (B.prevFrom && withinWindow(s.signed_at, prev)) {
      signedPrev.count += 1;
      signedPrev.cents += s.total_cents || 0;
    }
  }

  let collectedCur = 0;
  let collectedPrev = 0;
  for (const p of inputs.paymentsSinceMonths) {
    if (p.status !== "succeeded") continue;
    // A payment with no paid_at is dated by its record, same reading as
    // the Payments page's history table.
    const day = p.paid_at ?? p.created_at;
    const m = monthMap.get(day.slice(0, 7));
    if (m) m.collectedCents += p.amount_cents || 0;
    if (withinWindow(day, win)) collectedCur += p.amount_cents || 0;
    else if (B.prevFrom && withinWindow(day, prev)) collectedPrev += p.amount_cents || 0;
  }

  // ── Funnel + sources over the window's cohort ────────────────────
  const sawEstimate = new Set<string>();
  const signedByLead = new Map<string, number>();
  for (const e of inputs.estimatesForFunnel) {
    if ((e.kind ?? "contract") !== "contract") continue;
    if (e.status !== "Draft") sawEstimate.add(e.lead_id);
    if (e.status === "Signed")
      signedByLead.set(e.lead_id, (signedByLead.get(e.lead_id) ?? 0) + (e.total_cents || 0));
  }

  const funnel = { leads: 0, withAppt: 0, estimated: 0, signed: 0 };
  const bySource = new Map<
    string,
    { source: string; count: number; signedCount: number; signedCents: number }
  >();
  for (const l of inputs.leadsInWindow) {
    funnel.leads += 1;
    if (l.has_appt) funnel.withAppt += 1;
    if (sawEstimate.has(l.id)) funnel.estimated += 1;
    const signed = signedByLead.get(l.id) ?? 0;
    if (signed > 0) funnel.signed += 1;

    const source = l.source || "Unknown";
    const s = bySource.get(source) ?? { source, count: 0, signedCount: 0, signedCents: 0 };
    s.count += 1;
    if (signed > 0) {
      s.signedCount += 1;
      s.signedCents += signed;
    }
    bySource.set(source, s);
  }

  // ── Stage panel: open stages bucketed by last touch ──────────────
  const byStage = new Map<string, Record<"d30" | "d60" | "d90" | "all", StageBucket>>();
  for (const l of inputs.openLeads) {
    if (CLOSED_STAGES.has(l.stage)) continue;
    const buckets =
      byStage.get(l.stage) ??
      ({
        d30: { count: 0, value: 0 },
        d60: { count: 0, value: 0 },
        d90: { count: 0, value: 0 },
        all: { count: 0, value: 0 },
      } as Record<"d30" | "d60" | "d90" | "all", StageBucket>);
    const touched = (l.updated_at ?? "").slice(0, 10);
    const value = num(l.value);
    const add = (b: StageBucket) => {
      b.count += 1;
      b.value += value;
    };
    add(buckets.all);
    if (touched >= B.d90) add(buckets.d90);
    if (touched >= B.d60) add(buckets.d60);
    if (touched >= B.d30) add(buckets.d30);
    byStage.set(l.stage, buckets);
  }

  // ── Receivables aging: exactly the Payments page's phase math ────
  // Statuses arrive as plain strings off the wire; phaseState only ever
  // reads "succeeded"/"pending", so the narrowing cast is safe.
  const paymentsByPhase = new Map<string, Pick<PortalPayment, "status" | "amount_cents">[]>();
  for (const p of inputs.phasePayments) {
    if (!p.estimate_payment_id) continue;
    const list = paymentsByPhase.get(p.estimate_payment_id) ?? [];
    list.push(p as Pick<PortalPayment, "status" | "amount_cents">);
    paymentsByPhase.set(p.estimate_payment_id, list);
  }
  const aging = {
    notYetDueCents: 0,
    late1_30Cents: 0,
    late31_60Cents: 0,
    late61PlusCents: 0,
    overdueCount: 0,
  };
  let overdueOwedCents = 0;
  const todayNoon = new Date(`${B.today}T12:00:00`);
  for (const ph of inputs.billedPhases) {
    const on = paymentsByPhase.get(ph.id) ?? [];
    const owed = phaseOwedCents(ph, on);
    if (owed <= 0) continue;
    const state = phaseState(ph, on, todayNoon);
    if (state === "overdue") {
      aging.overdueCount += 1;
      overdueOwedCents += owed;
      const late = ph.due_date ? daysBetween(ph.due_date, B.today) : 0;
      if (late <= 30) aging.late1_30Cents += owed;
      else if (late <= 60) aging.late31_60Cents += owed;
      else aging.late61PlusCents += owed;
    } else {
      // billed, partial and clearing all wait here: money expected but
      // not late (clearing is the customer's money already in flight).
      aging.notYetDueCents += owed;
    }
  }

  // ── Team: signed dollars per rep + their window appointments ─────
  const teamMap = new Map<string, { rep: string; signedCount: number; signedCents: number; appts: number }>();
  const teamRow = (rep: string) => {
    const row = teamMap.get(rep) ?? { rep, signedCount: 0, signedCents: 0, appts: 0 };
    teamMap.set(rep, row);
    return row;
  };
  for (const s of sales) {
    if (!withinWindow(s.signed_at, win)) continue;
    // Credited to the contract's Sales team seats, dollars split by
    // share; a contract with no seats goes to the rep stamped on it.
    for (const c of saleCredits(s)) {
      const row = teamRow(c.rep);
      row.signedCount += 1;
      row.signedCents += splitCents(s.total_cents, c.bp);
    }
  }
  for (const e of inputs.eventsInWindow) {
    if (e.assigned_to) teamRow(e.assigned_to).appts += 1;
  }

  // ── Calls: window totals + a filled 14-day dial strip ────────────
  const perDayMap = new Map<string, number>();
  const callsStart = new Date(`${B.callsFrom}T12:00:00`);
  // Bounded hard: a bad boundary must never spin, and the strip is
  // only ever two weeks anyway.
  for (let i = 0; i < 60; i++) {
    const day = isoDay(
      new Date(callsStart.getFullYear(), callsStart.getMonth(), callsStart.getDate() + i)
    );
    perDayMap.set(day, 0);
    if (day >= B.today) break;
  }
  for (const c of inputs.callsRecent) {
    const day = c.created_at.slice(0, 10);
    if (perDayMap.has(day)) perDayMap.set(day, (perDayMap.get(day) ?? 0) + 1);
  }

  // ── Production ───────────────────────────────────────────────────
  const production = { notStarted: 0, inProgress: 0, onHold: 0, completedInWindow: 0 };
  for (const j of inputs.jobs) {
    if (j.status === "Not Started") production.notStarted += 1;
    else if (j.status === "In Progress") production.inProgress += 1;
    else if (j.status === "On Hold") production.onHold += 1;
    else if (j.status === "Complete" && withinWindow(j.end_date ?? j.updated_at, win))
      production.completedInWindow += 1;
  }

  return {
    attention: {
      overdueTasks: inputs.overdueTasks,
      apptsToday: inputs.apptsToday,
      awaitingCount: inputs.awaiting.length,
      awaitingCents: inputs.awaiting.reduce((s, e) => s + (e.total_cents || 0), 0),
      overdueOwedCents,
      overdueOwedCount: aging.overdueCount,
    },
    window: {
      leads: inputs.leadsInWindow.length,
      appts: inputs.eventsInWindow.length,
      signedCount: signedCur.count,
      signedCents: signedCur.cents,
      collectedCents: collectedCur,
    },
    prev: {
      leads: inputs.prevLeadCount,
      appts: inputs.prevEventCount,
      signedCount: signedPrev.count,
      signedCents: signedPrev.cents,
      collectedCents: collectedPrev,
    },
    months: monthKeys.map((k) => monthMap.get(k)!),
    funnel,
    stages: [...byStage.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([stage, buckets]) => ({ stage, buckets })),
    sources: [...bySource.values()].sort(
      (a, b) => b.count - a.count || a.source.localeCompare(b.source)
    ),
    aging,
    team: [...teamMap.values()].sort(
      (a, b) => b.signedCents - a.signedCents || b.appts - a.appts || a.rep.localeCompare(b.rep)
    ),
    calls: {
      dials: inputs.callsInWindow.length,
      connected: inputs.callsInWindow.filter((c) => (c.duration_seconds || 0) > 0).length,
      talkSeconds: inputs.callsInWindow.reduce((s, c) => s + (c.duration_seconds || 0), 0),
      perDay: [...perDayMap.entries()].map(([day, dials]) => ({ day, dials })),
    },
    production,
  };
}

/** One win rate: signed contracts out of `of`; no rate while `of` is 0. */
export type WinRate = { rate: number | null; signed: number; of: number };

/**
 * The Win rate card's two rates, read straight off the rollup: signed
 * contracts out of the period's leads, and out of the ones that got an
 * appointment (the funnel's has_appt step). Same cohort and the same
 * signed count on both, so "from appointments" is always the higher of
 * the two -- of the leads we got in front of, this many closed. The
 * period's appointment *count* is deliberately not the denominator: it
 * dates appointments, not leads, and one lead can hold several.
 */
export function winRates(r: DashboardRollup): { fromLeads: WinRate; fromAppts: WinRate } {
  const signed = r.funnel.signed;
  const rate = (of: number): WinRate => ({ rate: of > 0 ? (signed / of) * 100 : null, signed, of });
  return { fromLeads: rate(r.window.leads), fromAppts: rate(r.funnel.withAppt) };
}

/**
 * The RPC's jsonb, coerced field by field: aggregates can cross JSON as
 * strings, and one stringly "40" would silently concatenate its way
 * through every sum the view makes.
 */
export function coerceDashboardRollup(raw: unknown): DashboardRollup {
  const r = (raw ?? {}) as Record<string, unknown>;
  const obj = (v: unknown) => (v ?? {}) as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const totals = (v: unknown): DashboardWindowTotals => {
    const t = obj(v);
    return {
      leads: num(t.leads),
      appts: num(t.appts),
      signedCount: num(t.signedCount),
      signedCents: num(t.signedCents),
      collectedCents: num(t.collectedCents),
    };
  };
  const bucket = (v: unknown): StageBucket => {
    const b = obj(v);
    return { count: num(b.count), value: num(b.value) };
  };
  const attention = obj(r.attention);
  const funnel = obj(r.funnel);
  const aging = obj(r.aging);
  const calls = obj(r.calls);
  const production = obj(r.production);
  return {
    attention: {
      overdueTasks: num(attention.overdueTasks),
      apptsToday: num(attention.apptsToday),
      awaitingCount: num(attention.awaitingCount),
      awaitingCents: num(attention.awaitingCents),
      overdueOwedCents: num(attention.overdueOwedCents),
      overdueOwedCount: num(attention.overdueOwedCount),
    },
    window: totals(r.window),
    prev: totals(r.prev),
    months: arr(r.months).map((m: Record<string, unknown>) => ({
      month: String(m.month ?? ""),
      signedCents: num(m.signedCents),
      collectedCents: num(m.collectedCents),
    })),
    funnel: {
      leads: num(funnel.leads),
      withAppt: num(funnel.withAppt),
      estimated: num(funnel.estimated),
      signed: num(funnel.signed),
    },
    stages: arr(r.stages).map((s: Record<string, unknown>) => {
      const b = obj(s.buckets);
      return {
        stage: String(s.stage ?? ""),
        buckets: { d30: bucket(b.d30), d60: bucket(b.d60), d90: bucket(b.d90), all: bucket(b.all) },
      };
    }),
    sources: arr(r.sources).map((s: Record<string, unknown>) => ({
      source: String(s.source ?? "Unknown"),
      count: num(s.count),
      signedCount: num(s.signedCount),
      signedCents: num(s.signedCents),
    })),
    aging: {
      notYetDueCents: num(aging.notYetDueCents),
      late1_30Cents: num(aging.late1_30Cents),
      late31_60Cents: num(aging.late31_60Cents),
      late61PlusCents: num(aging.late61PlusCents),
      overdueCount: num(aging.overdueCount),
    },
    team: arr(r.team).map((t: Record<string, unknown>) => ({
      rep: String(t.rep ?? ""),
      signedCount: num(t.signedCount),
      signedCents: num(t.signedCents),
      appts: num(t.appts),
    })),
    calls: {
      dials: num(calls.dials),
      connected: num(calls.connected),
      talkSeconds: num(calls.talkSeconds),
      perDay: arr(calls.perDay).map((d: Record<string, unknown>) => ({
        day: String(d.day ?? ""),
        dials: num(d.dials),
      })),
    },
    production: {
      notStarted: num(production.notStarted),
      inProgress: num(production.inProgress),
      onHold: num(production.onHold),
      completedInWindow: num(production.completedInWindow),
    },
  };
}

export function emptyDashboardRollup(): DashboardRollup {
  return coerceDashboardRollup({});
}

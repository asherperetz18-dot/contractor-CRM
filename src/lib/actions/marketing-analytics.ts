"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { selectAll } from "@/lib/data/select-all";
import type { DateWindow } from "@/lib/data/date-range";
import {
  buildMarketingRollup,
  coerceMarketingRollup,
  emptyMarketingRollup,
  marketingBoundaries,
  type MarketingBoundaries,
  type MarketingEstimate,
  type MarketingEvent,
  type MarketingLead,
  type MarketingRollup,
} from "@/lib/data/marketing-rollup";
import { spendInWindow, type SpendRow } from "@/lib/data/marketing-spend";
import type { Lead } from "@/lib/data/types";
import type { SupabaseClient } from "@supabase/supabase-js";

/** The lead fields the drill-down lists read -- never the 40-column row. */
export type AnalyticsLead = Pick<
  Lead,
  | "id"
  | "contact_type"
  | "company_name"
  | "first_name"
  | "last_name"
  | "source"
  | "stage"
  | "value"
  | "created_at"
  | "won_at"
  | "has_appt"
  | "assigned_to"
  | "lead_cost"
  | "phone"
>;

const FIELDS =
  "id, contact_type, company_name, first_name, last_name, source, stage, value, created_at, won_at, has_appt, assigned_to, lead_cost, phone";

/** The day after, in UTC -- the exclusive upper bound for timestamptz
 *  columns, so "to Sep 20" keeps everything stamped during Sep 20. */
function nextDay(day: string): string {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
}

/**
 * The leads created in a window -- one rep's, for the team drill-down.
 * Runs as the signed-in user, so RLS scopes it exactly as the page's own
 * numbers are scoped. Never the whole book: the window is the query.
 */
export async function getAnalyticsLeads(win: DateWindow, repId?: string): Promise<AnalyticsLead[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];

  const supabase = await createClient();
  return selectAll<AnalyticsLead>((f, t) => {
    let q = supabase
      .from("leads")
      .select(FIELDS)
      .eq("company_id", profile.company_id)
      .order("created_at", { ascending: false })
      .range(f, t);
    if (repId) q = q.eq("assigned_to", repId);
    if (win.from) q = q.gte("created_at", win.from);
    if (win.to) q = q.lt("created_at", nextDay(win.to));
    return q;
  });
}

export type MarketingOptions = {
  /** Drop the sources flagged as bought lists from every number. */
  excludeBoughtLists: boolean;
};

export type MarketingAnalytics = {
  rollup: MarketingRollup;
  /** Cents of entered spend the window claims, by source; empty until spend is entered. */
  spendBySource: Record<string, number>;
  spendTotalCents: number;
  /** Sources flagged as bought lists in Settings > Lead sources. */
  boughtListSources: string[];
  /** company_profile.default_lead_cost -- the placeholder on every new lead. */
  defaultCost: number | null;
  boundaries: MarketingBoundaries;
};

/** Both reads tolerate migration 0165 not having run: an error is "none yet". */
async function boughtListSources(supabase: SupabaseClient, companyId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("lead_sources")
    .select("name")
    .eq("company_id", companyId)
    .eq("bought_list", true);
  if (error) return [];
  return ((data ?? []) as { name: string }[]).map((r) => r.name);
}

async function spendRows(supabase: SupabaseClient, companyId: string): Promise<SpendRow[]> {
  const { data, error } = await supabase
    .from("marketing_spend")
    .select("source, month, amount_cents")
    .eq("company_id", companyId);
  if (error) return [];
  return (data ?? []) as SpendRow[];
}

/**
 * Every number Marketing Analytics renders, for one date window.
 *
 * Served by marketing_analytics_rollup (migration 0164): one call,
 * reduced in the database. Until that migration has run the function is
 * missing and this falls back to windowed queries reduced by the same
 * tested builder -- slower, identical numbers, and the browser never
 * sees raw rows either way. Spend and the bought-list flags (0165) ride
 * alongside; without that migration they read as empty.
 */
export async function getMarketingAnalytics(
  win: DateWindow,
  opts: MarketingOptions
): Promise<MarketingAnalytics> {
  const profile = await getCurrentProfile();
  const B = marketingBoundaries(win);
  if (!profile) {
    return {
      rollup: emptyMarketingRollup(),
      spendBySource: {},
      spendTotalCents: 0,
      boughtListSources: [],
      defaultCost: null,
      boundaries: B,
    };
  }

  const supabase = await createClient();
  const companyId = profile.company_id;

  const [{ data: company }, bought, spend] = await Promise.all([
    supabase
      .from("company_profile")
      .select("default_lead_cost")
      .eq("company_id", companyId)
      .maybeSingle<{ default_lead_cost: number | string | null }>(),
    boughtListSources(supabase, companyId),
    spendRows(supabase, companyId),
  ]);
  const defaultCost =
    company?.default_lead_cost == null ? null : Number(company.default_lead_cost) || null;
  const excludeSources = opts.excludeBoughtLists ? bought : [];
  const excluded = new Set(excludeSources);
  const spendBySource = spendInWindow(
    spend.filter((r) => !excluded.has(r.source)),
    win,
    B.today
  );
  const base = {
    spendBySource,
    spendTotalCents: Object.values(spendBySource).reduce((s, v) => s + v, 0),
    boughtListSources: bought,
    defaultCost,
    boundaries: B,
  };

  const { data, error } = await supabase.rpc("marketing_analytics_rollup", {
    p_company: companyId,
    p_from: B.from,
    p_to: B.to,
    p_prev_from: B.prevFrom,
    p_prev_to: B.prevTo,
    p_weeks_from: B.weeksFrom,
    p_today: B.today,
    p_default_cost: defaultCost,
    p_exclude_sources: excludeSources,
  });
  if (!error && data) return { rollup: coerceMarketingRollup(data), ...base };

  // ── Fallback: the same buckets from windowed queries ─────────────
  const LEAD =
    "id, contact_type, company_name, first_name, last_name, phone, source, stage, value, has_appt, assigned_to, lead_cost, created_at, won_at";
  const [leads, estimates, events] = await Promise.all([
    // From the oldest edge any bucket needs (the 12-week strip, the
    // previous period, the window). All Time is the one deliberately
    // expensive read -- see TECH_DEBT.
    selectAll<MarketingLead>((f, t) => {
      let q = supabase
        .from("leads")
        .select(LEAD)
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .range(f, t);
      if (B.fetchFrom) q = q.gte("created_at", B.fetchFrom);
      return q;
    }),
    selectAll<MarketingEstimate>((f, t) =>
      supabase
        .from("estimates")
        .select("id, lead_id, status, kind, assigned_to, total_cents, sent_at, issued_at, created_at, signed_at")
        .eq("company_id", companyId)
        .range(f, t)
    ),
    selectAll<MarketingEvent>((f, t) => {
      let q = supabase
        .from("events")
        .select("assigned_to, status, date, lead_id")
        .eq("company_id", companyId)
        .range(f, t);
      if (B.from) q = q.gte("date", B.from);
      if (B.to) q = q.lte("date", B.to);
      return q;
    }),
  ]);
  // A document's or appointment's lead decides its source and holder.
  // The ones the windowed slice didn't carry are fetched by id, never
  // by scanning the book (DECISIONS #021).
  const have = new Set(leads.map((l) => l.id));
  const missing = [
    ...new Set(
      [...estimates.map((e) => e.lead_id), ...events.map((e) => e.lead_id)].filter(
        (id): id is string => !!id && !have.has(id)
      )
    ),
  ];
  for (let i = 0; i < missing.length; i += 200) {
    const { data: more } = await supabase
      .from("leads")
      .select(LEAD)
      .eq("company_id", companyId)
      .in("id", missing.slice(i, i + 200));
    leads.push(...((more ?? []) as MarketingLead[]));
  }

  const rollup = buildMarketingRollup({
    boundaries: B,
    defaultCost,
    excludeSources,
    leads,
    estimates,
    events,
  });
  return { rollup, ...base };
}

/**
 * The window's leads sitting at stage Won with no signed true contract
 * behind them: a stage somebody set by hand, or a contract never
 * entered. The page shows the count on the win-rate tile and opens this
 * list from it, so the gap becomes a to-do rather than two totals that
 * quietly disagree.
 */
export async function getWonWithoutContract(
  win: DateWindow,
  opts: MarketingOptions
): Promise<AnalyticsLead[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];

  const supabase = await createClient();
  const companyId = profile.company_id;
  let rows = await selectAll<AnalyticsLead>((f, t) => {
    let q = supabase
      .from("leads")
      .select(FIELDS)
      .eq("company_id", companyId)
      .eq("stage", "Won")
      .order("created_at", { ascending: false })
      .range(f, t);
    if (win.from) q = q.gte("created_at", win.from);
    if (win.to) q = q.lt("created_at", nextDay(win.to));
    return q;
  });
  if (opts.excludeBoughtLists) {
    const excluded = new Set(await boughtListSources(supabase, companyId));
    rows = rows.filter((l) => !excluded.has(l.source || "Unknown"));
  }

  const signed = new Set<string>();
  const ids = rows.map((l) => l.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase
      .from("estimates")
      .select("lead_id, kind")
      .eq("company_id", companyId)
      .eq("status", "Signed")
      .in("lead_id", ids.slice(i, i + 200));
    for (const e of (data ?? []) as { lead_id: string; kind: string | null }[]) {
      if ((e.kind ?? "contract") === "contract") signed.add(e.lead_id);
    }
  }
  return rows.filter((l) => !signed.has(l.id));
}

"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { selectAll } from "@/lib/data/select-all";
import { analyticsWindowOrFilter } from "@/lib/data/analytics-window";
import {
  buildAnalyticsRollup,
  coerceRollup,
  type AnalyticsRollup,
  type RollupContract,
} from "@/lib/data/analytics-rollup";
import type { DateWindow } from "@/lib/data/date-range";
import type { Lead } from "@/lib/data/types";

/** The lead fields the funnel/source math reads -- this page never
 *  fetches the 40-column row. */
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

/**
 * The leads one reporting window can use: created in it, or won in it.
 *
 * Marketing Analytics used to ship every lead in the company to the
 * browser and window it there -- fourteen columns times 79k rows to
 * draw a 30-day funnel. Now the window is the query, and changing the
 * range asks again. All Time still means everything; that is the one
 * deliberately expensive click (TECH_DEBT). Runs as the signed-in
 * user, so RLS scopes it exactly as the page's own fetch did.
 */
export async function getAnalyticsLeads(
  win: DateWindow,
  /** One rep's leads only -- the All Time drill-down, which serves
   *  aggregates page-wide and fetches a rep's rows on expand. */
  repId?: string
): Promise<AnalyticsLead[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];

  const supabase = await createClient();
  const filter = analyticsWindowOrFilter(win);
  return selectAll<AnalyticsLead>((f, t) => {
    let q = supabase
      .from("leads")
      .select(FIELDS)
      .eq("company_id", profile.company_id)
      .order("created_at", { ascending: false })
      .range(f, t);
    if (repId) q = q.eq("assigned_to", repId);
    if (filter) q = q.or(filter);
    return q;
  });
}

/**
 * The All Time funnel as served aggregates (marketing_funnel_rollup,
 * 0157): one row per source/rep/stage plus totals and the 8 newest
 * wins, instead of every lead in the book. Until that migration has
 * run, the function is missing and this falls back to reducing a full
 * scan server-side with the same tested builder -- slower, identical
 * numbers, and the browser never sees the 79k rows either way.
 */
export async function getAnalyticsRollup(): Promise<AnalyticsRollup> {
  const empty: AnalyticsRollup = {
    totals: { created: 0, createdValue: 0, won: 0, wonValue: 0 },
    bySource: [],
    byRep: [],
    byStage: [],
    recentWon: [],
  };
  const profile = await getCurrentProfile();
  if (!profile) return empty;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("marketing_funnel_rollup", {
    p_company: profile.company_id,
  });
  if (!error && data) return coerceRollup(data);

  const [leads, contracts] = await Promise.all([
    getAnalyticsLeads({ from: null, to: null }),
    selectAll<RollupContract>((f, t) =>
      supabase
        .from("estimates")
        .select("lead_id, status, kind, total_cents")
        .eq("company_id", profile.company_id)
        .eq("status", "Signed")
        .range(f, t)
    ),
  ]);
  return buildAnalyticsRollup(leads, contracts);
}

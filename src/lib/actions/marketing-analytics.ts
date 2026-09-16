"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { selectAll } from "@/lib/data/select-all";
import { analyticsWindowOrFilter } from "@/lib/data/analytics-window";
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
export async function getAnalyticsLeads(win: DateWindow): Promise<AnalyticsLead[]> {
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
    if (filter) q = q.or(filter);
    return q;
  });
}

"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { selectAll } from "@/lib/data/select-all";
import type { DateWindow } from "@/lib/data/date-range";
import {
  buildDashboardRollup,
  coerceDashboardRollup,
  emptyDashboardRollup,
  rollupBoundaries,
  type DashboardRollup,
  type RollupInputs,
} from "@/lib/data/dashboard-rollup";
import { mergePanelOrder } from "@/lib/data/dashboard-layout";

/** The day after, in UTC -- the exclusive upper bound for timestamptz
 *  columns, so "to Sep 20" keeps everything stamped during Sep 20. */
function nextDay(day: string): string {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
}

/**
 * Every number the dashboard renders, for one date window.
 *
 * Served by dashboard_rollup (migration 0161): one call, reduced in the
 * database. Until that migration has run the function is missing and
 * this falls back to targeted windowed queries reduced by the same
 * tested builder -- slower, identical numbers, and the browser never
 * sees raw rows either way. Runs as the signed-in user, so RLS scopes
 * every read exactly as the page's own fetches would.
 */
export async function getDashboardRollup(win: DateWindow): Promise<DashboardRollup> {
  const profile = await getCurrentProfile();
  if (!profile) return emptyDashboardRollup();

  const supabase = await createClient();
  const B = rollupBoundaries(win);

  const { data, error } = await supabase.rpc("dashboard_rollup", {
    p_company: profile.company_id,
    p_from: B.from,
    p_to: B.to,
    p_prev_from: B.prevFrom,
    p_prev_to: B.prevTo,
    p_months_from: B.monthsFrom,
    p_today: B.today,
    p_d30: B.d30,
    p_d60: B.d60,
    p_d90: B.d90,
    p_calls_from: B.callsFrom,
  });
  if (!error && data) return coerceDashboardRollup(data);

  // ── Fallback: the same buckets from targeted queries ─────────────
  const companyId = profile.company_id;
  // The cohort never runs unbounded: with no window start (which the
  // dashboard's presets never produce) it caps at the month series.
  const cohortFrom = B.from ?? B.monthsFrom;

  const [
    leadsInWindow,
    prevLeads,
    openLeads,
    signedSinceMonths,
    paymentsSinceMonths,
    awaiting,
    signedIds,
    allBilledPhases,
    phasePayments,
    eventsInWindow,
    prevEvents,
    todayEvents,
    overdueTasks,
    callsInWindow,
    callsRecent,
    jobs,
  ] = await Promise.all([
    selectAll<RollupInputs["leadsInWindow"][number]>((f, t) => {
      let q = supabase
        .from("leads")
        .select("id, created_at, stage, value, has_appt, source, assigned_to")
        .eq("company_id", companyId)
        .gte("created_at", cohortFrom)
        .range(f, t);
      if (B.to) q = q.lt("created_at", nextDay(B.to));
      return q;
    }),
    B.prevFrom
      ? supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .gte("created_at", B.prevFrom)
          .lt("created_at", nextDay(B.prevTo!))
      : Promise.resolve({ count: 0 }),
    // The one deliberately expensive fallback read: the stage panel
    // needs every open-stage lead. The RPC replaces this scan -- see
    // TECH_DEBT.
    selectAll<RollupInputs["openLeads"][number]>((f, t) =>
      supabase
        .from("leads")
        .select("stage, value, updated_at")
        .eq("company_id", companyId)
        .not("stage", "in", "(Won,Lost,DNC)")
        .range(f, t)
    ),
    selectAll<RollupInputs["signedSinceMonths"][number]>((f, t) =>
      supabase
        .from("estimates")
        .select("assigned_to, signed_at, total_cents, kind, status")
        .eq("company_id", companyId)
        .eq("status", "Signed")
        .gte("signed_at", B.fetchFrom)
        .range(f, t)
    ),
    selectAll<RollupInputs["paymentsSinceMonths"][number]>((f, t) =>
      supabase
        .from("portal_payments")
        .select("amount_cents, status, paid_at, created_at")
        .eq("company_id", companyId)
        .eq("status", "succeeded")
        .gte("created_at", B.fetchFrom)
        .range(f, t)
    ),
    selectAll<RollupInputs["awaiting"][number]>((f, t) =>
      supabase
        .from("estimates")
        .select("total_cents")
        .eq("company_id", companyId)
        .in("status", ["Sent", "Viewed"])
        .eq("kind", "contract")
        .range(f, t)
    ),
    // Billed phases only count on a live signed contract, so the ids
    // (and nothing else) of every signed estimate come along.
    selectAll<{ id: string }>((f, t) =>
      supabase
        .from("estimates")
        .select("id")
        .eq("company_id", companyId)
        .eq("status", "Signed")
        .range(f, t)
    ),
    selectAll<RollupInputs["billedPhases"][number] & { estimate_id: string }>((f, t) =>
      supabase
        .from("estimate_payments")
        .select("id, estimate_id, amount_cents, requested_at, due_date")
        .eq("company_id", companyId)
        .not("requested_at", "is", null)
        .range(f, t)
    ),
    selectAll<RollupInputs["phasePayments"][number]>((f, t) =>
      supabase
        .from("portal_payments")
        .select("estimate_payment_id, status, amount_cents")
        .eq("company_id", companyId)
        .not("estimate_payment_id", "is", null)
        .range(f, t)
    ),
    selectAll<RollupInputs["eventsInWindow"][number]>((f, t) => {
      let q = supabase
        .from("events")
        .select("date, assigned_to")
        .eq("company_id", companyId)
        .range(f, t);
      if (B.from) q = q.gte("date", B.from);
      if (B.to) q = q.lte("date", B.to);
      return q;
    }),
    B.prevFrom
      ? supabase
          .from("events")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .gte("date", B.prevFrom)
          .lte("date", B.prevTo!)
      : Promise.resolve({ count: 0 }),
    supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("date", B.today),
    supabase
      .from("lead_tasks")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .is("completed_at", null)
      .lt("due_date", B.today),
    selectAll<RollupInputs["callsInWindow"][number]>((f, t) => {
      let q = supabase
        .from("call_logs")
        .select("duration_seconds, created_at")
        .eq("company_id", companyId)
        .range(f, t);
      if (B.from) q = q.gte("created_at", B.from);
      if (B.to) q = q.lt("created_at", nextDay(B.to));
      return q;
    }),
    selectAll<RollupInputs["callsRecent"][number]>((f, t) =>
      supabase
        .from("call_logs")
        .select("created_at")
        .eq("company_id", companyId)
        .gte("created_at", B.callsFrom)
        .range(f, t)
    ),
    selectAll<RollupInputs["jobs"][number]>((f, t) =>
      supabase
        .from("jobs")
        .select("status, end_date, updated_at")
        .eq("company_id", companyId)
        .range(f, t)
    ),
  ]);

  // The cohort's contracts, fetched by lead id in slices -- a window
  // holds hundreds of leads, not the 79k book.
  const cohortIds = leadsInWindow.map((l) => l.id);
  const estimatesForFunnel: RollupInputs["estimatesForFunnel"] = [];
  for (let i = 0; i < cohortIds.length; i += 200) {
    const { data: slice } = await supabase
      .from("estimates")
      .select("lead_id, status, kind, total_cents")
      .eq("company_id", companyId)
      .in("lead_id", cohortIds.slice(i, i + 200));
    estimatesForFunnel.push(...((slice ?? []) as RollupInputs["estimatesForFunnel"]));
  }

  const signedIdSet = new Set(signedIds.map((e) => e.id));

  return buildDashboardRollup({
    boundaries: B,
    leadsInWindow,
    prevLeadCount: prevLeads.count ?? 0,
    openLeads,
    signedSinceMonths,
    paymentsSinceMonths,
    estimatesForFunnel,
    awaiting,
    billedPhases: allBilledPhases.filter((ph) => signedIdSet.has(ph.estimate_id)),
    phasePayments,
    eventsInWindow,
    prevEventCount: prevEvents.count ?? 0,
    apptsToday: todayEvents.count ?? 0,
    overdueTasks: overdueTasks.count ?? 0,
    callsInWindow,
    callsRecent,
    jobs,
  });
}

/**
 * Saves the dragged order of the dashboard's boxes on the person's
 * profile, so the arrangement follows the login instead of one
 * browser's localStorage. Own row only, enforced by the
 * profiles_update_self policy as well as the id filter here -- the
 * same contract as saveFunnelOrder.
 */
export async function saveDashboardPanelOrder(order: string[]): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };

  // Whatever the client sent, what is stored is exactly the known panel
  // keys: junk dropped, missing ones restored to their default spot.
  const clean = mergePanelOrder(Array.isArray(order) ? order : []);

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ dashboard_panel_order: clean })
    .eq("id", profile.id);
  return error ? { error: "The layout couldn't be saved." } : {};
}

"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { selectAll } from "@/lib/data/select-all";
import type { DateWindow } from "@/lib/data/date-range";
import { companyNow } from "@/lib/data/company-today";
import {
  buildDispatchRollup,
  coerceDispatchRollup,
  dispatchBoundaries,
  emptyDispatchRollup,
  WAITING_STAGES,
  type DispatchInputs,
  type DispatchRollup,
  type TodayVisit,
} from "@/lib/data/dispatch-rollup";

/** The day after, in UTC -- the exclusive upper bound for timestamptz
 *  columns, so "to Sep 20" keeps everything stamped during Sep 20. */
function nextDay(day: string): string {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
}

type CohortRow = DispatchInputs["cohort"][number];

/**
 * Every number the Dispatch Dashboard renders, for one date window.
 *
 * Served by dispatch_rollup (migration 0171): one call, reduced in the
 * database. Until that migration has run the function is missing and
 * this falls back to targeted windowed queries reduced by the same
 * tested builder -- slower, identical numbers. Runs as the signed-in
 * user, so RLS scopes every read: a dispatcher who is not a supervisor
 * gets their own leads and the unclaimed pool, nothing more.
 */
export async function getDispatchRollup(win: DateWindow): Promise<DispatchRollup> {
  const profile = await getCurrentProfile();
  if (!profile) return emptyDispatchRollup();

  const supabase = await createClient();
  // The office's calendar for "today"; the real instant for ages.
  const now = await companyNow();
  const B = dispatchBoundaries(win, now, Date.now());

  const { data, error } = await supabase.rpc("dispatch_rollup", {
    p_company: profile.company_id,
    p_from: B.from,
    p_to: B.to,
    p_prev_from: B.prevFrom,
    p_prev_to: B.prevTo,
    p_today: B.today,
    p_now: B.nowIso,
    p_week_end: B.weekEnd,
    p_untouched_from: B.untouchedFrom,
    p_results_from: B.resultsFrom,
    p_waiting_from: B.waitingFrom,
  });
  if (!error && data) return coerceDispatchRollup(data);

  // ── Fallback: the same buckets from targeted queries ─────────────
  const companyId = profile.company_id;
  const leadsCreated = (from: string, to: string | null) =>
    selectAll<{ id: string; created_at: string; dispatcher_id: string | null }>((f, t) => {
      let q = supabase
        .from("leads")
        .select("id, created_at, dispatcher_id")
        .eq("company_id", companyId)
        .gte("created_at", from)
        .range(f, t);
      if (to) q = q.lt("created_at", nextDay(to));
      return q;
    });

  const eventsCreated = (from: string, to: string | null) =>
    selectAll<{ created_by: string | null }>((f, t) => {
      let q = supabase
        .from("events")
        .select("created_by")
        .eq("company_id", companyId)
        .gte("created_at", from)
        .range(f, t);
      if (to) q = q.lt("created_at", nextDay(to));
      return q;
    });

  const eventsDated = (from: string, to: string | null) =>
    selectAll<{ created_by: string | null; status: string }>((f, t) => {
      let q = supabase
        .from("events")
        .select("created_by, status")
        .eq("company_id", companyId)
        .gte("date", from)
        .range(f, t);
      if (to) q = q.lte("date", to);
      return q;
    });

  const callsIn = (from: string, to: string | null) =>
    selectAll<DispatchInputs["callsInWindow"][number]>((f, t) => {
      let q = supabase
        .from("call_logs")
        .select("rep_id, duration_seconds, disposition")
        .eq("company_id", companyId)
        .gte("created_at", from)
        .range(f, t);
      if (to) q = q.lt("created_at", nextDay(to));
      return q;
    });

  const textsIn = async (from: string, to: string | null) => {
    let q = supabase
      .from("sms_messages")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("direction", "outbound")
      .or("channel.is.null,channel.neq.rep")
      .gte("created_at", from);
    if (to) q = q.lt("created_at", nextDay(to));
    const { count } = await q;
    return count ?? 0;
  };

  const hasPrev = !!B.prevFrom;
  const [
    cohortLeads,
    prevLeads,
    waitingLeads,
    todayRows,
    weekEvents,
    resultsMissing,
    overdueTasks,
    bookedInWindow,
    prevBooked,
    datedInWindow,
    prevDated,
    callsInWindow,
    prevCallRows,
    textsInWindow,
    prevTexts,
  ] = await Promise.all([
    leadsCreated(B.from, B.to),
    hasPrev ? leadsCreated(B.prevFrom!, B.prevTo) : Promise.resolve([] as CohortRow[]),
    // The one deliberately wide fallback read: every pre-appointment
    // lead of the last 90 days. The RPC replaces this scan.
    selectAll<{ id: string; created_at: string; dispatcher_id: string | null }>((f, t) =>
      supabase
        .from("leads")
        .select("id, created_at, dispatcher_id")
        .eq("company_id", companyId)
        .in("stage", [...WAITING_STAGES])
        .gte("created_at", B.waitingFrom)
        .range(f, t)
    ),
    supabase
      .from("events")
      .select(
        "id, time, end_time, title, lead_id, assigned_to, status, customer_confirmed, rep_confirmed, leads(contact_type, company_name, first_name, last_name)"
      )
      .eq("company_id", companyId)
      .eq("date", B.today)
      .neq("status", "Cancelled"),
    selectAll<{ date: string; status: string }>((f, t) =>
      supabase
        .from("events")
        .select("date, status")
        .eq("company_id", companyId)
        .gte("date", B.today)
        .lte("date", B.weekEnd)
        .range(f, t)
    ),
    supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .gte("date", B.resultsFrom)
      .lt("date", B.today)
      .in("status", ["New", "Confirmed"]),
    supabase
      .from("lead_tasks")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .is("completed_at", null)
      .lt("due_date", B.today),
    eventsCreated(B.from, B.to),
    hasPrev
      ? supabase
          .from("events")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .gte("created_at", B.prevFrom!)
          .lt("created_at", nextDay(B.prevTo!))
      : Promise.resolve({ count: 0 }),
    eventsDated(B.from, B.to),
    hasPrev ? eventsDated(B.prevFrom!, B.prevTo) : Promise.resolve([]),
    callsIn(B.from, B.to),
    hasPrev ? callsIn(B.prevFrom!, B.prevTo) : Promise.resolve([]),
    textsIn(B.from, B.to),
    hasPrev ? textsIn(B.prevFrom!, B.prevTo) : Promise.resolve(0),
  ]);
  // First touch per lead, for the two cohorts and the untouched check,
  // fetched by lead id in slices -- a window holds hundreds of leads,
  // never the book.
  const touchIds = new Set<string>();
  for (const l of cohortLeads) touchIds.add(l.id);
  for (const l of prevLeads) touchIds.add(l.id);
  const untouchedCandidates = waitingLeads.filter((l) => l.created_at >= B.untouchedFrom);
  for (const l of untouchedCandidates) touchIds.add(l.id);
  const firstTouch = new Map<string, string>();
  const note = (leadId: string, at: string) => {
    const cur = firstTouch.get(leadId);
    if (!cur || at < cur) firstTouch.set(leadId, at);
  };
  const ids = [...touchIds];
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200);
    const [calls, texts, notes] = await Promise.all([
      supabase.from("call_logs").select("lead_id, created_at").in("lead_id", slice),
      supabase
        .from("sms_messages")
        .select("lead_id, created_at")
        .in("lead_id", slice)
        .eq("direction", "outbound")
        .or("channel.is.null,channel.neq.rep"),
      supabase.from("lead_notes").select("lead_id, created_at").in("lead_id", slice),
    ]);
    for (const rows of [calls.data, texts.data, notes.data]) {
      for (const r of (rows ?? []) as { lead_id: string | null; created_at: string }[]) {
        if (r.lead_id) note(r.lead_id, r.created_at);
      }
    }
  }
  const withTouch = (l: { id: string; created_at: string; dispatcher_id: string | null }): CohortRow => ({
    ...l,
    first_touch_at: firstTouch.get(l.id) ?? null,
  });

  type TodayRaw = Omit<TodayVisit, "lead_name"> & {
    leads: {
      contact_type: string;
      company_name: string | null;
      first_name: string | null;
      last_name: string | null;
    } | null;
  };
  const todayEvents: TodayVisit[] = ((todayRows.data ?? []) as unknown as TodayRaw[]).map((e) => {
    const l = e.leads;
    const lead_name = !l
      ? null
      : l.contact_type === "Company"
        ? l.company_name || "Unnamed Company"
        : `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || "Unnamed";
    return {
      id: e.id,
      time: e.time,
      end_time: e.end_time,
      title: e.title,
      lead_id: e.lead_id,
      lead_name,
      assigned_to: e.assigned_to,
      status: e.status,
      customer_confirmed: !!e.customer_confirmed,
      rep_confirmed: !!e.rep_confirmed,
    };
  });

  return buildDispatchRollup({
    boundaries: B,
    cohort: cohortLeads.map(withTouch),
    prevCohort: prevLeads.map(withTouch),
    untouched: untouchedCandidates.filter((l) => !firstTouch.has(l.id)),
    waiting: waitingLeads,
    todayEvents,
    weekEvents,
    resultsMissing: resultsMissing.count ?? 0,
    overdueTasks: overdueTasks.count ?? 0,
    bookedInWindow,
    prevBookedCount: prevBooked.count ?? 0,
    datedInWindow,
    prevDated,
    callsInWindow,
    prevCalls: {
      dials: prevCallRows.length,
      connected: prevCallRows.filter((c) => (c.duration_seconds || 0) > 0).length,
    },
    textsInWindow,
    prevTexts,
  });
}

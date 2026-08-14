"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { appointmentAttended, isAdminRole, isSettledStage, type EventStatus } from "@/lib/data/types";
import { selectAll } from "@/lib/data/select-all";

type BriefLead = {
  id: string;
  created_at: string;
  stage: string;
  value: number | null;
  won_at: string | null;
  source: string | null;
  refund_status: string;
  refund_requested_at: string | null;
  has_appt: string | null;
};

export type BriefPeriod = "today" | "week" | "month";

export type BriefStats = {
  leadsAdded: number;
  apptsBooked: number;
  apptsScheduled: number;
  showed: number;
  noShow: number;
  calls: number;
  talkMinutes: number;
  textsOut: number;
  textsIn: number;
  tasksCompleted: number;
  won: number;
  wonValue: number;
};

export type BriefAttention = {
  overdueTasks: number;
  unconfirmedSoon: number;
  refundsOutstanding: number;
  staleRefunds: number;
  coldLeads: number;
};

export type DailyBrief = {
  companyName: string;
  generatedAt: string;
  periods: Record<BriefPeriod, BriefStats>;
  attention: BriefAttention;
  topSources: { source: string; count: number }[];
  repActivity: { name: string; appts: number; calls: number }[];
};

function startOf(period: BriefPeriod): string {
  const days = period === "today" ? 1 : period === "week" ? 7 : 30;
  return new Date(Date.now() - days * 86400000).toISOString();
}

function dayOf(period: BriefPeriod): string {
  return startOf(period).slice(0, 10);
}

/**
 * Numbers for the admin daily brief.
 *
 * Admin-gated on the server, not just in the UI -- this aggregates the
 * whole company's performance, and a server action is reachable directly.
 */
export async function getDailyBrief(): Promise<{ error?: string; brief?: DailyBrief }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "The daily brief is for admins." };

  const supabase = await createClient();
  const companyId = profile.company_id;
  const todayISO = new Date().toISOString().slice(0, 10);
  const in2Days = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);

  const [
    { data: company },
    leads,
    { data: events },
    { data: calls },
    { data: texts },
    { data: tasks },
    { data: members },
  ] = await Promise.all([
    supabase.from("company_profile").select("name").eq("company_id", companyId).maybeSingle(),
    // selectAll: every figure on the brief is a sum over this, and a
    // bare select stops at 1000. On 1520 leads the morning brief was
    // reporting two thirds of the business as though it were all of it.
    selectAll<BriefLead>((rangeFrom, rangeTo) =>
      supabase
        .from("leads")
        .select(
          "id, created_at, stage, value, won_at, source, refund_status, refund_requested_at, has_appt"
        )
        .eq("company_id", companyId)
        .range(rangeFrom, rangeTo)
    ),
    supabase
      .from("events")
      .select("id, created_at, date, status, assigned_to, customer_confirmed")
      .eq("company_id", companyId),
    supabase
      .from("call_logs")
      .select("id, created_at, duration_seconds, rep_id")
      .eq("company_id", companyId),
    supabase
      .from("sms_messages")
      .select("id, created_at, direction")
      .eq("company_id", companyId),
    supabase
      .from("lead_tasks")
      .select("id, lead_id, due_date, completed_at")
      .eq("company_id", companyId),
    supabase.from("profiles").select("id, name, email"),
  ]);

  const leadRows = (leads ?? []) as {
    id: string; created_at: string; stage: string; value: number | null; won_at: string | null;
    source: string | null; refund_status: string; refund_requested_at: string | null; has_appt: string | null;
  }[];
  const eventRows = (events ?? []) as {
    created_at: string; date: string; status: string; assigned_to: string | null; customer_confirmed: boolean;
  }[];
  const callRows = (calls ?? []) as { created_at: string; duration_seconds: number; rep_id: string | null }[];
  const textRows = (texts ?? []) as { created_at: string; direction: string }[];
  const taskRows = (tasks ?? []) as { lead_id: string; due_date: string; completed_at: string | null }[];
  const memberRows = (members ?? []) as { id: string; name: string | null; email: string | null }[];

  function statsFor(period: BriefPeriod): BriefStats {
    const since = startOf(period);
    const sinceDay = dayOf(period);
    const periodEvents = eventRows.filter((e) => e.date >= sinceDay && e.date <= todayISO);
    const wonInPeriod = leadRows.filter((l) => l.won_at && l.won_at >= since);
    const periodCalls = callRows.filter((c) => c.created_at >= since);
    return {
      leadsAdded: leadRows.filter((l) => l.created_at >= since).length,
      apptsBooked: eventRows.filter((e) => e.created_at >= since).length,
      apptsScheduled: periodEvents.length,
      showed: periodEvents.filter((e) => appointmentAttended(e.status as EventStatus)).length,
      noShow: periodEvents.filter((e) => e.status === "No-show").length,
      calls: periodCalls.length,
      talkMinutes: Math.round(periodCalls.reduce((t, c) => t + (c.duration_seconds || 0), 0) / 60),
      textsOut: textRows.filter((t) => t.created_at >= since && t.direction === "outbound").length,
      textsIn: textRows.filter((t) => t.created_at >= since && t.direction === "inbound").length,
      tasksCompleted: taskRows.filter((t) => t.completed_at && t.completed_at >= since).length,
      won: wonInPeriod.length,
      wonValue: wonInPeriod.reduce((t, l) => t + (Number(l.value) || 0), 0),
    };
  }

  const settledLeadIds = new Set(leadRows.filter((l) => isSettledStage(l.stage)).map((l) => l.id));
  const openRefunds = leadRows.filter((l) => l.refund_status === "Requested");
  const attention: BriefAttention = {
    // Skips tasks hanging off a lead that is already Won or Lost. Three
    // of these were auto-created "no outcome set" follow-ups on
    // appointments whose leads were later won -- counting them made the
    // brief disagree with the pipeline's Follow-ups Due panel, which has
    // always ignored settled leads.
    overdueTasks: taskRows.filter(
      (t) => !t.completed_at && t.due_date < todayISO && !settledLeadIds.has(t.lead_id)
    ).length,
    // Appointments in the next couple of days the customer hasn't confirmed
    // -- the ones most likely to become a wasted trip.
    unconfirmedSoon: eventRows.filter(
      (e) =>
        e.date >= todayISO &&
        e.date <= in2Days &&
        !e.customer_confirmed &&
        e.status !== "Cancelled"
    ).length,
    refundsOutstanding: openRefunds.length,
    staleRefunds: openRefunds.filter(
      (l) =>
        l.refund_requested_at &&
        Date.now() - new Date(l.refund_requested_at).getTime() > 30 * 86400000
    ).length,
    coldLeads: leadRows.filter(
      (l) => l.stage !== "Won" && l.stage !== "Lost" && l.stage !== "DNC" && !l.has_appt
    ).length,
  };

  const sourceTally = new Map<string, number>();
  const weekAgo = startOf("week");
  for (const l of leadRows) {
    if (l.created_at < weekAgo) continue;
    const key = l.source || "(none)";
    sourceTally.set(key, (sourceTally.get(key) ?? 0) + 1);
  }
  const topSources = [...sourceTally.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const nameById = new Map(memberRows.map((m) => [m.id, m.name || m.email || "Unknown"]));
  const repTally = new Map<string, { appts: number; calls: number }>();
  for (const e of eventRows) {
    if (e.created_at < weekAgo || !e.assigned_to) continue;
    const row = repTally.get(e.assigned_to) ?? { appts: 0, calls: 0 };
    row.appts += 1;
    repTally.set(e.assigned_to, row);
  }
  for (const c of callRows) {
    if (c.created_at < weekAgo || !c.rep_id) continue;
    const row = repTally.get(c.rep_id) ?? { appts: 0, calls: 0 };
    row.calls += 1;
    repTally.set(c.rep_id, row);
  }
  const repActivity = [...repTally.entries()]
    .map(([id, v]) => ({ name: nameById.get(id) ?? "Unknown", ...v }))
    .sort((a, b) => b.appts + b.calls - (a.appts + a.calls))
    .slice(0, 6);

  return {
    brief: {
      companyName: (company as { name: string | null } | null)?.name || "Your Company",
      generatedAt: new Date().toISOString(),
      periods: {
        today: statsFor("today"),
        week: statsFor("week"),
        month: statsFor("month"),
      },
      attention,
      topSources,
      repActivity,
    },
  };
}

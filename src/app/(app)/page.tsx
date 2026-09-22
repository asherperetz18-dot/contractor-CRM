import { companyNow } from "@/lib/data/company-today";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import { canViewFinancials } from "@/lib/data/accounting-access";
import { isoDay, presetWindow } from "@/lib/data/date-range";
import { getDashboardRollup } from "@/lib/actions/dashboard";
import type { Event, Lead, PipelineStageRow, RolePageVisibilityRow } from "@/lib/data/types";
import { NAV, filterNavForProfile } from "@/lib/nav";
import { MobileDashboard, type MobileModule } from "./mobile-dashboard";
import { DashboardView } from "./dashboard-view";

export default async function DashboardPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const companyId = profile?.company_id ?? "";

  // The office's calendar, not the server's: Vercel's clock is UTC, and
  // from 5pm Pacific "today" there is already tomorrow. `now` is a
  // calendar Date (its local getters read the company wall clock);
  // anything measured in hours starts from the real instant instead.
  const now = await companyNow();
  const todayISO = isoDay(now);

  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const last48hISO = new Date(new Date().getTime() - 48 * 60 * 60 * 1000).toISOString();

  // The desktop dashboard is served by one reduced call (dashboard_
  // rollup, 0162, with a tested fallback) -- the old page summed its
  // headline by paging every open lead through the server on each
  // load. The remaining queries feed the two list panels and the
  // phone dashboard, which keeps its own shape.
  const [
    rollup,
    recentLeads,
    nextEvents,
    stagesRes,
    members,
    openTasks,
    overdueTasks,
    callLogs48h,
    eventsThisWeek,
    eventsThisMonth,
    visibilityRows,
  ] = await Promise.all([
    getDashboardRollup(presetWindow("month", now)),
    supabase
      .from("leads")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("events")
      .select("*")
      .eq("company_id", companyId)
      .gte("date", todayISO)
      .order("date", { ascending: true })
      .order("time", { ascending: true })
      .limit(5),
    supabase
      .from("pipeline_stages")
      .select("*")
      .eq("company_id", companyId)
      .order("sort_order", { ascending: true }),
    profile ? getCompanyMembers(companyId) : Promise.resolve([]),
    supabase
      .from("lead_tasks")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .is("completed_at", null),
    supabase
      .from("lead_tasks")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .is("completed_at", null)
      .lt("due_date", todayISO),
    supabase
      .from("call_logs")
      .select("duration_seconds, disposition")
      .eq("company_id", companyId)
      .gte("created_at", last48hISO),
    supabase
      .from("events")
      .select("date")
      .eq("company_id", companyId)
      .gte("date", isoDay(weekStart))
      .lte("date", isoDay(weekEnd)),
    supabase
      .from("events")
      .select("date")
      .eq("company_id", companyId)
      .gte("date", isoDay(monthStart))
      .lte("date", isoDay(monthEnd)),
    supabase
      .from("role_page_visibility")
      .select("id, role, page_key, visible")
      .eq("company_id", companyId),
  ]);

  const callRows = (callLogs48h.data ?? []) as { duration_seconds: number; disposition: string }[];
  const callActivity = {
    dials: callRows.length,
    connected: callRows.filter((c) => c.duration_seconds > 0).length,
    talkTimeSeconds: callRows.reduce((sum, c) => sum + (c.duration_seconds || 0), 0),
    sales: callRows.filter((c) => (c.disposition || "").toLowerCase().includes("sale")).length,
  };

  const weekEventRows = (eventsThisWeek.data ?? []) as { date: string }[];
  const weekCounts = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    const dateStr = isoDay(d);
    return weekEventRows.filter((r) => r.date === dateStr).length;
  });

  const monthEventRows = (eventsThisMonth.data ?? []) as { date: string }[];
  const monthCountByDate = new Map<string, number>();
  for (const row of monthEventRows) {
    monthCountByDate.set(row.date, (monthCountByDate.get(row.date) ?? 0) + 1);
  }
  const monthDayCount = monthEnd.getDate();
  const monthCells = Array.from({ length: monthDayCount }, (_, i) => {
    const day = i + 1;
    const dateStr = isoDay(new Date(now.getFullYear(), now.getMonth(), day));
    return { day, dateStr, count: monthCountByDate.get(dateStr) ?? 0, isToday: dateStr === todayISO };
  });

  const overrides = (visibilityRows.data as RolePageVisibilityRow[]) ?? [];
  const filteredNav = profile ? filterNavForProfile(NAV, profile, overrides) : [];
  const modules: MobileModule[] = [];
  for (const entry of filteredNav) {
    if (entry.type === "link") {
      if (entry.href !== "/") modules.push({ label: entry.label, href: entry.href, icon: entry.icon });
    } else {
      for (const item of entry.items) {
        if (item.href) modules.push({ label: item.label, href: item.href, icon: entry.icon });
      }
    }
  }

  // Name lookups read the whole roster on purpose -- narrowing them
  // turns historical assignees into "Unnamed".
  const repNames = Object.fromEntries(
    members.map((m) => [m.id, m.name || m.email || "Unnamed"])
  ) as Record<string, string>;

  return (
    <>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Dashboard</h1>
          <p className="module-sub">Overview of your business</p>
        </div>
      </div>

      <DashboardView
        initialRollup={rollup}
        savedPanelOrder={profile?.dashboard_panel_order ?? null}
        canMoney={canViewFinancials(profile)}
        stages={(stagesRes.data as PipelineStageRow[]) ?? []}
        repNames={repNames}
        recentLeads={(recentLeads.data as Lead[] | null) ?? []}
        nextEvents={(nextEvents.data as Event[] | null) ?? []}
      />

      <MobileDashboard
        openTasksCount={openTasks.count ?? 0}
        overdueTasksCount={overdueTasks.count ?? 0}
        callActivity={callActivity}
        weekCounts={weekCounts}
        monthLabel={now.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        monthLeadingBlanks={monthStart.getDay()}
        monthCells={monthCells}
        modules={modules}
      />
    </>
  );
}

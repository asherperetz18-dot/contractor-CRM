import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { leadDisplayName, money as moneyFmt, type RolePageVisibilityRow } from "@/lib/data/types";
import type { Event, Lead } from "@/lib/data/types";
import { NAV, filterNavForProfile } from "@/lib/nav";
import { MobileDashboard, type MobileModule } from "./mobile-dashboard";

function money(n: number) {
  return (Number(n) || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function toISODate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  const companyId = profile?.company_id ?? "";

  const todayISO = new Date().toISOString().slice(0, 10);
  const now = new Date();

  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const last48hISO = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();

  const [
    openLeads,
    jobsInProgress,
    upcomingEvents,
    pipelineValue,
    recentLeads,
    nextEvents,
    openTasks,
    overdueTasks,
    callLogs48h,
    eventsThisWeek,
    eventsThisMonth,
    visibilityRows,
  ] = await Promise.all([
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .not("stage", "in", "(Won,Lost)"),
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("status", "In Progress"),
    supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .gte("date", todayISO),
    supabase
      .from("leads")
      .select("value")
      .eq("company_id", companyId)
      .not("stage", "in", "(Won,Lost)"),
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
      .gte("date", toISODate(weekStart))
      .lte("date", toISODate(weekEnd)),
    supabase
      .from("events")
      .select("date")
      .eq("company_id", companyId)
      .gte("date", toISODate(monthStart))
      .lte("date", toISODate(monthEnd)),
    supabase
      .from("role_page_visibility")
      .select("id, role, page_key, visible")
      .eq("company_id", companyId),
  ]);

  const totalPipelineValue = (pipelineValue.data ?? []).reduce(
    (sum: number, row: Record<string, unknown>) => sum + (Number(row.value) || 0),
    0
  );

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
    const dateStr = toISODate(d);
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
    const dateStr = toISODate(new Date(now.getFullYear(), now.getMonth(), day));
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

  return (
    <>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Dashboard</h1>
          <p className="module-sub">Overview of your business</p>
        </div>
      </div>

      <div className="dash-desktop">
        <div className="stat-grid">
          <div className="stat-card stat-static">
            <div className="stat-value">{money(totalPipelineValue)}</div>
            <div className="stat-label">Open pipeline value</div>
          </div>
          <div className="stat-card stat-static">
            <div className="stat-value">{openLeads.count ?? 0}</div>
            <div className="stat-label">Open leads</div>
          </div>
          <div className="stat-card stat-static">
            <div className="stat-value">{jobsInProgress.count ?? 0}</div>
            <div className="stat-label">Jobs in progress</div>
          </div>
          <div className="stat-card stat-static">
            <div className="stat-value">{upcomingEvents.count ?? 0}</div>
            <div className="stat-label">Upcoming appointments</div>
          </div>
        </div>

        <div className="dash-lower">
          <div className="dash-panel">
            <h3>Recent leads</h3>
            {(recentLeads.data as Lead[] | null)?.length ? (
              <ul className="dash-list">
                {(recentLeads.data as Lead[]).map((l) => (
                  <li key={l.id}>
                    <span style={{ flex: 1 }}>{leadDisplayName(l)}</span>
                    <span className="mono">{moneyFmt(l.value)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-hint">Nothing here yet.</p>
            )}
            <Link href="/pipeline" className="btn-ghost small" style={{ display: "inline-block" }}>
              View Pipeline
            </Link>
          </div>
          <div className="dash-panel">
            <h3>Upcoming appointments</h3>
            {(nextEvents.data as Event[] | null)?.length ? (
              <ul className="dash-list">
                {(nextEvents.data as Event[]).map((ev) => (
                  <li key={ev.id}>
                    <span className="mono">{ev.date}</span>
                    <span style={{ flex: 1 }}>{ev.title}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-hint">Nothing scheduled.</p>
            )}
            <Link href="/schedule" className="btn-ghost small" style={{ display: "inline-block" }}>
              View Schedule
            </Link>
          </div>
        </div>
      </div>

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

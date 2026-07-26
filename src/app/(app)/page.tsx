import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { leadDisplayName, money as moneyFmt } from "@/lib/data/types";
import type { Event, Lead } from "@/lib/data/types";

function money(n: number) {
  return (Number(n) || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export default async function DashboardPage() {
  const supabase = await createClient();

  const todayISO = new Date().toISOString().slice(0, 10);

  const [openLeads, jobsInProgress, upcomingEvents, pipelineValue, recentLeads, nextEvents] =
    await Promise.all([
      supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .not("stage", "in", "(Won,Lost)"),
      supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("status", "In Progress"),
      supabase
        .from("events")
        .select("id", { count: "exact", head: true })
        .gte("date", todayISO),
      supabase
        .from("leads")
        .select("value")
        .not("stage", "in", "(Won,Lost)"),
      supabase
        .from("leads")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("events")
        .select("*")
        .gte("date", todayISO)
        .order("date", { ascending: true })
        .order("time", { ascending: true })
        .limit(5),
    ]);

  const totalPipelineValue = (pipelineValue.data ?? []).reduce(
    (sum: number, row: Record<string, unknown>) => sum + (Number(row.value) || 0),
    0
  );

  return (
    <>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Dashboard</h1>
          <p className="module-sub">Overview of your business</p>
        </div>
      </div>

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
    </>
  );
}

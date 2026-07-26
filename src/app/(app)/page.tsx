import { createClient } from "@/lib/supabase/server";

function money(n: number) {
  return (Number(n) || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export default async function DashboardPage() {
  const supabase = await createClient();

  const [openLeads, jobsInProgress, upcomingEvents, pipelineValue] =
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
        .gte("date", new Date().toISOString().slice(0, 10)),
      supabase
        .from("leads")
        .select("value")
        .not("stage", "in", "(Won,Lost)"),
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
          <p className="empty-hint">Nothing here yet.</p>
        </div>
        <div className="dash-panel">
          <h3>Upcoming appointments</h3>
          <p className="empty-hint">Nothing scheduled.</p>
        </div>
      </div>
    </>
  );
}

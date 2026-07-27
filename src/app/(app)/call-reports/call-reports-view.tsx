"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  NO_DISPOSITION,
  leadDisplayName,
  type CallDispositionRow,
  type CallLog,
  type Lead,
  type Profile,
} from "@/lib/data/types";
import { updateCallDisposition } from "@/lib/actions/call-logs";

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function CallReportsView({
  callLogs,
  leads,
  reps,
  dispositions,
  canWrite,
}: {
  callLogs: CallLog[];
  leads: Lead[];
  reps: Profile[];
  dispositions: CallDispositionRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [repFilter, setRepFilter] = useState("All");
  const [dispositionFilter, setDispositionFilter] = useState("All");

  const leadById = useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads]);
  const repById = useMemo(() => new Map(reps.map((r) => [r.id, r])), [reps]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return callLogs.filter((c) => {
      if (repFilter !== "All" && c.rep_id !== repFilter) return false;
      if (dispositionFilter !== "All" && c.disposition !== dispositionFilter) return false;
      if (!q) return true;
      const lead = c.lead_id ? leadById.get(c.lead_id) : null;
      const name = lead ? leadDisplayName(lead).toLowerCase() : "";
      return name.includes(q) || c.to_number.toLowerCase().includes(q);
    });
  }, [callLogs, repFilter, dispositionFilter, search, leadById]);

  const totalCalls = rows.length;
  const totalSeconds = rows.reduce((sum, c) => sum + c.duration_seconds, 0);
  const avgSeconds = totalCalls ? Math.round(totalSeconds / totalCalls) : 0;
  const connectedCount = rows.filter((c) => c.duration_seconds > 0).length;
  const connectedRate = totalCalls ? Math.round((connectedCount / totalCalls) * 100) : 0;

  async function handleDispositionChange(callLogId: string, disposition: string) {
    await updateCallDisposition(callLogId, disposition);
    router.refresh();
  }

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Call Reports</h1>
          <p className="module-sub">Every call placed through the in-app dialer, with recordings and outcomes</p>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card stat-static">
          <div className="stat-value mono">{totalCalls}</div>
          <div className="stat-label">Total Calls</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{formatDuration(totalSeconds)}</div>
          <div className="stat-label">Total Talk Time</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{formatDuration(avgSeconds)}</div>
          <div className="stat-label">Avg Duration</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{connectedRate}%</div>
          <div className="stat-label">Connected</div>
        </div>
      </div>

      <div className="filter-bar">
        <input
          className="ur-search"
          style={{ maxWidth: 320, marginBottom: 0 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or phone…"
        />
        <select value={repFilter} onChange={(e) => setRepFilter(e.target.value)}>
          <option value="All">All Reps</option>
          {reps.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name || r.email}
            </option>
          ))}
        </select>
        <select value={dispositionFilter} onChange={(e) => setDispositionFilter(e.target.value)}>
          <option value="All">All Dispositions</option>
          {dispositions.map((d) => (
            <option key={d.id} value={d.name}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          <p className="empty-label">No calls yet</p>
          <p className="empty-hint">Calls placed through the in-app dialer will show up here.</p>
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Date/Time</th>
              <th>Contact</th>
              <th>Phone</th>
              <th>Rep</th>
              <th>Duration</th>
              <th>Disposition</th>
              <th>Recording</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const lead = c.lead_id ? leadById.get(c.lead_id) : null;
              const rep = c.rep_id ? repById.get(c.rep_id) : null;
              return (
                <tr key={c.id}>
                  <td>{new Date(c.created_at).toLocaleString()}</td>
                  <td>{lead ? leadDisplayName(lead) : "—"}</td>
                  <td className="mono">{c.to_number}</td>
                  <td>{rep?.name || rep?.email || "—"}</td>
                  <td className="mono">{formatDuration(c.duration_seconds)}</td>
                  <td>
                    <select
                      value={c.disposition}
                      disabled={!canWrite}
                      onChange={(e) => handleDispositionChange(c.id, e.target.value)}
                    >
                      <option value={NO_DISPOSITION}>{NO_DISPOSITION}</option>
                      {dispositions
                        .filter((d) => d.name !== NO_DISPOSITION)
                        .map((d) => (
                          <option key={d.id} value={d.name}>
                            {d.name}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td>
                    {c.recording_url ? (
                      <audio controls src={c.recording_url} className="call-recording-player" />
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

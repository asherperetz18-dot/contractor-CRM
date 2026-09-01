"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
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

/** The preset windows the date picker offers, oldest-thinking first. */
const RANGES: { key: string; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "month", label: "This month" },
  { key: "lastmonth", label: "Last month" },
  { key: "all", label: "All time" },
  { key: "custom", label: "Custom range…" },
];

export function CallReportsView({
  callLogs,
  leads,
  reps,
  dispositions,
  canWrite,
  initialRange,
}: {
  callLogs: CallLog[];
  leads: Lead[];
  reps: Profile[];
  dispositions: CallDispositionRow[];
  canWrite: boolean;
  initialRange: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [repFilter, setRepFilter] = useState("All");
  const [dispositionFilter, setDispositionFilter] = useState("All");
  const [rangeKey, setRangeKey] = useState(initialRange);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  // Local midnights, sent as UTC instants -- "today" means today where
  // the person is sitting, not where the server happens to run.
  function applyRange(key: string, from?: string, to?: string) {
    setRangeKey(key);
    if (key === "custom" && !(from && to)) return; // wait for Apply
    const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const now = new Date();
    let start: Date | null = null;
    let end: Date | null = null;
    if (key === "today") start = day(now);
    else if (key === "yesterday") {
      start = day(now);
      start.setDate(start.getDate() - 1);
      end = day(now);
    } else if (key === "7d") start = new Date(now.getTime() - 7 * 86400000);
    else if (key === "30d") start = new Date(now.getTime() - 30 * 86400000);
    else if (key === "month") start = new Date(now.getFullYear(), now.getMonth(), 1);
    else if (key === "lastmonth") {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (key === "custom" && from && to) {
      start = new Date(from + "T00:00:00");
      end = new Date(to + "T00:00:00");
      end.setDate(end.getDate() + 1); // inclusive end day
    }
    const params = new URLSearchParams({ range: key });
    if (start) params.set("fromTs", start.toISOString());
    if (end) params.set("toTs", end.toISOString());
    router.replace(`/call-reports?${params.toString()}`);
  }

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
      // The same number the Phone column shows: the customer's end.
      // Searching the tracking/company number would match everything
      // and the number on screen would match nothing.
      const phone = c.direction === "inbound" ? c.from_number : c.to_number;
      return name.includes(q) || phone.toLowerCase().includes(q);
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
        <div className="cr-range">
          <select
            value={rangeKey}
            onChange={(e) => applyRange(e.target.value)}
            aria-label="Date range"
          >
            {RANGES.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
          {rangeKey === "custom" && (
            <>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                aria-label="From date"
              />
              <span>–</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                aria-label="To date"
              />
              <button
                type="button"
                className="btn-ghost small"
                disabled={!customFrom || !customTo || customFrom > customTo}
                onClick={() => applyRange("custom", customFrom, customTo)}
              >
                Apply
              </button>
            </>
          )}
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
        <div className="table-scroll">
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
                  <td>
                    {lead ? (
                      // Straight to the full contact card; closing it
                      // lands back here (the `from` param) so a review
                      // session can keep moving down the list.
                      <Link
                        href={`/contacts?openLead=${lead.id}&from=/call-reports`}
                        className="ur-crumb-link"
                      >
                        {leadDisplayName(lead)}
                      </Link>
                    ) : (
                      "—"
                    )}
                    {c.marketing_source && (
                      <div className="est-tax-note">via {c.marketing_source}</div>
                    )}
                  </td>
                  {/* The customer's number, whichever end of the call
                      they were on. */}
                  <td className="mono">
                    {c.direction === "inbound" ? c.from_number : c.to_number}
                  </td>
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
                    {/* One player for both providers -- the proxy fetches
                        Twilio recordings with Twilio credentials and
                        CallRail recordings through CallRail's API. */}
                    {c.recording_url ? (
                      <audio
                        controls
                        preload="none"
                        src={`/api/voice/recording/${c.id}`}
                        className="call-recording-player"
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}

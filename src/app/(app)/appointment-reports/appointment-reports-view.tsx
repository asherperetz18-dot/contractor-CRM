"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { DateRangeFilter, type RangeState } from "@/components/date-range-filter";
import { resolveWindow, withinWindow } from "@/lib/data/date-range";
import {
  EVENT_STATUS_COLOR,
  appointmentResultOverdue,
  formatTimeRange,
  appointmentAttended,
  hasAppointmentResult,
  leadDisplayName,
  shortReceivedDate,
  type Event,
  type Lead,
  type Profile,
} from "@/lib/data/types";

const PRESETS = [
  { key: "7", label: "Last 7 Days" },
  { key: "30", label: "Last 30 Days" },
  { key: "90", label: "Last 90 Days" },
  { key: "all", label: "All Time" },
];

/** Percent, or "—" when there is nothing to divide by. */
function rate(part: number, whole: number): string {
  if (whole === 0) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function AppointmentReportsView({
  events,
  leads,
  reps,
}: {
  events: Event[];
  leads: Lead[];
  reps: Profile[];
  canWrite: boolean;
}) {
  const [range, setRange] = useState<RangeState>({ preset: "30", from: "", to: "" });
  const [repFilter, setRepFilter] = useState("All");
  const [expandedRep, setExpandedRep] = useState<string | null>(null);

  const leadById = useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads]);
  const repName = (id: string | null) =>
    id ? reps.find((r) => r.id === id)?.name || reps.find((r) => r.id === id)?.email || "Unknown" : "Unassigned";

  // Captured once rather than read during render, so the same list does
  // not render differently on a re-render.
  const [nowMs] = useState(() => Date.now());
  const todayISO = new Date(nowMs).toISOString().slice(0, 10);

  const inRange = useMemo(() => {
    const win = resolveWindow(range, new Date(nowMs));
    return events.filter((e) => {
      // Only appointments that have actually happened can have an
      // outcome, so a show rate that counted next week's bookings as
      // "no result" would drift down every time someone books ahead.
      // This still applies to a custom range: a window running into next
      // month reports on the part of it that has been and gone.
      if (e.date > todayISO) return false;
      if (!withinWindow(e.date, win)) return false;
      if (repFilter !== "All" && e.assigned_to !== repFilter) return false;
      return true;
    });
  }, [events, range, repFilter, nowMs, todayISO]);

  // Won counts as a show -- see appointmentAttended.
  const showed = inRange.filter((e) => appointmentAttended(e.status));
  const noShow = inRange.filter((e) => e.status === "No-show");
  const cancelled = inRange.filter((e) => e.status === "Cancelled");
  const pending = inRange.filter((e) => !hasAppointmentResult(e.status));
  // The denominator is deliberately the ones with a recorded outcome.
  // Counting unrecorded appointments as failures would blame reps for a
  // data-entry gap, and counting them as successes would flatter it.
  const resolved = showed.length + noShow.length;

  const byRep = useMemo(() => {
    const map = new Map<string, { total: number; showed: number; noShow: number; pending: number }>();
    for (const e of inRange) {
      const key = e.assigned_to ?? "unassigned";
      const row = map.get(key) ?? { total: 0, showed: 0, noShow: 0, pending: 0 };
      row.total += 1;
      if (appointmentAttended(e.status)) row.showed += 1;
      if (e.status === "No-show") row.noShow += 1;
      if (!hasAppointmentResult(e.status)) row.pending += 1;
      map.set(key, row);
    }
    return [...map.entries()]
      .map(([id, row]) => ({ id, ...row }))
      .sort((a, b) => b.total - a.total);
  }, [inRange]);

  function downloadCsv() {
    const header = ["Date", "Time", "Contact", "Type", "Rep", "Outcome"];
    const rows = [...inRange]
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((e) => {
        const lead = e.lead_id ? leadById.get(e.lead_id) : null;
        return [
          e.date,
          formatTimeRange(e.time, e.end_time, "12h", "-"),
          lead ? leadDisplayName(lead) : "",
          e.event_type,
          repName(e.assigned_to),
          hasAppointmentResult(e.status) ? e.status : "No result recorded",
        ].map(csvCell).join(",");
      });
    const blob = new Blob([[header.join(","), ...rows].join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `appointment-results-${todayISO}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Appointment Reports</h1>
          <p className="module-sub">
            {inRange.length} appointments that have already happened
          </p>
        </div>
        <button className="btn-ghost" onClick={downloadCsv} disabled={inRange.length === 0}>
          Download CSV
        </button>
      </div>

      <div className="ur-filter-bar">
        <DateRangeFilter presets={PRESETS} value={range} onChange={setRange} max={todayISO} />
        <select value={repFilter} onChange={(e) => setRepFilter(e.target.value)}>
          <option value="All">All Reps</option>
          {reps.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name || r.email}
            </option>
          ))}
        </select>
      </div>

      <div className="stat-grid stat-grid-5">
        <div className={"stat-card stat-static" + (showed.length > 0 ? " stat-card-won" : "")}>
          <div className="stat-value mono">{rate(showed.length, resolved)}</div>
          <div className="stat-label">Show Rate</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{showed.length}</div>
          <div className="stat-label">Showed</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{noShow.length}</div>
          <div className="stat-label">No-show</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{cancelled.length}</div>
          <div className="stat-label">Cancelled</div>
        </div>
        <div
          className={"stat-card stat-static" + (pending.length > 0 ? " digest-urgent" : "")}
        >
          <div className="stat-value mono">{pending.length}</div>
          <div className="stat-label">No Result Yet</div>
        </div>
      </div>

      {pending.length > 0 && (
        <p className="hint-note" style={{ marginBottom: 14 }}>
          The show rate is worked out from the {resolved} appointments that have an outcome
          recorded. {pending.length} more have been and gone without one, so they count
          neither way — recording them is what makes this number trustworthy.
        </p>
      )}

      <div className="dash-panel" style={{ marginBottom: 14 }}>
        <h3>By Rep</h3>
        {byRep.length === 0 ? (
          <p className="empty-hint">No appointments in this range.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Rep</th>
                <th className="right">Appts</th>
                <th className="right">Showed</th>
                <th className="right">No-show</th>
                <th className="right">No Result</th>
                <th className="right">Show Rate</th>
              </tr>
            </thead>
            <tbody>
              {byRep.map((row) => {
                const open = expandedRep === row.id;
                const theirs = inRange
                  .filter((e) => (e.assigned_to ?? "unassigned") === row.id)
                  .sort((a, b) => b.date.localeCompare(a.date));
                return (
                  <tr key={row.id} className={open ? "value-breakdown-row is-open" : "value-breakdown-row"}>
                    <td colSpan={6} style={{ padding: 0 }}>
                      <div
                        className="ar-rep-row"
                        onClick={() => setExpandedRep(open ? null : row.id)}
                      >
                        <span className="ar-rep-name">
                          <span className="value-breakdown-caret">{open ? "▾" : "▸"}</span>{" "}
                          {row.id === "unassigned" ? "Unassigned" : repName(row.id)}
                        </span>
                        <span className="mono ar-num">{row.total}</span>
                        <span className="mono ar-num">{row.showed}</span>
                        <span className="mono ar-num">{row.noShow}</span>
                        <span className="mono ar-num">{row.pending}</span>
                        <span className="mono ar-num">
                          {rate(row.showed, row.showed + row.noShow)}
                        </span>
                      </div>
                      {open && (
                        <div className="value-lead-list">
                          {theirs.map((e) => {
                            const lead = e.lead_id ? leadById.get(e.lead_id) : null;
                            const late = appointmentResultOverdue(e, nowMs);
                            return (
                              <Link
                                key={e.id}
                                className="value-lead-row"
                                href={
                                  lead
                                    ? `/contacts?openLead=${lead.id}&from=/appointment-reports`
                                    : "/schedule"
                                }
                              >
                                <span className="value-lead-name">
                                  {lead ? leadDisplayName(lead) : e.title || e.event_type}
                                </span>
                                <span className="value-lead-meta">
                                  {shortReceivedDate(e.date)}{" "}
                                  {formatTimeRange(e.time, e.end_time)} · {e.event_type}
                                </span>
                                {hasAppointmentResult(e.status) ? (
                                  <Badge color={EVENT_STATUS_COLOR[e.status]}>{e.status}</Badge>
                                ) : (
                                  <span className={late ? "stale-tag" : "value-lead-meta"}>
                                    {late ? "● no result" : "upcoming"}
                                  </span>
                                )}
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

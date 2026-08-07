"use client";

import { Fragment, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  daysSince,
  leadDisplayName,
  money,
  stageColor,
  type Lead,
  type PipelineStageRow,
  type Profile,
} from "@/lib/data/types";

type RangeKey = "7" | "30" | "90" | "all";
const RANGE_LABELS: Record<RangeKey, string> = {
  "7": "Last 7 Days",
  "30": "Last 30 Days",
  "90": "Last 90 Days",
  all: "All Time",
};

function withinRange(dateStr: string | null, days: number | null) {
  if (!dateStr) return false;
  if (days === null) return true;
  return daysSince(dateStr) <= days;
}

export function AnalyticsView({
  leads,
  reps,
  stages,
}: {
  leads: Lead[];
  reps: Profile[];
  stages: PipelineStageRow[];
}) {
  const [range, setRange] = useState<RangeKey>("30");
  const [expandedRep, setExpandedRep] = useState<string | null>(null);
  const days = range === "all" ? null : Number(range);

  function repName(id: string | null) {
    if (!id) return "Unassigned";
    return reps.find((r) => r.id === id)?.name || "Unassigned";
  }

  const createdInRange = useMemo(
    () => leads.filter((l) => withinRange(l.created_at, days)),
    [leads, days]
  );
  const wonInRange = useMemo(
    () => leads.filter((l) => l.stage === "Won" && withinRange(l.won_at, days)),
    [leads, days]
  );

  const wonValue = wonInRange.reduce((s, l) => s + (Number(l.value) || 0), 0);

  const bySource = useMemo(() => {
    const map = new Map<string, { count: number; withAppt: number }>();
    for (const l of createdInRange) {
      const key = l.source || "Unknown";
      const entry = map.get(key) ?? { count: 0, withAppt: 0 };
      entry.count += 1;
      if (l.has_appt) entry.withAppt += 1;
      map.set(key, entry);
    }
    return Array.from(map.entries())
      .map(([source, v]) => ({ source, ...v }))
      .sort((a, b) => b.count - a.count);
  }, [createdInRange]);

  const repStats = useMemo(() => {
    return reps
      .map((rep) => {
        const assigned = createdInRange.filter((l) => l.assigned_to === rep.id);
        const won = assigned.filter((l) => l.stage === "Won");
        const wonVal = won.reduce((s, l) => s + (Number(l.value) || 0), 0);
        return { rep, count: assigned.length, wonCount: won.length, wonVal, assigned };
      })
      .filter((r) => r.count > 0)
      .sort((a, b) => b.wonVal - a.wonVal);
  }, [reps, createdInRange]);

  const recentWon = useMemo(
    () =>
      [...wonInRange]
        .sort((a, b) => (b.won_at ?? "").localeCompare(a.won_at ?? ""))
        .slice(0, 8),
    [wonInRange]
  );

  const byStage = useMemo(() => {
    return stages
      .map((s) => s.name)
      .filter((s) => !["Won", "Lost", "DNC"].includes(s))
      .map((stage) => {
        const items = createdInRange.filter((l) => l.stage === stage);
        return {
          stage,
          count: items.length,
          value: items.reduce((s, l) => s + (Number(l.value) || 0), 0),
        };
      })
      .filter((s) => s.count > 0);
  }, [createdInRange, stages]);

  function daysToClose(l: Lead) {
    if (!l.won_at) return null;
    return Math.max(
      0,
      Math.round((new Date(l.won_at).getTime() - new Date(l.created_at).getTime()) / 86400000)
    );
  }

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Marketing Analytics</h1>
          <p className="module-sub">Lead sources, rep performance, and won deals</p>
        </div>
      </div>

      <div className="chip-row">
        {(Object.keys(RANGE_LABELS) as RangeKey[]).map((k) => (
          <button
            key={k}
            className={"chip" + (range === k ? " chip-active" : "")}
            onClick={() => setRange(k)}
          >
            {RANGE_LABELS[k]}
          </button>
        ))}
      </div>

      <div className="stat-grid">
        <div className="stat-card stat-static">
          <div className="stat-value mono">{wonInRange.length}</div>
          <div className="stat-label">Won Deals</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{money(wonValue)}</div>
          <div className="stat-label">Won Value</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{createdInRange.length}</div>
          <div className="stat-label">Leads Created</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">
            {money(createdInRange.reduce((s, l) => s + (Number(l.value) || 0), 0))}
          </div>
          <div className="stat-label">Pipeline Created</div>
        </div>
      </div>

      <div className="dash-lower">
        <div className="dash-panel">
          <h3>Leads by Source</h3>
          {bySource.length === 0 ? (
            <p className="empty-hint">No leads in this range.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th className="right">Leads</th>
                  <th className="right">With Appt</th>
                </tr>
              </thead>
              <tbody>
                {bySource.map((s) => (
                  <tr key={s.source}>
                    <td>{s.source}</td>
                    <td className="right mono">{s.count}</td>
                    <td className="right mono">
                      {s.count ? Math.round((s.withAppt / s.count) * 100) : 0}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="dash-panel">
          <h3>Sales Rep Performance</h3>
          {repStats.length === 0 ? (
            <p className="empty-hint">No assigned leads in this range.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Rep</th>
                  <th className="right">Leads</th>
                  <th className="right">Won</th>
                  <th className="right">Value</th>
                </tr>
              </thead>
              <tbody>
                {repStats.map(({ rep, count, wonCount, wonVal, assigned }) => {
                  const open = expandedRep === rep.id;
                  return (
                    <Fragment key={rep.id}>
                      <tr
                        className={"value-breakdown-row" + (open ? " is-open" : "")}
                        onClick={() => setExpandedRep(open ? null : rep.id)}
                        title={open ? "Hide these leads" : `Show ${rep.name || rep.email}s ${count} leads`}
                      >
                        <td>
                          <span className="value-breakdown-caret">{open ? "▾" : "▸"}</span>{" "}
                          {rep.name || rep.email}
                        </td>
                        <td className="right mono">{count}</td>
                        <td className="right mono">{wonCount}</td>
                        <td className="right mono">{money(wonVal)}</td>
                      </tr>
                      {open && (
                        <tr className="value-breakdown-detail">
                          <td colSpan={4}>
                            <div className="value-lead-list">
                              {[...assigned]
                                .sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))
                                .map((l) => (
                                  <a
                                    key={l.id}
                                    className="value-lead-row"
                                    href={`/contacts?openLead=${l.id}`}
                                    title="Open this contact"
                                  >
                                    <span className="value-lead-name">{leadDisplayName(l)}</span>
                                    <span className="value-lead-meta">
                                      {l.phone || "no phone"} · {l.stage}
                                    </span>
                                    <span className="mono value-lead-value">{money(l.value)}</span>
                                  </a>
                                ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-title">RECENT WON DEALS</span>
        </div>
        {recentWon.length === 0 ? (
          <div className="empty-state">
            <p className="empty-label">No won deals in this range</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Contact</th>
                <th>Rep</th>
                <th className="right">Value</th>
                <th className="right">Days to Close</th>
              </tr>
            </thead>
            <tbody>
              {recentWon.map((l) => (
                <tr key={l.id}>
                  <td>{leadDisplayName(l)}</td>
                  <td>{repName(l.assigned_to)}</td>
                  <td className="right mono">{money(l.value)}</td>
                  <td className="right mono">{daysToClose(l) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-title">PIPELINE BY STAGE</span>
          <span className="settings-section-hint">Leads created in this range</span>
        </div>
        {byStage.length === 0 ? (
          <p className="empty-hint">No leads in this range.</p>
        ) : (
          <div className="chip-row">
            {byStage.map((s) => (
              <div key={s.stage} className="stat-card stat-static" style={{ minWidth: 140 }}>
                <Badge color={stageColor(stages, s.stage)}>{s.stage}</Badge>
                <div className="stat-value mono" style={{ fontSize: 18, marginTop: 6 }}>
                  {s.count}
                </div>
                <div className="stat-label">{money(s.value)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { DateRangeFilter, type RangeState } from "@/components/date-range-filter";
import { resolveWindow, withinWindow } from "@/lib/data/date-range";
import {
  leadDisplayName,
  money,
  stageColor,
  type Lead,
  type PipelineStageRow,
  type Profile,
} from "@/lib/data/types";

const PRESETS = [
  { key: "7", label: "Last 7 Days" },
  { key: "30", label: "Last 30 Days" },
  { key: "90", label: "Last 90 Days" },
  { key: "all", label: "All Time" },
];

export type SignedContract = {
  lead_id: string;
  status: string;
  kind: string | null;
  total_cents: number;
};

export function AnalyticsView({
  leads,
  reps,
  stages,
  signedContracts,
}: {
  leads: Lead[];
  reps: Profile[];
  stages: PipelineStageRow[];
  signedContracts: SignedContract[];
}) {
  const [range, setRange] = useState<RangeState>({ preset: "30", from: "", to: "" });
  const [expandedRep, setExpandedRep] = useState<string | null>(null);
  // Fixed at mount. A "now" read during render moves the window under the
  // user between re-renders, so the same list can come back different.
  const [now] = useState(() => new Date());
  const win = useMemo(() => resolveWindow(range, now), [range, now]);

  // The per-rep report opens on whatever period is being looked at here.
  // Without the custom dates it would silently fall back to its own
  // default, and the two pages would disagree about the same rep.
  const rangeQuery =
    range.from || range.to
      ? `from=${range.from}&to=${range.to}`
      : `days=${range.preset}`;

  function repName(id: string | null) {
    if (!id) return "Unassigned";
    return reps.find((r) => r.id === id)?.name || "Unassigned";
  }

  const createdInRange = useMemo(
    () => leads.filter((l) => withinWindow(l.created_at, win)),
    [leads, win]
  );
  const wonInRange = useMemo(
    () => leads.filter((l) => l.stage === "Won" && withinWindow(l.won_at, win)),
    [leads, win]
  );

  const wonValue = wonInRange.reduce((s, l) => s + (Number(l.value) || 0), 0);

  /**
   * What each source costs and what it sells.
   *
   * This is where cost per lead earns its place: it is a fact about the
   * source, not about a salesperson, and the decision it informs -- keep
   * buying from here, or stop -- is made by comparing spend against the
   * contracts it produced. On a rep report the same number would read
   * $375 on every one of them and say nothing about anybody.
   *
   * Sold counts leads with a signed contract rather than a "Won" stage,
   * so a source is credited with revenue somebody actually committed to.
   */
  const bySource = useMemo(() => {
    const signedByLead = new Map<string, number>();
    for (const c of signedContracts) {
      if ((c.kind ?? "contract") !== "contract") continue;
      signedByLead.set(c.lead_id, (signedByLead.get(c.lead_id) ?? 0) + (c.total_cents || 0));
    }

    const map = new Map<
      string,
      { count: number; withAppt: number; spend: number; costKnown: number; sold: number; revenue: number }
    >();
    for (const l of createdInRange) {
      const key = l.source || "Unknown";
      const entry =
        map.get(key) ?? { count: 0, withAppt: 0, spend: 0, costKnown: 0, sold: 0, revenue: 0 };
      entry.count += 1;
      if (l.has_appt) entry.withAppt += 1;
      const cost = Number(l.lead_cost) || 0;
      if (cost > 0) {
        entry.spend += cost;
        entry.costKnown += 1;
      }
      const signed = signedByLead.get(l.id) ?? 0;
      if (signed > 0) {
        entry.sold += 1;
        entry.revenue += signed;
      }
      map.set(key, entry);
    }
    return Array.from(map.entries())
      .map(([source, v]) => ({
        source,
        ...v,
        // Averaged over the leads that carry a cost, never over all of
        // them: dividing recorded spend by every lead would read a few
        // dollars and look like a cheap source rather than an unfilled
        // field.
        costPerLead: v.costKnown > 0 ? v.spend / v.costKnown : null,
        costPerSale: v.spend > 0 && v.sold > 0 ? v.spend / v.sold : null,
      }))
      .sort((a, b) => b.count - a.count);
  }, [createdInRange, signedContracts]);

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
        <DateRangeFilter presets={PRESETS} value={range} onChange={setRange} />
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
                  <th className="right">Cost / lead</th>
                  <th className="right">Sold</th>
                  <th className="right">Cost / sale</th>
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
                    <td className="right mono">
                      {s.costPerLead === null ? (
                        <span className="ur-add-phone">no cost set</span>
                      ) : (
                        <>
                          {money(s.costPerLead)}
                          {/* Says how much of the source the average
                              actually covers. Without it, one priced lead
                              out of two hundred reads as the price of the
                              whole source. */}
                          {s.costKnown < s.count && (
                            <div className="ur-add-phone">
                              {s.costKnown} of {s.count} priced
                            </div>
                          )}
                        </>
                      )}
                    </td>
                    <td className="right mono">
                      {s.sold}
                      {s.revenue > 0 && (
                        <div className="ur-add-phone">{money(s.revenue / 100)}</div>
                      )}
                    </td>
                    <td className="right mono">
                      {s.costPerSale === null ? "—" : money(s.costPerSale)}
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
                          {/* Carries the period already chosen above, so
                              the report opens on the same window being
                              looked at rather than its own default.
                              stopPropagation because the row itself is
                              the expand toggle. */}
                          <Link
                            href={`/marketing-analytics/rep-report?rep=${rep.id}&${rangeQuery}`}
                            className="rep-report-link"
                            onClick={(e) => e.stopPropagation()}
                            title="Open the printable funnel report for this rep"
                          >
                            Report →
                          </Link>
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

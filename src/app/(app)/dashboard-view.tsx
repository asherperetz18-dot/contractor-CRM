"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DateRangeFilter, type RangeState } from "@/components/date-range-filter";
import { HBarRows } from "@/components/charts/hbar-rows";
import { MonthlyMoney } from "@/components/charts/monthly-money";
import { Sparkline } from "@/components/charts/sparkline";
import { getDashboardRollup, saveDashboardPanelOrder } from "@/lib/actions/dashboard";
import {
  DASHBOARD_PANELS,
  mergePanelOrder,
  type DashboardPanelKey,
} from "@/lib/data/dashboard-layout";
import type { DashboardRollup } from "@/lib/data/dashboard-rollup";
import { describeWindow, isoDay, resolveWindow } from "@/lib/data/date-range";
import { moveBefore } from "@/lib/data/funnel-order";
import {
  leadDisplayName,
  money,
  stageColor,
  type Event,
  type Lead,
  type PipelineStageRow,
} from "@/lib/data/types";
import { useDashboardOrder } from "./dashboard-order-prefs";
import { useInboxCount } from "./use-inbox-count";
import { UpcomingAppointments } from "./upcoming-appointments";

const PRESETS = [
  { key: "month", label: "This month" },
  { key: "30", label: "Last 30 days" },
  { key: "quarter", label: "This quarter" },
  { key: "12m", label: "Last 12 months" },
];
const PRESET_LABELS: Record<string, string> = Object.fromEntries(
  PRESETS.map((p) => [p.key, p.label])
);

const cents = (v: number) => money(v / 100);

function talkTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const min = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${min}m` : `${min}m`;
}

/**
 * Change against the previous period, colored by direction (every
 * headline here is up-is-good). A brand-new number has nothing to
 * compare to, and says so instead of showing an infinite percent.
 */
function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (prev <= 0) {
    return <span className="dash-delta muted">{cur > 0 ? "new" : "—"}</span>;
  }
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return <span className="dash-delta muted">±0%</span>;
  return (
    <span className={"dash-delta " + (pct > 0 ? "up" : "down")}>
      {pct > 0 ? "▲" : "▼"} {Math.abs(pct)}%
    </span>
  );
}

export function DashboardView({
  initialRollup,
  savedPanelOrder,
  canMoney,
  stages,
  repNames,
  recentLeads,
  nextEvents,
}: {
  initialRollup: DashboardRollup;
  savedPanelOrder: string[] | null;
  canMoney: boolean;
  stages: PipelineStageRow[];
  repNames: Record<string, string>;
  recentLeads: Lead[];
  nextEvents: Event[];
}) {
  const [range, setRange] = useState<RangeState>({ preset: "month", from: "", to: "" });
  // Fixed at mount, same as Marketing Analytics: a "now" read during
  // render moves the window under the user between re-renders.
  const [now] = useState(() => new Date());
  const win = useMemo(() => resolveWindow(range, now), [range, now]);

  // The server rendered the default window; picking another range asks
  // again. Stale answers are discarded by request id -- the same idiom
  // as Marketing Analytics and the topbar search.
  const [rollup, setRollup] = useState<DashboardRollup>(initialRollup);
  const [refreshing, setRefreshing] = useState(false);
  const requestIdRef = useRef(0);
  const firstWinRef = useRef(true);
  useEffect(() => {
    if (firstWinRef.current) {
      firstWinRef.current = false;
      return;
    }
    const requestId = ++requestIdRef.current;
    setRefreshing(true);
    getDashboardRollup(win)
      .then((r) => {
        if (requestIdRef.current !== requestId) return;
        setRollup(r);
        setRefreshing(false);
      })
      .catch(() => {
        if (requestIdRef.current === requestId) setRefreshing(false);
      });
  }, [win]);

  // Panel order: the profile's saved order first (follows the login),
  // this browser's localStorage as fallback and pre-migration path --
  // the estimates funnel's exact arrangement.
  const [accountOrder, setAccountOrder] = useState<string[] | null>(savedPanelOrder);
  const [browserOrder, setBrowserOrder] = useDashboardOrder();
  const displayOrder = mergePanelOrder(accountOrder ?? browserOrder);
  const [draggedPanel, setDraggedPanel] = useState<DashboardPanelKey | null>(null);
  const [dragOverPanel, setDragOverPanel] = useState<DashboardPanelKey | null>(null);

  function dropPanel(onto: DashboardPanelKey) {
    if (!draggedPanel) return;
    const next = mergePanelOrder(moveBefore(displayOrder, draggedPanel, onto));
    // Applied locally at once, kept in the browser too, and saved to
    // the profile so every device follows. A failed save is quiet: the
    // order on screen is already right and the browser copy holds it.
    setAccountOrder(next);
    setBrowserOrder(next);
    void saveDashboardPanelOrder(next);
  }

  const inboxCount = useInboxCount();
  const R = rollup;
  const periodLabel = describeWindow(range, PRESET_LABELS);

  // Stage panel: its own touch cutoff, all four served by the same
  // rollup so switching is instant.
  const [stageCutoff, setStageCutoff] = useState<"d30" | "d60" | "d90" | "all">("d90");

  const winRate = R.window.leads > 0 ? (R.funnel.signed / R.window.leads) * 100 : 0;

  const spark = (pick: (m: DashboardRollup["months"][number]) => number) =>
    R.months.map((m) => pick(m));

  // The rep-report link carries the window being looked at, same as
  // Marketing Analytics: without it the two pages disagree about the
  // same rep.
  const repRangeQuery = `from=${win.from ?? ""}&to=${win.to ?? isoDay(now)}`;

  function renderPanel(key: DashboardPanelKey) {
    const def = DASHBOARD_PANELS.find((p) => p.key === key);
    if (!def) return null;
    if (def.financial && !canMoney) return null;

    let body: ReactNode = null;
    let sub: ReactNode = null;
    let head: ReactNode = null;

    if (key === "sales-cash") {
      sub = "last 12 months";
      head = (
        <span className="dash-legend">
          <span className="dash-key">
            <i style={{ background: "var(--dash-chart-blue)" }} /> Contracts signed
          </span>
          <span className="dash-key">
            <i className="dash-key-line" style={{ background: "var(--dash-chart-green)" }} />{" "}
            Cash collected
          </span>
        </span>
      );
      const flat = R.months.every((m) => m.signedCents === 0 && m.collectedCents === 0);
      body = flat ? (
        <p className="empty-hint">No signed contracts or payments in the last 12 months.</p>
      ) : (
        <>
          <MonthlyMoney months={R.months} />
          <p className="dash-note">
            The gap between bars and line is money sold but not yet collected.
          </p>
        </>
      );
    } else if (key === "funnel") {
      sub = periodLabel.toLowerCase();
      const f = R.funnel;
      const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");
      const frac = (v: number) => (f.leads > 0 ? v / f.leads : 0);
      body =
        f.leads === 0 ? (
          <p className="empty-hint">No leads in this range.</p>
        ) : (
          <>
            <HBarRows
              rows={[
                { key: "in", label: "Leads in", frac: 1, color: "var(--dash-ramp-1)", right: String(f.leads) },
                { key: "appt", label: "Appointment set", frac: frac(f.withAppt), color: "var(--dash-ramp-2)", right: `${f.withAppt} · ${pct(f.withAppt, f.leads)}` },
                { key: "est", label: "Estimate sent", frac: frac(f.estimated), color: "var(--dash-ramp-3)", right: `${f.estimated} · ${pct(f.estimated, f.withAppt)}` },
                { key: "signed", label: "Signed", frac: frac(f.signed), color: "var(--dash-ramp-4)", right: `${f.signed} · ${pct(f.signed, f.estimated)}` },
              ]}
            />
            <p className="dash-note">
              Percentages are conversion from the step above. A sale is a signed contract, same
              rule as Marketing Analytics.
            </p>
          </>
        );
    } else if (key === "stages") {
      sub = "open pipeline, right now";
      head = (
        <select
          className="dash-panel-select"
          value={stageCutoff}
          onChange={(e) => setStageCutoff(e.target.value as typeof stageCutoff)}
          aria-label="Only count leads worked recently"
        >
          <option value="d30">Worked in last 30 days</option>
          <option value="d60">Worked in last 60 days</option>
          <option value="d90">Worked in last 90 days</option>
          <option value="all">All open leads</option>
        </select>
      );
      const orderIndex = new Map(stages.map((s, i) => [s.name, i]));
      const rows = R.stages
        .map((s) => ({ stage: s.stage, ...s.buckets[stageCutoff] }))
        .filter((s) => s.count > 0)
        .sort(
          (a, b) => (orderIndex.get(a.stage) ?? 99) - (orderIndex.get(b.stage) ?? 99)
        );
      const maxValue = Math.max(1, ...rows.map((s) => s.value));
      body =
        rows.length === 0 ? (
          <p className="empty-hint">Nothing in the pipeline for this cutoff.</p>
        ) : (
          <>
            <HBarRows
              rows={rows.map((s) => ({
                key: s.stage,
                label: (
                  <>
                    <span
                      className="dash-stage-dot"
                      style={{ background: stageColor(stages, s.stage) }}
                    />
                    {s.stage}
                  </>
                ),
                frac: s.value / maxValue,
                color: "var(--dash-chart-blue)",
                right: (
                  <>
                    {money(s.value)} <small>· {s.count}</small>
                  </>
                ),
              }))}
            />
            <p className="dash-note">
              <Link href="/pipeline">Open the pipeline board →</Link>
            </p>
          </>
        );
    } else if (key === "sources") {
      sub = periodLabel.toLowerCase();
      const top = R.sources.slice(0, 5);
      const rest = R.sources.slice(5);
      const other =
        rest.length > 0
          ? rest.reduce(
              (acc, s) => ({
                source: "Other",
                count: acc.count + s.count,
                signedCount: acc.signedCount + s.signedCount,
                signedCents: acc.signedCents + s.signedCents,
              }),
              { source: "Other", count: 0, signedCount: 0, signedCents: 0 }
            )
          : null;
      const rows = other ? [...top, other] : top;
      const maxCount = Math.max(1, ...rows.map((s) => s.count));
      body =
        rows.length === 0 ? (
          <p className="empty-hint">No leads in this range.</p>
        ) : (
          <>
            <HBarRows
              rows={rows.map((s) => ({
                key: s.source,
                label: s.source,
                frac: s.count / maxCount,
                color: s.source === "Other" ? "var(--dash-spark)" : "var(--dash-chart-blue)",
                right: (
                  <>
                    {s.count}
                    {s.signedCents > 0 && <small> · {cents(s.signedCents)} signed</small>}
                  </>
                ),
              }))}
            />
            <p className="dash-note">
              Cost per lead and per sale stay on{" "}
              <Link href="/marketing-analytics">Marketing Analytics →</Link>
            </p>
          </>
        );
    } else if (key === "aging") {
      sub = "right now · same math as Payments";
      const a = R.aging;
      const rows = [
        { key: "current", label: "Not yet due", v: a.notYetDueCents, color: "var(--dash-ramp-1)" },
        { key: "l30", label: "1–30 days late", v: a.late1_30Cents, color: "var(--dash-ramp-2)" },
        { key: "l60", label: "31–60 days late", v: a.late31_60Cents, color: "var(--dash-ramp-3)" },
        { key: "l90", label: "Over 60 days late", v: a.late61PlusCents, color: "var(--dash-ramp-4)" },
      ];
      const maxV = Math.max(1, ...rows.map((r) => r.v));
      const overdueTotal = a.late1_30Cents + a.late31_60Cents + a.late61PlusCents;
      body =
        maxV <= 1 ? (
          <p className="empty-hint">Nothing billed and unpaid right now.</p>
        ) : (
          <>
            <HBarRows
              rows={rows.map((r) => ({
                key: r.key,
                label: r.label,
                frac: r.v / maxV,
                color: r.color,
                right: cents(r.v),
              }))}
            />
            {overdueTotal > 0 && (
              <Link href="/payments" className="dash-overdue-chip">
                ⚠ {cents(overdueTotal)} overdue · {a.overdueCount}{" "}
                {a.overdueCount === 1 ? "payment" : "payments"}
              </Link>
            )}
          </>
        );
    } else if (key === "team") {
      sub = periodLabel.toLowerCase();
      const rows = R.team.slice(0, 6);
      body =
        rows.length === 0 ? (
          <p className="empty-hint">No signed contracts or appointments in this range.</p>
        ) : (
          <table className="data-table dash-team-table">
            <thead>
              <tr>
                <th>Rep</th>
                <th className="right">Signed</th>
                <th className="right">Wins</th>
                <th className="right">Appts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.rep}>
                  <td>
                    <Link
                      href={`/marketing-analytics/rep-report?rep=${t.rep}&${repRangeQuery}`}
                      title="Open this rep's printable report"
                    >
                      {repNames[t.rep] || "Unnamed"}
                    </Link>
                  </td>
                  <td className="right mono">{cents(t.signedCents)}</td>
                  <td className="right mono">{t.signedCount}</td>
                  <td className="right mono">{t.appts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        );
    } else if (key === "calls") {
      sub = periodLabel.toLowerCase();
      const c = R.calls;
      const maxDay = Math.max(1, ...c.perDay.map((d) => d.dials));
      body = (
        <>
          <div className="dash-mini-stats">
            <div>
              <div className="dash-mini-value mono">{c.dials}</div>
              <div className="dash-mini-label">Dials</div>
            </div>
            <div>
              <div className="dash-mini-value mono">
                {c.dials > 0 ? Math.round((c.connected / c.dials) * 100) : 0}%
              </div>
              <div className="dash-mini-label">Connected</div>
            </div>
            <div>
              <div className="dash-mini-value mono">{talkTime(c.talkSeconds)}</div>
              <div className="dash-mini-label">Talk time</div>
            </div>
          </div>
          <div className="dash-daybars" aria-label="Dials per day, last 14 days">
            {c.perDay.map((d) => (
              <span
                key={d.day}
                className="dash-daybar"
                style={{ height: `${Math.max(8, (d.dials / maxDay) * 100)}%` }}
                title={`${d.day}: ${d.dials} dials`}
              />
            ))}
          </div>
          <p className="dash-note">
            Last 14 days by day · <Link href="/call-reports">Call reports →</Link>
          </p>
        </>
      );
    } else if (key === "production") {
      const p = R.production;
      body = (
        <>
          <ul className="dash-list">
            <li>
              <span style={{ flex: 1 }}>In progress</span>
              <span className="mono">{p.inProgress}</span>
            </li>
            <li>
              <span style={{ flex: 1 }}>Not started</span>
              <span className="mono">{p.notStarted}</span>
            </li>
            <li>
              <span style={{ flex: 1 }}>On hold</span>
              <span className="mono">{p.onHold}</span>
            </li>
            <li>
              <span style={{ flex: 1 }}>Finished in this period</span>
              <span className="mono">{p.completedInWindow}</span>
            </li>
          </ul>
          <Link href="/production" className="btn-ghost small" style={{ display: "inline-block" }}>
            Production Board
          </Link>
        </>
      );
    } else if (key === "recent-leads") {
      body = recentLeads.length ? (
        <>
          <ul className="dash-list">
            {recentLeads.map((l) => (
              <li key={l.id}>
                <span style={{ flex: 1 }}>{leadDisplayName(l)}</span>
                <span className="mono">{money(l.value)}</span>
              </li>
            ))}
          </ul>
          <Link href="/pipeline" className="btn-ghost small" style={{ display: "inline-block" }}>
            View Pipeline
          </Link>
        </>
      ) : (
        <p className="empty-hint">Nothing here yet.</p>
      );
    } else if (key === "appointments") {
      body = (
        <>
          <UpcomingAppointments events={nextEvents} />
          <Link href="/schedule" className="btn-ghost small" style={{ display: "inline-block" }}>
            View Schedule
          </Link>
        </>
      );
    }

    return (
      <div
        key={key}
        className={
          "dash-panel dash-panel-box" +
          (def.wide ? " dash-panel-wide" : "") +
          (dragOverPanel === key && draggedPanel !== key ? " dash-panel-dragover" : "") +
          (draggedPanel === key ? " dash-panel-dragging" : "")
        }
        onDragOver={(ev) => {
          ev.preventDefault();
          setDragOverPanel(key);
        }}
        onDragLeave={() => setDragOverPanel((cur) => (cur === key ? null : cur))}
        onDrop={(ev) => {
          ev.preventDefault();
          dropPanel(key);
        }}
      >
        <div
          className="dash-panel-head"
          draggable
          title="Drag to move this box"
          onDragStart={() => setDraggedPanel(key)}
          onDragEnd={() => {
            setDraggedPanel(null);
            setDragOverPanel(null);
          }}
        >
          <span className="dash-grip" aria-hidden="true">
            ⠿
          </span>
          <h3>{def.title}</h3>
          {sub && <span className="dash-panel-sub">{sub}</span>}
          {head}
        </div>
        {body}
      </div>
    );
  }

  const attention = [
    {
      key: "tasks",
      show: true,
      href: "/tasks",
      alarm: R.attention.overdueTasks > 0,
      value: String(R.attention.overdueTasks),
      label: "Overdue tasks",
    },
    {
      key: "overdue",
      show: canMoney,
      href: "/payments",
      alarm: R.attention.overdueOwedCents > 0,
      value: cents(R.attention.overdueOwedCents),
      label: `Overdue payments · ${R.attention.overdueOwedCount} ${
        R.attention.overdueOwedCount === 1 ? "phase" : "phases"
      }`,
    },
    {
      key: "awaiting",
      show: true,
      href: "/estimates",
      alarm: false,
      value: cents(R.attention.awaitingCents),
      label: `Awaiting signature · ${R.attention.awaitingCount} ${
        R.attention.awaitingCount === 1 ? "contract" : "contracts"
      }`,
    },
    {
      key: "replies",
      show: inboxCount > 0,
      href: "/reply-inbox",
      alarm: false,
      value: String(inboxCount),
      label: "Replies waiting",
    },
    {
      key: "today",
      show: true,
      href: "/schedule",
      alarm: false,
      value: String(R.attention.apptsToday),
      label: "Appointments today",
    },
  ].filter((c) => c.show);

  return (
    <div className="dash-desktop">
      <div className="dash-filter-row">
        <DateRangeFilter presets={PRESETS} value={range} onChange={setRange} />
        {refreshing && <span className="empty-hint">Updating…</span>}
      </div>

      <div className="dash-attn-grid">
        {attention.map((c) => (
          <Link key={c.key} href={c.href} className="stat-card dash-attn-card">
            {/* Two lines, like the approved mockup: dot + number + a go
                arrow on top, the label in plain words underneath. As one
                inline run the number and label fused into "75OVERDUE
                TASKS". */}
            <span className="dash-attn-top">
              <span
                className={"dash-attn-dot" + (c.alarm ? " is-alarm" : "")}
                aria-hidden="true"
              />
              <span className="dash-attn-value mono">{c.value}</span>
              <span className="dash-attn-go" aria-hidden="true">
                →
              </span>
            </span>
            <span className="dash-attn-label">{c.label}</span>
          </Link>
        ))}
      </div>

      <div className="stat-grid stat-grid-5 dash-kpi-grid">
        <Link href="/pipeline" className="stat-card dash-kpi">
          <div className="stat-value">{R.window.leads}</div>
          <div className="stat-label">New leads</div>
          <div className="dash-kpi-foot">
            <Delta cur={R.window.leads} prev={R.prev.leads} />
          </div>
        </Link>
        <Link href="/schedule" className="stat-card dash-kpi">
          <div className="stat-value">{R.window.appts}</div>
          <div className="stat-label">Appointments</div>
          <div className="dash-kpi-foot">
            <Delta cur={R.window.appts} prev={R.prev.appts} />
          </div>
        </Link>
        <Link href="/estimates" className="stat-card dash-kpi">
          <div className="stat-value">{cents(R.window.signedCents)}</div>
          <div className="stat-label">Contracts signed · {R.window.signedCount}</div>
          <div className="dash-kpi-foot">
            <Delta cur={R.window.signedCents} prev={R.prev.signedCents} />
            <Sparkline values={spark((m) => m.signedCents)} />
          </div>
        </Link>
        {canMoney && (
          <Link href="/payments" className="stat-card dash-kpi">
            <div className="stat-value">{cents(R.window.collectedCents)}</div>
            <div className="stat-label">Cash collected</div>
            <div className="dash-kpi-foot">
              <Delta cur={R.window.collectedCents} prev={R.prev.collectedCents} />
              <Sparkline values={spark((m) => m.collectedCents)} />
            </div>
          </Link>
        )}
        <Link href="/marketing-analytics" className="stat-card dash-kpi">
          <div className="stat-value">{winRate.toFixed(1)}%</div>
          <div className="stat-label">Win rate</div>
          <div className="dash-kpi-foot">
            <span className="dash-delta muted" title="Signed contracts out of leads created in this period">
              {R.funnel.signed} of {R.window.leads}
            </span>
          </div>
        </Link>
      </div>

      <div className="dash-panel-grid">{displayOrder.map((key) => renderPanel(key))}</div>
    </div>
  );
}

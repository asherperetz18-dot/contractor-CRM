"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { DateRangeFilter, type RangeState } from "@/components/date-range-filter";
import { HBarRows } from "@/components/charts/hbar-rows";
import { Sparkline } from "@/components/charts/sparkline";
import { WeekColumns } from "@/components/charts/week-columns";
import { describeWindow, resolveWindow } from "@/lib/data/date-range";
import {
  getAnalyticsLeads,
  getMarketingAnalytics,
  getWonWithoutContract,
  type AnalyticsLead,
  type MarketingAnalytics,
} from "@/lib/actions/marketing-analytics";
import { sourceCost } from "@/lib/data/marketing-spend";
import type { RepRow, SourceRow } from "@/lib/data/marketing-rollup";
import { leadDisplayName, money, stageColor, type PipelineStageRow } from "@/lib/data/types";

const PRESETS = [
  { key: "7", label: "Last 7 Days" },
  { key: "30", label: "Last 30 Days" },
  { key: "90", label: "Last 90 Days" },
  { key: "all", label: "All Time" },
];
const PRESET_LABELS: Record<string, string> = Object.fromEntries(
  PRESETS.map((p) => [p.key, p.label])
);
const CLOSED = new Set(["Won", "Lost", "DNC"]);

/**
 * Change against the previous period, colored by direction (every
 * headline here is up-is-good). All Time has no previous period, so no
 * delta; a brand-new number says so instead of an infinite percent.
 */
function Delta({ cur, prev }: { cur: number; prev: number | null }) {
  if (prev === null) return null;
  if (prev <= 0) return <span className="dash-delta muted">{cur > 0 ? "new" : "—"}</span>;
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return <span className="dash-delta muted">±0%</span>;
  return (
    <span className={"dash-delta " + (pct > 0 ? "up" : "down")} title="vs. the previous period">
      {pct > 0 ? "▲" : "▼"} {Math.abs(pct)}%
    </span>
  );
}

/** A share with the precision it needs: 27%, 6.5%, 0.16%. */
function share(n: number, d: number): string {
  if (!d) return "0%";
  const v = (n / d) * 100;
  if (v >= 10) return `${Math.round(v)}%`;
  if (v >= 1) return `${v.toFixed(1)}%`;
  return `${v.toFixed(2)}%`;
}

const fmtInt = (n: number) => n.toLocaleString("en-US");
/** Whole dollars from cents -- the app's money() rounding, as the dashboard shows it. */
const cents = (v: number) => money(v / 100);

/** A plain YYYY-MM-DD is read as a local day; a timestamp as itself. */
function shortDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function daysBetween(from: string, to: string): number {
  return Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000));
}

function contactName(c: {
  contact_type: string | null;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
}): string {
  const person = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  if (c.contact_type === "Company" && c.company_name) return c.company_name;
  return person || c.company_name || "Unnamed";
}

export function AnalyticsView({
  initial,
  repNames,
  stages,
  canManageSpend,
}: {
  /** The default window's numbers, rendered with the page. */
  initial: MarketingAnalytics;
  repNames: Record<string, string>;
  stages: PipelineStageRow[];
  /** Office/Admin: may enter spend, so the empty cost tile links there. */
  canManageSpend: boolean;
}) {
  const [range, setRange] = useState<RangeState>({ preset: "30", from: "", to: "" });
  const [excludeBought, setExcludeBought] = useState(false);
  // Fixed at mount. A "now" read during render moves the window under the
  // user between re-renders, so the same list can come back different.
  const [now] = useState(() => new Date());
  const win = useMemo(() => resolveWindow(range, now), [range, now]);
  const allTime = !win.from && !win.to;

  // The server rendered the default window; any other range or toggle
  // asks again. Stale answers are discarded by request id, the topbar
  // search's idiom. Drill-downs belong to the window they were opened
  // on, so they reset with it.
  const [data, setData] = useState<MarketingAnalytics>(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedRep, setExpandedRep] = useState<string | null>(null);
  const [repLeads, setRepLeads] = useState<Record<string, AnalyticsLead[]>>({});
  const [wonOpen, setWonOpen] = useState(false);
  const [wonList, setWonList] = useState<AnalyticsLead[] | null>(null);
  const requestIdRef = useRef(0);
  const firstRef = useRef(true);
  useEffect(() => {
    if (firstRef.current) {
      firstRef.current = false;
      return;
    }
    const requestId = ++requestIdRef.current;
    setRefreshing(true);
    setRepLeads({});
    setExpandedRep(null);
    setWonList(null);
    setWonOpen(false);
    getMarketingAnalytics(win, { excludeBoughtLists: excludeBought })
      .then((next) => {
        if (requestIdRef.current !== requestId) return;
        setData(next);
        setRefreshing(false);
      })
      .catch(() => {
        if (requestIdRef.current === requestId) setRefreshing(false);
      });
  }, [win, excludeBought]);

  // A rep's leads arrive when their row is opened, never with the page.
  useEffect(() => {
    if (!expandedRep || repLeads[expandedRep]) return;
    let dead = false;
    const repId = expandedRep;
    getAnalyticsLeads(win, repId)
      .then((rows) => {
        if (!dead) setRepLeads((m) => ({ ...m, [repId]: rows }));
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [expandedRep, repLeads, win]);

  useEffect(() => {
    if (!wonOpen || wonList) return;
    let dead = false;
    getWonWithoutContract(win, { excludeBoughtLists: excludeBought })
      .then((rows) => {
        if (!dead) setWonList(rows);
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [wonOpen, wonList, win, excludeBought]);

  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const sourcesRef = useRef<HTMLElement | null>(null);
  const scrollToSources = () =>
    sourcesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  const R = data.rollup;
  const T = R.totals;
  const P = R.prev;
  const excluded = useMemo(
    () => new Set(excludeBought ? data.boughtListSources : []),
    [excludeBought, data.boughtListSources]
  );

  // The per-rep report opens on whatever period is being looked at here.
  const rangeQuery =
    range.from || range.to ? `from=${range.from}&to=${range.to}` : `days=${range.preset}`;
  const periodLabel = describeWindow(range, PRESET_LABELS);
  const repName = (id: string | null) => (id ? repNames[id] || "Unnamed" : "Unassigned");

  // Sources: the ones that did something this period on top; the tail
  // that produced neither an appointment, an estimate nor a sale folds
  // under one line, so the source that sells is never row nine.
  const alive = (s: SourceRow) => s.signed > 0 || s.withAppt > 0 || s.estimated > 0;
  const liveSources = R.bySource.filter(alive);
  const quietSources = R.bySource.filter((s) => !alive(s));
  const quietLeads = quietSources.reduce((s, x) => s + x.count, 0);
  const maxLeads = Math.max(1, ...R.bySource.map((s) => s.count));

  // Team: reps who only hold leads fold the same way.
  const active = (r: RepRow) => r.appts > 0 || r.estimates > 0 || r.signed > 0;
  const liveReps = R.byRep.filter(active);
  const quietReps = R.byRep.filter((r) => !active(r));

  // Stages in pipeline order; the closed ones summarized underneath.
  const stageOrder = new Map(stages.map((s, i) => [s.name, i]));
  const openStages = R.byStage
    .filter((s) => !CLOSED.has(s.stage))
    .sort((a, b) => (stageOrder.get(a.stage) ?? 99) - (stageOrder.get(b.stage) ?? 99));
  const maxStage = Math.max(1, ...openStages.map((s) => s.count));
  const closedCount = (name: string) => R.byStage.find((s) => s.stage === name)?.count ?? 0;

  const spendTracked = data.spendTotalCents > 0;
  const costPerSale = spendTracked && T.signed > 0 ? Math.round(data.spendTotalCents / T.signed) : null;
  const winRate = T.leads ? (T.signed / T.leads) * 100 : 0;
  const prevLabel =
    P && data.boundaries.prevFrom && data.boundaries.prevTo
      ? `${shortDate(data.boundaries.prevFrom)} – ${shortDate(data.boundaries.prevTo)}`
      : null;

  function renderSource(s: SourceRow, quiet: boolean) {
    const spendCents = data.spendBySource[s.source] ?? 0;
    const cost = sourceCost({
      spendCents,
      leads: s.count,
      signed: s.signed,
      leadCostDollars: s.spend,
      costKnown: s.costKnown,
      atDefault: s.atDefault,
    });
    let costNote: string | null = null;
    if (cost.basis === "spend") costNote = `from ${cents(spendCents)} spend`;
    else if (cost.basis === "lead_cost")
      costNote =
        s.atDefault > 0
          ? `${s.costKnown - s.atDefault} of ${s.count} priced by hand`
          : s.costKnown < s.count
            ? `${s.costKnown} of ${s.count} priced`
            : "priced by hand";
    return (
      <tr key={s.source} className={quiet ? "mkt-quiet" : undefined}>
        <td className={quiet ? undefined : "mkt-source"}>{s.source}</td>
        <td className="right mono">
          {fmtInt(s.count)}
          <span
            className="mkt-lead-bar"
            style={{ width: `${Math.max(1, (s.count / maxLeads) * 100)}%` }}
            aria-hidden="true"
          />
        </td>
        <td className="right mono">
          {s.withAppt}
          <span className="mkt-pct">{share(s.withAppt, s.count)}</span>
        </td>
        <td className="right mono">{s.estimated}</td>
        <td className="right mono">{s.signed > 0 ? <b>{s.signed}</b> : s.signed}</td>
        <td className="right mono">{s.signedCents > 0 ? <b>{cents(s.signedCents)}</b> : "—"}</td>
        <td className="right mono">
          {cost.costPerSaleCents === null ? (
            "—"
          ) : (
            <>
              {cents(cost.costPerSaleCents)}
              {cost.basis === "default" && <span className="mkt-pct">on default cost</span>}
            </>
          )}
        </td>
        <td className="right mono">
          {cost.basis === "none" || cost.costPerLeadCents === null ? (
            <span className="mkt-cost-default">no cost set</span>
          ) : cost.basis === "default" ? (
            <span className="mkt-cost-default">{cents(cost.costPerLeadCents)} default</span>
          ) : (
            <>
              {cents(cost.costPerLeadCents)}
              {costNote && <span className="mkt-pct">{costNote}</span>}
            </>
          )}
        </td>
      </tr>
    );
  }

  function renderRep(r: RepRow) {
    const open = expandedRep === r.rep;
    const rows = repLeads[r.rep];
    const shown = rows ? rows.filter((l) => !excluded.has(l.source || "Unknown")) : null;
    const decided = r.attended + r.noShow;
    return (
      <Fragment key={r.rep}>
        <tr
          className={"value-breakdown-row" + (open ? " is-open" : "")}
          onClick={() => setExpandedRep(open ? null : r.rep)}
          title={open ? "Hide these leads" : `Show ${repName(r.rep)}'s ${r.leads} leads`}
        >
          <td>
            <span className="value-breakdown-caret">{open ? "▾" : "▸"}</span> {repName(r.rep)}
          </td>
          <td className="right mono">{r.leads}</td>
          <td className="right mono">{r.appts}</td>
          <td className="right mono">
            {r.attended}
            {decided > 0 ? (
              <span className="mkt-pct">{share(r.attended, decided)} show</span>
            ) : r.noOutcome > 0 ? (
              <span className="mkt-pct">
                {r.noOutcome} no result
              </span>
            ) : null}
          </td>
          <td className="right mono">{r.estimates}</td>
          <td className="right mono">{r.signed > 0 ? <b>{r.signed}</b> : r.signed}</td>
          <td className="right mono">{r.signed > 0 ? <b>{cents(r.signedCents)}</b> : "—"}</td>
          <td className="right mono">
            {r.signed > 0 ? cents(Math.round(r.signedCents / r.signed)) : "—"}
          </td>
          <td className="right">
            {/* Carries the period already chosen above. stopPropagation
                because the row itself is the expand toggle. */}
            <Link
              href={`/marketing-analytics/rep-report?rep=${r.rep}&${rangeQuery}`}
              className="rep-report-link"
              onClick={(e) => e.stopPropagation()}
              title="Open the printable funnel report for this rep"
            >
              Report →
            </Link>
          </td>
        </tr>
        {open && (
          <tr className="value-breakdown-detail">
            <td colSpan={9}>
              {!shown ? (
                <p className="empty-hint">Loading…</p>
              ) : shown.length === 0 ? (
                <p className="empty-hint">No leads created in this range.</p>
              ) : (
                <div className="value-lead-list">
                  {[...shown]
                    .sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))
                    .map((l) => (
                      <a
                        key={l.id}
                        className="value-lead-row"
                        href={`/contacts?openLead=${l.id}&from=/marketing-analytics`}
                        title="Open this contact"
                      >
                        <span className="value-lead-name">{leadDisplayName(l)}</span>
                        <span className="value-lead-meta">
                          {l.phone || "no phone"} · {l.stage}
                          {l.source ? ` · ${l.source}` : ""}
                        </span>
                        <span className="mono value-lead-value">{money(l.value)}</span>
                      </a>
                    ))}
                </div>
              )}
            </td>
          </tr>
        )}
      </Fragment>
    );
  }

  const costEmptyNote = (
    <>
      Spend isn&apos;t tracked yet
      {T.atDefault > 0 && data.defaultCost
        ? `. ${fmtInt(T.atDefault)} of ${fmtInt(T.leads)} leads carry the ${money(data.defaultCost)} default`
        : ""}
      .
    </>
  );

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Marketing Analytics</h1>
          <p className="module-sub">Where leads come from, what they cost, and what they turned into</p>
        </div>
      </div>

      <div className="dash-filter-row">
        <DateRangeFilter presets={PRESETS} value={range} onChange={setRange} />
        {data.boughtListSources.length > 0 && (
          <button
            type="button"
            className={"chip" + (excludeBought ? " chip-active" : "")}
            aria-pressed={excludeBought}
            onClick={() => setExcludeBought((v) => !v)}
            title={`Bought lists: ${data.boughtListSources.join(", ")}`}
          >
            Exclude bought lists
          </button>
        )}
        <span className="mkt-period-note">
          {periodLabel}
          {prevLabel ? ` · compared with ${prevLabel}` : ""}
        </span>
        {refreshing && <span className="empty-hint">Updating…</span>}
      </div>

      <div className="stat-grid stat-grid-5 mkt-kpis">
        <button type="button" className="stat-card" onClick={scrollToSources} title="See these leads by source">
          <div className="stat-value">{fmtInt(T.leads)}</div>
          <div className="stat-label">Leads created</div>
          <div className="dash-kpi-foot">
            <Delta cur={T.leads} prev={P ? P.leads : null} />
            <span className="mkt-kpi-note">{money(T.leadValue)} estimated pipeline</span>
          </div>
        </button>
        <Link href="/schedule" className="stat-card" title="Open the schedule">
          <div className="stat-value">{fmtInt(T.withAppt)}</div>
          <div className="stat-label">Appointments booked</div>
          <div className="dash-kpi-foot">
            <Delta cur={T.withAppt} prev={P ? P.withAppt : null} />
            <span className="mkt-kpi-note">{share(T.withAppt, T.leads)} of leads</span>
          </div>
        </Link>
        <Link href="/estimates" className="stat-card" title="Open Estimates & Contracts">
          <div className="stat-value">
            {cents(T.signedCents)}
            <small>· {T.signed}</small>
          </div>
          <div className="stat-label">Signed contracts</div>
          <div className="dash-kpi-foot">
            <Delta cur={T.signedCents} prev={P ? P.signedCents : null} />
            <Sparkline values={R.weeks.map((w) => w.signedCents)} />
          </div>
        </Link>
        {spendTracked ? (
          <button type="button" className="stat-card" onClick={scrollToSources} title="See cost by source">
            <div className="stat-value">{costPerSale === null ? "—" : cents(costPerSale)}</div>
            <div className="stat-label">Cost per signed job</div>
            <div className="dash-kpi-foot">
              <span className="mkt-kpi-note">
                {cents(data.spendTotalCents)} spend{allTime ? "" : " this period"}
                {costPerSale === null ? " · no signed contract yet" : ""}
              </span>
            </div>
          </button>
        ) : canManageSpend ? (
          <Link href="/settings/lead-sources#spend" className="stat-card" title="Enter spend by source">
            <div className="stat-value mkt-empty-value">—</div>
            <div className="stat-label">Cost per signed job</div>
            <div className="dash-kpi-foot">
              <span className="mkt-kpi-note">
                {costEmptyNote} <u>Enter spend by source</u>
              </span>
            </div>
          </Link>
        ) : (
          <div className="stat-card stat-static">
            <div className="stat-value mkt-empty-value">—</div>
            <div className="stat-label">Cost per signed job</div>
            <div className="dash-kpi-foot">
              <span className="mkt-kpi-note">{costEmptyNote} The office enters spend by source.</span>
            </div>
          </div>
        )}
        <button
          type="button"
          className="stat-card"
          onClick={() => (T.wonNoContract > 0 ? setWonOpen((v) => !v) : scrollToSources())}
          title={
            T.wonNoContract > 0
              ? "Show the Won leads that have no signed contract"
              : "See the sources behind this rate"
          }
        >
          <div className="stat-value">
            {winRate >= 10 ? winRate.toFixed(0) : winRate >= 1 ? winRate.toFixed(1) : winRate.toFixed(2)}%
          </div>
          <div className="stat-label">Win rate</div>
          <div className="dash-kpi-foot">
            <span className="dash-delta muted">
              {fmtInt(T.signed)} signed of {fmtInt(T.leads)}
            </span>
            {T.wonNoContract > 0 && (
              <span className="mkt-flag">{fmtInt(T.wonNoContract)} at Won, no contract</span>
            )}
          </div>
        </button>
      </div>

      {wonOpen && (
        <section className="dash-panel mkt-won-panel" aria-labelledby="mkt-won">
          <div className="dash-panel-head">
            <h3 id="mkt-won">At Won with no signed contract</h3>
            <span className="dash-panel-sub">
              {periodLabel.toLowerCase()} · a stage set by hand, or a contract never entered
            </span>
            <button type="button" className="btn-ghost small mkt-head-btn" onClick={() => setWonOpen(false)}>
              Close
            </button>
          </div>
          {!wonList ? (
            <p className="empty-hint">Loading…</p>
          ) : wonList.length === 0 ? (
            <p className="empty-hint">Every Won lead in this period has a signed contract.</p>
          ) : (
            <div className="value-lead-list">
              {wonList.map((l) => (
                <a
                  key={l.id}
                  className="value-lead-row"
                  href={`/contacts?openLead=${l.id}&from=/marketing-analytics`}
                  title="Open this contact"
                >
                  <span className="value-lead-name">{leadDisplayName(l)}</span>
                  <span className="value-lead-meta">
                    {repName(l.assigned_to)}
                    {l.source ? ` · ${l.source}` : ""}
                    {l.won_at ? ` · won ${shortDate(l.won_at)}` : ""}
                  </span>
                  <span className="mono value-lead-value">{money(l.value)}</span>
                </a>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="mkt-grid">
        <section className="dash-panel" ref={sourcesRef} aria-labelledby="mkt-sources">
          <div className="dash-panel-head">
            <h3 id="mkt-sources">Sources</h3>
            <span className="dash-panel-sub">
              ranked by signed dollars, then appointments · revenue is signed contracts, change orders
              excluded
            </span>
          </div>
          {R.bySource.length === 0 ? (
            <p className="empty-hint">No leads in this range.</p>
          ) : (
            <div className="mkt-table-scroll">
              <table className="data-table mkt-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th className="right">Leads</th>
                    <th className="right">Appts</th>
                    <th className="right">Estimates</th>
                    <th className="right">Signed</th>
                    <th className="right">Signed $</th>
                    <th className="right">Cost / sale</th>
                    <th className="right">Cost / lead</th>
                  </tr>
                </thead>
                <tbody>
                  {liveSources.map((s) => renderSource(s, false))}
                  {quietSources.length > 0 && (
                    <tr className="mkt-fold">
                      <td colSpan={8}>
                        <button
                          type="button"
                          className="mkt-fold-btn"
                          onClick={() => setSourcesOpen((v) => !v)}
                          aria-expanded={sourcesOpen}
                        >
                          <span className="mkt-caret">{sourcesOpen ? "▾" : "▸"}</span>{" "}
                          {liveSources.length === 0 ? "" : `${quietSources.length} more `}
                          {liveSources.length === 0 ? `${quietSources.length} ` : ""}
                          source{quietSources.length === 1 ? "" : "s"} with no appointment, estimate or
                          sale · {fmtInt(quietLeads)} lead{quietLeads === 1 ? "" : "s"}
                        </button>
                      </td>
                    </tr>
                  )}
                  {sourcesOpen && quietSources.map((s) => renderSource(s, true))}
                </tbody>
              </table>
            </div>
          )}
          <p className="dash-note">
            Lead bars are scaled to the biggest source, so the sources that sell read as small as they
            are. A dashed cost is the company default nobody overrode.
            {data.boughtListSources.length === 0 && canManageSpend && (
              <>
                {" "}
                Flag bought lists in <Link href="/settings/lead-sources#spend">Settings › Lead sources</Link> to
                compare inbound alone.
              </>
            )}
          </p>
        </section>

        <section className="dash-panel" aria-labelledby="mkt-weeks">
          <div className="dash-panel-head">
            <h3 id="mkt-weeks">Week by week</h3>
            <span className="dash-panel-sub">
              last 12 weeks, Mondays{excludeBought ? " · bought lists excluded" : ""}
            </span>
          </div>
          <div className="mkt-chart-block">
            <div className="mkt-chart-title">
              <b>Leads created</b> <span>per week</span>
            </div>
            <WeekColumns
              points={R.weeks.map((w) => ({ week: w.week, value: w.leads }))}
              color="var(--dash-chart-blue)"
              lightColor="var(--dash-ramp-1)"
              unit="leads"
              label="Leads created per week, last 12 weeks"
            />
          </div>
          <div className="mkt-chart-block">
            <div className="mkt-chart-title">
              <b>Contracts signed</b> <span>per week, by signed date</span>
            </div>
            <WeekColumns
              points={R.weeks.map((w) => ({
                week: w.week,
                value: w.signed,
                detail: w.signedCents > 0 ? cents(w.signedCents) : undefined,
              }))}
              color="var(--dash-chart-green)"
              lightColor="#9cc7ae"
              unit="signed"
              label="Contracts signed per week, last 12 weeks"
            />
          </div>
          <p className="dash-note">
            The last column is the week in progress. Hover or tab to a column for its number.
          </p>
        </section>
      </div>

      <div className="mkt-grid">
        <section className="dash-panel" aria-labelledby="mkt-team">
          <div className="dash-panel-head">
            <h3 id="mkt-team">Sales team</h3>
            <span className="dash-panel-sub">
              this period&apos;s leads by assigned rep · appointments and contracts dated in it · a sale
              counts for the Sales team seats on the contract, as on the rep report
            </span>
          </div>
          {R.byRep.length === 0 ? (
            <p className="empty-hint">No assigned leads, appointments or contracts in this range.</p>
          ) : (
            <div className="mkt-table-scroll">
              <table className="data-table mkt-table mkt-team">
                <thead>
                  <tr>
                    <th>Rep</th>
                    <th className="right">Leads</th>
                    <th className="right">Appts</th>
                    <th className="right">Showed</th>
                    <th className="right">Estimates</th>
                    <th className="right">Signed</th>
                    <th className="right">Signed $</th>
                    <th className="right">Avg job</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {liveReps.map(renderRep)}
                  {quietReps.length > 0 && (
                    <tr className="mkt-fold">
                      <td colSpan={9}>
                        <button
                          type="button"
                          className="mkt-fold-btn"
                          onClick={() => setTeamOpen((v) => !v)}
                          aria-expanded={teamOpen}
                        >
                          <span className="mkt-caret">{teamOpen ? "▾" : "▸"}</span>{" "}
                          {liveReps.length === 0 ? "" : `${quietReps.length} more `}
                          {liveReps.length === 0 ? `${quietReps.length} ` : ""}
                          rep{quietReps.length === 1 ? "" : "s"} with leads but no appointment, estimate or
                          contract
                        </button>
                      </td>
                    </tr>
                  )}
                  {teamOpen && quietReps.map(renderRep)}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="dash-panel" aria-labelledby="mkt-stages">
          <div className="dash-panel-head">
            <h3 id="mkt-stages">Where this period&apos;s leads sit now</h3>
          </div>
          {openStages.length === 0 ? (
            <p className="empty-hint">Nothing open from this range.</p>
          ) : (
            <HBarRows
              rows={openStages.map((s) => ({
                key: s.stage,
                label: (
                  <>
                    <span className="dash-stage-dot" style={{ background: stageColor(stages, s.stage) }} />
                    {s.stage}
                  </>
                ),
                frac: s.count / maxStage,
                color: "var(--dash-chart-blue)",
                right: (
                  <>
                    {fmtInt(s.count)} <small>· {share(s.count, T.leads)}</small>
                  </>
                ),
              }))}
            />
          )}
          <p className="dash-note">
            Closed: <b>{fmtInt(closedCount("Won"))} Won</b> ({money(T.wonStageValue)} lead value) ·{" "}
            {fmtInt(closedCount("Lost"))} Lost · {fmtInt(closedCount("DNC"))} DNC.
            {T.wonNoContract > 0 && (
              <>
                {" "}
                {fmtInt(T.wonNoContract)} of the Won leads have no signed contract —{" "}
                <button type="button" className="mkt-link-btn" onClick={() => setWonOpen(true)}>
                  open those
                </button>
                .
              </>
            )}
          </p>
          <p className="dash-note">
            <Link href="/pipeline">Open the pipeline board →</Link>
          </p>
        </section>
      </div>

      <section className="dash-panel" aria-labelledby="mkt-signed">
        <div className="dash-panel-head">
          <h3 id="mkt-signed">Latest signed contracts</h3>
          <span className="dash-panel-sub">
            this period&apos;s leads, newest first · days to close counts from the lead&apos;s creation
          </span>
          <span className="dash-legend">
            <Link href="/estimates">All signed documents →</Link>
          </span>
        </div>
        {R.recentSigned.length === 0 ? (
          <div className="empty-state">
            <p className="empty-label">No signed contracts from this period&apos;s leads</p>
          </div>
        ) : (
          <div className="mkt-table-scroll">
            <table className="data-table mkt-table">
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Source</th>
                  <th>Rep</th>
                  <th className="right">Signed</th>
                  <th className="right">Contract</th>
                  <th className="right">Days to close</th>
                </tr>
              </thead>
              <tbody>
                {R.recentSigned.map((c) => (
                  <tr key={c.estimateId}>
                    <td>
                      <a
                        className="mkt-contact-link"
                        href={`/contacts?openLead=${c.leadId}&from=/marketing-analytics`}
                        title="Open this contact"
                      >
                        {contactName(c)}
                      </a>
                    </td>
                    <td className="mkt-muted">{c.source}</td>
                    <td>{repName(c.rep)}</td>
                    <td className="right mono">{shortDate(c.signedAt)}</td>
                    <td className="right mono">{cents(c.totalCents)}</td>
                    <td className="right mono">{daysBetween(c.createdAt, c.signedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

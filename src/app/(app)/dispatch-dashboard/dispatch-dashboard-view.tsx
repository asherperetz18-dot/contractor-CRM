"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { DateRangeFilter, type RangeState } from "@/components/date-range-filter";
import { HBarRows } from "@/components/charts/hbar-rows";
import { useTimeFormat } from "@/components/time-format-context";
import { getDispatchRollup } from "@/lib/actions/dispatch-dashboard";
import type { DispatchRollup, TodayVisit, WaitingBuckets } from "@/lib/data/dispatch-rollup";
import { resolveWindow } from "@/lib/data/date-range";
import { formatTimeRange } from "@/lib/data/types";
import { useInboxCount } from "../use-inbox-count";

const PRESETS = [
  { key: "today", label: "Today" },
  { key: "7", label: "Last 7 days" },
  { key: "month", label: "This month" },
  { key: "30", label: "Last 30 days" },
];

const BAR = "#2e6db3";
const BAR_LIGHT = "#8ab1d7";

const pct = (part: number, of: number) => (of > 0 ? Math.round((part / of) * 100) : null);
const pctText = (v: number | null) => (v === null ? "—" : `${v}%`);

/** "1h 12m" / "42 min" / "3 days" -- how long the oldest untouched lead has waited. */
function age(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  const days = Math.floor(minutes / (60 * 24));
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * Change against the previous period, colored by direction (every
 * headline here is up-is-good). A brand-new number has nothing to
 * compare to, and says so instead of showing an infinite percent.
 */
function DeltaCount({ cur, prev }: { cur: number; prev: number }) {
  if (prev <= 0) return <span className="dash-delta muted">{cur > 0 ? "new" : "—"}</span>;
  const p = Math.round(((cur - prev) / prev) * 100);
  if (p === 0) return <span className="dash-delta muted">±0%</span>;
  return (
    <span className={"dash-delta " + (p > 0 ? "up" : "down")}>
      {p > 0 ? "▲" : "▼"} {Math.abs(p)}%
    </span>
  );
}

/** A rate's change in points, not percent-of-percent. */
function DeltaPts({ cur, prev }: { cur: number | null; prev: number | null }) {
  if (cur === null || prev === null) return <span className="dash-delta muted">—</span>;
  const d = cur - prev;
  if (d === 0) return <span className="dash-delta muted">±0 pts</span>;
  return (
    <span className={"dash-delta " + (d > 0 ? "up" : "down")}>
      {d > 0 ? "▲" : "▼"} {Math.abs(d)} pts
    </span>
  );
}

/**
 * What a visit on today's board needs from the desk, as one pill. The
 * customer's yes is the first check (customer_confirmed, the reading
 * the calendar uses); the rep's own confirmation is the second; a
 * visit with no rep at all is the loudest.
 */
function visitPill(v: TodayVisit): { tone: "good" | "warn" | "bad"; text: string } {
  if (v.status === "No-show") return { tone: "bad", text: "No-show" };
  if (v.status === "Showed" || v.status === "Won") return { tone: "good", text: "Showed" };
  if (!v.assigned_to) return { tone: "bad", text: "No rep assigned" };
  if (!v.customer_confirmed) return { tone: "warn", text: "Awaiting customer" };
  if (!v.rep_confirmed) return { tone: "warn", text: "Rep not confirmed" };
  return { tone: "good", text: "Confirmed" };
}

const WAITING_LABELS: { key: keyof WaitingBuckets; label: string }[] = [
  { key: "under1", label: "Under 1 day" },
  { key: "d1_3", label: "1–3 days" },
  { key: "d4_7", label: "4–7 days" },
  { key: "d8_14", label: "8–14 days" },
  { key: "d15plus", label: "Over 14 days" },
];

function weekday(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  return isNaN(d.getTime()) ? day : d.toLocaleDateString("en-US", { weekday: "short" });
}

export function DispatchDashboardView({
  initialRollup,
  names,
}: {
  initialRollup: DispatchRollup;
  names: Record<string, string>;
}) {
  const [range, setRange] = useState<RangeState>({ preset: "7", from: "", to: "" });
  // Fixed at mount, like the main Dashboard: a "now" read during render
  // moves the window under the user between re-renders.
  const [now] = useState(() => new Date());
  const win = useMemo(() => resolveWindow(range, now), [range, now]);

  // The server rendered the default window; another range asks again,
  // stale answers discarded by request id.
  const [R, setR] = useState<DispatchRollup>(initialRollup);
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
    getDispatchRollup(win)
      .then((r) => {
        if (requestIdRef.current !== requestId) return;
        setR(r);
        setRefreshing(false);
      })
      .catch(() => {
        if (requestIdRef.current === requestId) setRefreshing(false);
      });
  }, [win]);

  const inboxCount = useInboxCount();
  const timeFormat = useTimeFormat();
  const name = (id: string | null) => (id ? names[id] || "Unnamed" : "");

  const reachedRate = pct(R.window.reachedWithinHour, R.window.leads);
  const prevReachedRate = pct(R.prev.reachedWithinHour, R.prev.leads);
  const bookRate = pct(R.window.booked, R.window.leads);
  const showRate = pct(R.window.showed, R.window.resolved);
  const prevShowRate = pct(R.prev.showed, R.prev.resolved);
  const connectRate = pct(R.window.connected, R.window.dials);

  const attention = [
    {
      key: "untouched",
      href: "/pipeline",
      alarm: R.attention.untouchedNew > 0,
      value: String(R.attention.untouchedNew),
      label:
        "New leads nobody has called or texted" +
        (R.attention.untouchedOldestMinutes !== null
          ? ` · oldest ${age(R.attention.untouchedOldestMinutes)}`
          : ""),
    },
    {
      key: "replies",
      href: "/reply-inbox",
      alarm: inboxCount > 0,
      value: String(inboxCount),
      label: "Replies waiting on us",
    },
    {
      key: "tasks",
      href: "/tasks",
      alarm: R.attention.overdueTasks > 0,
      value: String(R.attention.overdueTasks),
      label: "Overdue follow-ups",
    },
    {
      key: "unconfirmed",
      href: "/schedule",
      alarm: false,
      value: `${R.attention.todayUnconfirmed} of ${R.attention.todayTotal}`,
      label: "Today's appointments not yet confirmed",
    },
    {
      key: "results",
      href: "/appointment-reports",
      alarm: false,
      value: String(R.attention.resultsMissing),
      label: "Past appointments with no result logged",
    },
    {
      key: "pool",
      href: "/pipeline",
      alarm: false,
      value: String(R.attention.unclaimedPool),
      label: "Unclaimed leads in the pool",
    },
  ];

  const waitingMax = Math.max(1, ...WAITING_LABELS.map((w) => R.waiting[w.key]));
  const waitingTotal = WAITING_LABELS.reduce((s, w) => s + R.waiting[w.key], 0);
  const outcomesMax = Math.max(1, ...R.outcomes.map((o) => o.count));
  const outcomesTotal = R.outcomes.reduce((s, o) => s + o.count, 0);
  const weekMax = Math.max(1, ...R.week.map((d) => d.count));

  return (
    <div className="dash-desktop">
      <div className="dash-filter-row">
        <DateRangeFilter presets={PRESETS} value={range} onChange={setRange} />
        {refreshing && <span className="empty-hint">Updating…</span>}
      </div>

      <div className="dash-attn-grid">
        {attention.map((c) => (
          <Link key={c.key} href={c.href} className="stat-card dash-attn-card">
            <span className="dash-attn-top">
              <span className={"dash-attn-dot" + (c.alarm ? " is-alarm" : "")} aria-hidden="true" />
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
            <DeltaCount cur={R.window.leads} prev={R.prev.leads} />
          </div>
        </Link>
        <Link href="/call-reports" className="stat-card dash-kpi">
          <div className="stat-value">{pctText(reachedRate)}</div>
          <div className="stat-label">Reached within 1 hour</div>
          <div className="dash-kpi-foot">
            <DeltaPts cur={reachedRate} prev={prevReachedRate} />
            <span className="dd-kpi-sub">
              {R.window.medianMinutes === null
                ? "no first call or text yet"
                : `median ${age(R.window.medianMinutes)} to first call or text`}
            </span>
          </div>
        </Link>
        <Link href="/schedule" className="stat-card dash-kpi">
          <div className="stat-value">{R.window.booked}</div>
          <div className="stat-label">Appointments booked</div>
          <div className="dash-kpi-foot">
            <DeltaCount cur={R.window.booked} prev={R.prev.booked} />
            <span className="dd-kpi-sub">
              {bookRate === null ? "no new leads" : `${bookRate}% of new leads`}
            </span>
          </div>
        </Link>
        <Link href="/appointment-reports" className="stat-card dash-kpi">
          <div className="stat-value">{pctText(showRate)}</div>
          <div className="stat-label">Show rate</div>
          <div className="dash-kpi-foot">
            <DeltaPts cur={showRate} prev={prevShowRate} />
            <span className="dd-kpi-sub">
              {R.window.showed} showed of {R.window.resolved} with a result
            </span>
          </div>
        </Link>
        <Link href="/call-reports" className="stat-card dash-kpi">
          <div className="stat-value">{R.window.dials}</div>
          <div className="stat-label">Dials</div>
          <div className="dash-kpi-foot">
            <DeltaCount cur={R.window.dials} prev={R.prev.dials} />
            <span className="dd-kpi-sub">
              {connectRate === null ? "no calls" : `${connectRate}% connected`} · {R.window.texts}{" "}
              texts
            </span>
          </div>
        </Link>
      </div>

      <div className="dash-panel-grid">
        <div className="dash-panel">
          <div className="dash-panel-head">
            <h3>Today&apos;s appointments</h3>
            <span className="dash-panel-sub">
              {R.today.length} booked
            </span>
          </div>
          {R.today.length === 0 ? (
            <p className="empty-hint">Nothing on the calendar today.</p>
          ) : (
            <ul className="dash-list">
              {R.today.map((v) => {
                const pill = visitPill(v);
                return (
                  <li key={v.id}>
                    <span className="mono dd-time">
                      {v.time ? formatTimeRange(v.time, null, timeFormat) : "—"}
                    </span>
                    <span className="dd-grow">
                      <span className="dd-who">{v.lead_name ?? v.title ?? "Appointment"}</span>
                      {(v.title && v.lead_name) || v.assigned_to ? (
                        <span className="dd-sub">
                          {v.title && v.lead_name ? ` · ${v.title}` : ""}
                          {v.assigned_to ? ` · ${name(v.assigned_to)}` : ""}
                        </span>
                      ) : null}
                    </span>
                    <span className={"dd-pill dd-pill-" + pill.tone}>{pill.text}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <Link href="/schedule" className="btn-ghost small" style={{ display: "inline-block", marginTop: 10 }}>
            View Schedule
          </Link>
          <p className="dash-note">
            Confirmed means the customer replied yes; the rep&apos;s own confirmation is the second
            check.
          </p>
        </div>

        <div className="dash-panel">
          <div className="dash-panel-head">
            <h3>Next 7 days</h3>
            <span className="dash-panel-sub">appointments on the calendar</span>
          </div>
          <div
            className="dd-week"
            role="img"
            aria-label={
              "Appointments per day for the next seven days: " +
              R.week.map((d) => `${weekday(d.day)} ${d.count}`).join(", ")
            }
          >
            {R.week.map((d, i) => (
              <Link key={d.day} href="/calendar" className={"dd-day" + (i === 0 ? " is-today" : "")}>
                <span className="dd-day-n mono">{d.count}</span>
                <span
                  className="dd-day-bar"
                  style={{ height: `${Math.max(2, Math.round((d.count / weekMax) * 100))}%` }}
                />
                <span className="dd-day-label">{i === 0 ? "Today" : weekday(d.day)}</span>
              </Link>
            ))}
          </div>
          <p className="dash-note">Thin days are where the next bookings should land. A day opens the Calendar.</p>
        </div>

        <div className="dash-panel">
          <div className="dash-panel-head">
            <h3>Waiting for a first appointment</h3>
            <span className="dash-panel-sub">{waitingTotal} open · by days since received</span>
          </div>
          {waitingTotal === 0 ? (
            <p className="empty-hint">No lead of the last 90 days is waiting.</p>
          ) : (
            <HBarRows
              rows={WAITING_LABELS.map((w, i) => ({
                key: w.key,
                label: <Link href="/pipeline">{w.label}</Link>,
                frac: R.waiting[w.key] / waitingMax,
                // Darker as the wait gets longer: the tail is the story.
                color: i >= 3 ? BAR : BAR_LIGHT,
                right: R.waiting[w.key],
              }))}
            />
          )}
          <p className="dash-note">
            Leads in Unsorted, New Lead, Meta, No Answer or Contacted, received in the last 90 days.
          </p>
        </div>

        <div className="dash-panel">
          <div className="dash-panel-head">
            <h3>Call outcomes</h3>
            <span className="dash-panel-sub">{outcomesTotal} with an outcome</span>
          </div>
          {R.outcomes.length === 0 ? (
            <p className="empty-hint">No call outcomes logged in this period.</p>
          ) : (
            <HBarRows
              rows={R.outcomes.map((o) => ({
                key: o.disposition,
                label: <Link href="/call-reports">{o.disposition}</Link>,
                frac: o.count / outcomesMax,
                color: BAR,
                right: o.count,
              }))}
            />
          )}
          <p className="dash-note">Your own outcome names from Settings › Call Dispositions.</p>
        </div>

        <div className="dash-panel dash-panel-wide">
          <div className="dash-panel-head">
            <h3>The desk</h3>
            <span className="dash-panel-sub">per dispatcher · this period</span>
          </div>
          {R.desk.length === 0 ? (
            <p className="empty-hint">No dispatcher activity in this period.</p>
          ) : (
            <div className="dd-desk-scroll">
              <table className="dd-desk">
                <thead>
                  <tr>
                    <th>Dispatcher</th>
                    <th className="num">Leads received</th>
                    <th className="num">Waiting</th>
                    <th className="num">Dials</th>
                    <th className="num">Connected</th>
                    <th className="num">Booked</th>
                    <th className="num">Showed</th>
                    <th className="num">Book rate</th>
                  </tr>
                </thead>
                <tbody>
                  {R.desk.map((d) => (
                    <tr key={d.dispatcher}>
                      <td>
                        <Link href="/call-reports">{name(d.dispatcher)}</Link>
                      </td>
                      <td className="num mono">{d.leadsReceived}</td>
                      <td className="num mono">{d.leadsHeld}</td>
                      <td className="num mono">{d.dials}</td>
                      <td className="num mono">{d.connected}</td>
                      <td className="num mono">{d.booked}</td>
                      <td className="num mono">{d.showed}</td>
                      <td className="num mono">{pctText(pct(d.booked, d.leadsReceived))}</td>
                    </tr>
                  ))}
                  {R.attention.unclaimedPool > 0 && (
                    <tr className="dd-desk-pool">
                      <td>Unclaimed pool</td>
                      <td className="num mono">—</td>
                      <td className="num mono">{R.attention.unclaimedPool}</td>
                      <td className="num mono">—</td>
                      <td className="num mono">—</td>
                      <td className="num mono">—</td>
                      <td className="num mono">—</td>
                      <td className="num mono">—</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          <p className="dash-note">
            Book rate is appointments booked out of the dispatcher&apos;s leads received in the
            period. Waiting is their leads still without a first appointment. A dispatcher who is
            not a supervisor sees only their own numbers.
          </p>
        </div>
      </div>
    </div>
  );
}

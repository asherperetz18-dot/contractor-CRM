"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PAGE_REGISTRY, type ActivityEvent, type Profile } from "@/lib/data/types";
import { LeadsTouched } from "./leads-touched";
import { getLeadViewsInRange, type RangeLeadView } from "@/lib/actions/lead-touches";

type RangeKey = "today" | "7" | "30" | "90";
const RANGE_LABELS: Record<RangeKey, string> = {
  today: "Today",
  "7": "Last 7 Days",
  "30": "Last 30 Days",
  "90": "Last 90 Days",
};

function startOfRange(range: RangeKey): number {
  const now = new Date();
  if (range === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }
  const days = Number(range);
  return now.getTime() - days * 24 * 60 * 60 * 1000;
}

function dayKey(iso: string) {
  return iso.slice(0, 10);
}

// The tracker pings every 30s while the tab is visible, so a real,
// continuously-active stretch never has a gap much bigger than that
// between consecutive events. A gap larger than this means the tab was
// backgrounded/idle (no heartbeat fires), so that stretch shouldn't count
// as active time -- otherwise a tab left open in the background for hours
// inflates "active minutes" by the whole idle gap.
const MAX_ACTIVE_GAP_MINUTES = 2;

function sortByTime(events: ActivityEvent[]): ActivityEvent[] {
  return [...events].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

function activeMinutes(sortedEvents: ActivityEvent[]): number {
  let total = 0;
  for (let i = 1; i < sortedEvents.length; i++) {
    const delta =
      (new Date(sortedEvents[i].created_at).getTime() -
        new Date(sortedEvents[i - 1].created_at).getTime()) /
      60000;
    if (delta > 0 && delta <= MAX_ACTIVE_GAP_MINUTES) total += delta;
  }
  return total;
}

/**
 * Active minutes attributed to the page they were spent on.
 *
 * Each counted stretch belongs to the page the user was already on when it
 * started, which is why the earlier event's path is used rather than the
 * later one's -- otherwise time would be credited to whatever page they
 * happened to navigate to next.
 */
function minutesByPath(sortedEvents: ActivityEvent[], into: Map<string, number>) {
  for (let i = 1; i < sortedEvents.length; i++) {
    const delta =
      (new Date(sortedEvents[i].created_at).getTime() -
        new Date(sortedEvents[i - 1].created_at).getTime()) /
      60000;
    if (delta > 0 && delta <= MAX_ACTIVE_GAP_MINUTES) {
      const path = sortedEvents[i - 1].path || "(unknown)";
      into.set(path, (into.get(path) ?? 0) + delta);
    }
  }
}

function prettyPath(path: string): string {
  if (path === "/") return "Dashboard";
  const known = PAGE_REGISTRY.find((p) => p.href === path);
  if (known) return known.label;
  return path
    .split("/")
    .filter(Boolean)
    .map((s) => s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()))
    .join(" › ");
}

export function TeamActivityView({
  events,
  users,
}: {
  events: ActivityEvent[];
  users: Profile[];
}) {
  const [range, setRange] = useState<RangeKey>("today");
  const [userFilter, setUserFilter] = useState<string>("all");
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [openUser, setOpenUser] = useState<string | null>(null);
  const [rangeViews, setRangeViews] = useState<RangeLeadView[]>([]);

  // Lead-opens for the selected range, fetched once and reused by every
  // expanded page row.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await getLeadViewsInRange(new Date(startOfRange(range)).toISOString());
      if (!cancelled) setRangeViews(result.views ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [range]);

  const userName = (id: string) => users.find((u) => u.id === id)?.name || "Unknown";
  const userEmail = (id: string) => users.find((u) => u.id === id)?.email || "";

  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || "")),
    [users]
  );

  const filtered = useMemo(() => {
    const cutoff = startOfRange(range);
    return events.filter(
      (e) =>
        new Date(e.created_at).getTime() >= cutoff &&
        (userFilter === "all" || e.user_id === userFilter)
    );
  }, [events, range, userFilter]);

  const bySession = useMemo(() => {
    const map = new Map<string, ActivityEvent[]>();
    for (const e of filtered) {
      const list = map.get(e.session_id) ?? [];
      list.push(e);
      map.set(e.session_id, list);
    }
    return map;
  }, [filtered]);

  const sessionStats = useMemo(() => {
    return [...bySession.entries()].map(([sessionId, evs]) => {
      const sorted = sortByTime(evs);
      const times = sorted.map((e) => new Date(e.created_at).getTime());
      const minutes = activeMinutes(sorted);
      const userId = sorted[0].user_id;
      const pageviews = sorted.filter((e) => e.kind === "pageview").length;
      return { sessionId, userId, minutes, pageviews, lastActive: Math.max(...times) };
    });
  }, [bySession]);

  const activeUserIds = new Set(filtered.map((e) => e.user_id));
  const totalMinutes = sessionStats.reduce((s, sess) => s + sess.minutes, 0);
  const sessionCount = sessionStats.length;
  const avgSession = sessionCount ? totalMinutes / sessionCount : 0;
  const pageViewCount = filtered.filter((e) => e.kind === "pageview").length;

  const dailyActivity = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of filtered) {
      const key = dayKey(e.created_at);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);
  const maxDaily = Math.max(1, ...dailyActivity.map(([, c]) => c));

  const teamBreakdown = useMemo(() => {
    const perUser = new Map<
      string,
      { minutes: number; sessions: number; pages: number; lastActive: number }
    >();
    for (const sess of sessionStats) {
      const row = perUser.get(sess.userId) ?? {
        minutes: 0,
        sessions: 0,
        pages: 0,
        lastActive: 0,
      };
      row.minutes += sess.minutes;
      row.sessions += 1;
      row.pages += sess.pageviews;
      row.lastActive = Math.max(row.lastActive, sess.lastActive);
      perUser.set(sess.userId, row);
    }
    return [...perUser.entries()]
      .map(([userId, row]) => ({ userId, ...row }))
      .sort((a, b) => b.minutes - a.minutes);
  }, [sessionStats]);

  const topPages = useMemo(() => {
    const bySessionOrdered = [...bySession.values()].map(sortByTime);
    const views = new Map<string, number>();
    // Total active time per page, accumulated across every session, rather
    // than the old measure -- the gap to the single next event, which a
    // 30s heartbeat capped at ~0.5m no matter how long someone really
    // stayed, making the column look precise while saying nothing.
    const minutes = new Map<string, number>();
    for (const evs of bySessionOrdered) {
      for (const e of evs) {
        if (e.kind === "pageview") views.set(e.path, (views.get(e.path) ?? 0) + 1);
      }
      minutesByPath(evs, minutes);
    }
    const paths = new Set([...views.keys(), ...minutes.keys()]);
    return [...paths]
      .map((path) => ({
        path,
        views: views.get(path) ?? 0,
        minutes: minutes.get(path) ?? 0,
      }))
      .sort((a, b) => b.minutes - a.minutes || b.views - a.views)
      .slice(0, 12);
  }, [bySession]);

  /**
   * Who spent the time on one page, and when — the breakdown behind a single
   * Top Pages row.
   *
   * Note the minutes are read out of a full-session walk rather than measured
   * over events filtered to this path. minutesByPath works on the gap between
   * consecutive events, so filtering first would splice together visits that
   * were minutes or hours apart and credit this page with time nobody spent
   * on it.
   */
  const leadsForVisit = useMemo(() => {
    // Each lead-open belongs to whatever page that person was on -- opening
    // a lead is a modal, so the only link back to a page is the visit that
    // preceded it.
    const viewsByUser = new Map<string, RangeLeadView[]>();
    for (const v of rangeViews) {
      const list = viewsByUser.get(v.userId) ?? [];
      list.push(v);
      viewsByUser.set(v.userId, list);
    }

    // The window has to close at the persons next page view of ANY kind.
    // Closing it at their next visit to this same page instead swept up
    // everything they opened on other pages in between -- one Contacts
    // visit claimed 86 leads that were opened on the Pipeline.
    const pageviewsByUser = new Map<string, number[]>();
    for (const e of filtered) {
      if (e.kind !== "pageview") continue;
      const list = pageviewsByUser.get(e.user_id) ?? [];
      list.push(new Date(e.created_at).getTime());
      pageviewsByUser.set(e.user_id, list);
    }
    for (const list of pageviewsByUser.values()) list.sort((a, b) => a - b);

    return (userId: string, atMs: number) => {
      const stamps = pageviewsByUser.get(userId) ?? [];
      const endMs = stamps.find((t) => t > atMs) ?? Infinity;
      return (viewsByUser.get(userId) ?? []).filter((v) => {
        const t = new Date(v.openedAt).getTime();
        return t >= atMs && t < endMs;
      });
    };
  }, [rangeViews, filtered]);

  const pageDetail = useMemo(() => {
    if (!openPath) return null;

    const perUser = new Map<string, { minutes: number; views: number }>();
    for (const evs of bySession.values()) {
      const sorted = sortByTime(evs);
      const userId = sorted[0].user_id;

      const sessionMinutes = new Map<string, number>();
      minutesByPath(sorted, sessionMinutes);

      const minutes = sessionMinutes.get(openPath) ?? 0;
      const views = sorted.filter(
        (e) => e.kind === "pageview" && e.path === openPath
      ).length;
      if (minutes === 0 && views === 0) continue;

      const row = perUser.get(userId) ?? { minutes: 0, views: 0 };
      row.minutes += minutes;
      row.views += views;
      perUser.set(userId, row);
    }

    const byUser = [...perUser.entries()]
      .map(([userId, row]) => ({ userId, ...row }))
      .sort((a, b) => b.minutes - a.minutes || b.views - a.views);

    const visits = filtered
      .filter((e) => e.kind === "pageview" && e.path === openPath)
      .sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
      .slice(0, 20);

    return { byUser, visits };
  }, [openPath, bySession, filtered]);

  /** Each user's sessions, newest first — behind a Team row, and the whole
   *  panel when the User filter is narrowed to one person. */
  const sessionsByUser = useMemo(() => {
    const map = new Map<
      string,
      { sessionId: string; start: string; minutes: number; pages: string[] }[]
    >();
    for (const [sessionId, evs] of bySession.entries()) {
      const sorted = sortByTime(evs);
      const userId = sorted[0].user_id;
      const list = map.get(userId) ?? [];
      list.push({
        sessionId,
        start: sorted[0].created_at,
        minutes: activeMinutes(sorted),
        pages: sorted.filter((e) => e.kind === "pageview").map((e) => e.path),
      });
      map.set(userId, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());
    }
    return map;
  }, [bySession]);

  const sessionDetail = userFilter === "all" ? null : sessionsByUser.get(userFilter) ?? [];

  return (
    <div>
      <div className="ur-breadcrumb">
        <Link href="/settings" className="ur-crumb-link">
          ⚙ Settings
        </Link>
        <span> › </span>
        <span>Team Activity</span>
      </div>

      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Team Activity</h1>
          <p className="module-sub">Usage across your team, based on page activity</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <select
            className="ur-company-filter"
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
          >
            <option value="all">All Team Members</option>
            {sortedUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name || u.email}
              </option>
            ))}
          </select>
          <select
            className="ur-company-filter"
            value={range}
            onChange={(e) => setRange(e.target.value as RangeKey)}
          >
            {(Object.keys(RANGE_LABELS) as RangeKey[]).map((r) => (
              <option key={r} value={r}>
                {RANGE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="stat-grid stat-grid-5">
        <div className="stat-card stat-static">
          <div className="stat-value mono">{activeUserIds.size}</div>
          <div className="stat-label">Active Users</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{Math.round(totalMinutes)}</div>
          <div className="stat-label">Active Minutes</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{avgSession.toFixed(1)} min</div>
          <div className="stat-label">Avg Session</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{sessionCount}</div>
          <div className="stat-label">Sessions</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{pageViewCount}</div>
          <div className="stat-label">Page Views</div>
        </div>
      </div>

      <div className="ta-panel">
        <h3 className="ta-panel-title">Daily Activity</h3>
        {dailyActivity.length === 0 ? (
          <p className="empty-hint">No activity recorded in this range.</p>
        ) : (
          <div className="ta-bars">
            {dailyActivity.map(([day, count]) => (
              <div className="ta-bar-col" key={day} title={`${day}: ${count} events`}>
                <div
                  className="ta-bar"
                  style={{ height: `${(count / maxDaily) * 100}%` }}
                />
                <div className="ta-bar-label">{day.slice(5)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {userFilter === "all" ? (
        <div className="ta-panel">
          <h3 className="ta-panel-title">Team Breakdown</h3>
          {teamBreakdown.length === 0 ? (
            <p className="empty-hint">No activity recorded in this range.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Active Minutes</th>
                  <th>Sessions</th>
                  <th>Pages</th>
                  <th className="right">Last Active</th>
                </tr>
              </thead>
              <tbody>
                {teamBreakdown.map((row) => {
                  const open = openUser === row.userId;
                  const toggle = () => setOpenUser(open ? null : row.userId);
                  const sessions = sessionsByUser.get(row.userId) ?? [];
                  return (
                    <Fragment key={row.userId}>
                      <tr
                        className={`ta-drill${open ? " is-open" : ""}`}
                        role="button"
                        tabIndex={0}
                        aria-expanded={open}
                        onClick={toggle}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggle();
                          }
                        }}
                      >
                        <td>
                          <span className="ta-caret" aria-hidden="true">
                            {open ? "▾" : "▸"}
                          </span>
                          <span className="ur-name">{userName(row.userId)}</span>
                          <div className="ur-add-phone">{userEmail(row.userId)}</div>
                        </td>
                        <td className="mono">{Math.round(row.minutes)}m</td>
                        <td className="mono">{row.sessions}</td>
                        <td className="mono">{row.pages}</td>
                        <td className="right">
                          {new Date(row.lastActive).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </td>
                      </tr>

                      {open && (
                        <tr className="ta-drill-detail">
                          <td colSpan={5}>
                            <LeadsTouched
                              userId={row.userId}
                              userName={userName(row.userId)}
                              sinceISO={new Date(startOfRange(range)).toISOString()}
                            />
                            <h4 className="ta-drill-title">
                              Sessions — {userName(row.userId)}
                            </h4>
                            {sessions.length === 0 ? (
                              <p className="empty-hint">No sessions in this range.</p>
                            ) : (
                              <table className="data-table ta-drill-table">
                                <thead>
                                  <tr>
                                    <th>Session Start</th>
                                    <th>Duration</th>
                                    <th>Pages Visited</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {sessions.map((s) => (
                                    <tr key={s.sessionId}>
                                      <td className="ta-nowrap">
                                        {new Date(s.start).toLocaleString(undefined, {
                                          month: "short",
                                          day: "numeric",
                                          hour: "numeric",
                                          minute: "2-digit",
                                        })}
                                      </td>
                                      <td className="mono">{Math.round(s.minutes)}m</td>
                                      <td>
                                        <div className="ta-page-trail">
                                          {s.pages.join(" → ") || "—"}
                                        </div>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
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
      ) : (
        <div className="ta-panel">
          <h3 className="ta-panel-title">Session Detail — {userName(userFilter)}</h3>
          {!sessionDetail || sessionDetail.length === 0 ? (
            <p className="empty-hint">No activity recorded in this range.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Session Start</th>
                  <th>Duration</th>
                  <th>Pages Visited</th>
                </tr>
              </thead>
              <tbody>
                {sessionDetail.map((s) => (
                  <tr key={s.sessionId}>
                    <td className="ta-nowrap">
                      {new Date(s.start).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="mono">{Math.round(s.minutes)}m</td>
                    <td>
                      <div className="ta-page-trail">{s.pages.join(" → ") || "—"}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="ta-panel">
        <h3 className="ta-panel-title">Top Pages</h3>
        {topPages.length === 0 ? (
          <p className="empty-hint">No page views recorded in this range.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Page</th>
                <th>Opened</th>
                <th className="right">Active Time</th>
              </tr>
            </thead>
            <tbody>
              {topPages.map((p) => {
                const open = openPath === p.path;
                const toggle = () => setOpenPath(open ? null : p.path);
                return (
                  <Fragment key={p.path}>
                    <tr
                      className={`ta-drill${open ? " is-open" : ""}`}
                      role="button"
                      tabIndex={0}
                      aria-expanded={open}
                      onClick={toggle}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggle();
                        }
                      }}
                    >
                      <td>
                        <span className="ta-caret" aria-hidden="true">
                          {open ? "▾" : "▸"}
                        </span>
                        {prettyPath(p.path)}
                        <div className="ai-proposal-count">{p.path}</div>
                      </td>
                      <td className="mono">{p.views}</td>
                      <td className="right mono">
                        {p.minutes >= 1
                          ? `${p.minutes.toFixed(0)}m`
                          : `${Math.round(p.minutes * 60)}s`}
                      </td>
                    </tr>

                    {open && pageDetail && (
                      <tr className="ta-drill-detail">
                        <td colSpan={3}>
                          <div className="ta-drill-grid">
                            <div>
                              <h4 className="ta-drill-title">Who opened it</h4>
                              {pageDetail.byUser.length === 0 ? (
                                <p className="empty-hint">No activity in this range.</p>
                              ) : (
                                <table className="data-table ta-drill-table">
                                  <thead>
                                    <tr>
                                      <th>User</th>
                                      <th>Opened</th>
                                      <th className="right">Active Time</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {pageDetail.byUser.map((row) => (
                                      <tr key={row.userId}>
                                        <td>
                                          <div className="ur-name">{userName(row.userId)}</div>
                                          <div className="ai-proposal-count">
                                            {userEmail(row.userId)}
                                          </div>
                                        </td>
                                        <td className="mono">{row.views}</td>
                                        <td className="right mono">
                                          {row.minutes >= 1
                                            ? `${row.minutes.toFixed(0)}m`
                                            : `${Math.round(row.minutes * 60)}s`}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>

                            <div>
                              <h4 className="ta-drill-title">
                                Recent visits
                                {pageDetail.visits.length === 20 && " (latest 20)"}
                              </h4>
                              {pageDetail.visits.length === 0 ? (
                                <p className="empty-hint">
                                  Time was spent here, but no page-open was recorded in
                                  this range.
                                </p>
                              ) : (
                                <ul className="ta-visit-list">
                                  {pageDetail.visits.map((v) => {
                                    const atMs = new Date(v.created_at).getTime();
                                    const opened = leadsForVisit(v.user_id, atMs);
                                    const shown = opened.slice(0, 8);
                                    return (
                                      <li key={v.id}>
                                        <div className="ta-visit-head">
                                          <span className="mono">
                                            {new Date(v.created_at).toLocaleString(undefined, {
                                              month: "short",
                                              day: "numeric",
                                              hour: "numeric",
                                              minute: "2-digit",
                                            })}
                                          </span>
                                          <span>{userName(v.user_id)}</span>
                                        </div>
                                        {opened.length > 0 && (
                                          <div className="ta-visit-leads">
                                            {shown.map((o) => (
                                              <Link
                                                key={`${o.leadId}:${o.openedAt}`}
                                                href={`/pipeline?leadId=${o.leadId}`}
                                                className="touch-lead-chip"
                                              >
                                                {o.leadName}
                                              </Link>
                                            ))}
                                            {opened.length > shown.length && (
                                              <span className="touch-lead-more">
                                                +{opened.length - shown.length} more
                                              </span>
                                            )}
                                          </div>
                                        )}
                                      </li>
                                    );
                                  })}
                                </ul>
                              )}
                            </div>
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
  );
}

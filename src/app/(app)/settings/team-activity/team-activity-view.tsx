"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PAGE_REGISTRY, type ActivityEvent, type Profile } from "@/lib/data/types";

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

  const sessionDetail = useMemo(() => {
    if (userFilter === "all") return null;
    return [...bySession.entries()]
      .map(([sessionId, evs]) => {
        const sorted = sortByTime(evs);
        const start = sorted[0].created_at;
        const minutes = activeMinutes(sorted);
        const pages = sorted.filter((e) => e.kind === "pageview").map((e) => e.path);
        return { sessionId, start, minutes, pages };
      })
      .sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());
  }, [bySession, userFilter]);

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
                {teamBreakdown.map((row) => (
                  <tr key={row.userId}>
                    <td>
                      <div className="ur-name">{userName(row.userId)}</div>
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
                ))}
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
                    <td>
                      {new Date(s.start).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="mono">{Math.round(s.minutes)}m</td>
                    <td>{s.pages.join(" → ") || "—"}</td>
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
              {topPages.map((p) => (
                <tr key={p.path}>
                  <td>
                    {prettyPath(p.path)}
                    <div className="ai-proposal-count">{p.path}</div>
                  </td>
                  <td className="mono">{p.views}</td>
                  <td className="right mono">
                    {p.minutes >= 1 ? `${p.minutes.toFixed(0)}m` : `${Math.round(p.minutes * 60)}s`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

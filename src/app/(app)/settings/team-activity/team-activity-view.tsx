"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ActivityEvent, Profile } from "@/lib/data/types";

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

export function TeamActivityView({
  events,
  users,
}: {
  events: ActivityEvent[];
  users: Profile[];
}) {
  const [range, setRange] = useState<RangeKey>("today");

  const userName = (id: string) => users.find((u) => u.id === id)?.name || "Unknown";
  const userEmail = (id: string) => users.find((u) => u.id === id)?.email || "";

  const filtered = useMemo(() => {
    const cutoff = startOfRange(range);
    return events.filter((e) => new Date(e.created_at).getTime() >= cutoff);
  }, [events, range]);

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
      const times = evs.map((e) => new Date(e.created_at).getTime());
      const minutes = (Math.max(...times) - Math.min(...times)) / 60000;
      const userId = evs[0].user_id;
      const pageviews = evs.filter((e) => e.kind === "pageview").length;
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
    const bySessionOrdered = [...bySession.values()].map((evs) =>
      [...evs].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )
    );
    const perPage = new Map<string, { views: number; timeTotal: number; timeCount: number }>();
    for (const evs of bySessionOrdered) {
      for (let i = 0; i < evs.length; i++) {
        const e = evs[i];
        if (e.kind !== "pageview") continue;
        const row = perPage.get(e.path) ?? { views: 0, timeTotal: 0, timeCount: 0 };
        row.views += 1;
        const next = evs[i + 1];
        if (next) {
          const delta =
            (new Date(next.created_at).getTime() - new Date(e.created_at).getTime()) / 60000;
          if (delta > 0 && delta <= 30) {
            row.timeTotal += delta;
            row.timeCount += 1;
          }
        }
        perPage.set(e.path, row);
      }
    }
    return [...perPage.entries()]
      .map(([path, row]) => ({
        path,
        views: row.views,
        avgTime: row.timeCount ? row.timeTotal / row.timeCount : null,
      }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 10);
  }, [bySession]);

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

      <div className="ta-panel">
        <h3 className="ta-panel-title">Top Pages</h3>
        {topPages.length === 0 ? (
          <p className="empty-hint">No page views recorded in this range.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Page</th>
                <th>Views</th>
                <th className="right">Avg Time</th>
              </tr>
            </thead>
            <tbody>
              {topPages.map((p) => (
                <tr key={p.path}>
                  <td>{p.path}</td>
                  <td className="mono">{p.views}</td>
                  <td className="right mono">
                    {p.avgTime === null ? "—" : `${p.avgTime.toFixed(1)}m`}
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

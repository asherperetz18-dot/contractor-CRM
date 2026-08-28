"use client";

import { useEffect, useState } from "react";
import { getLiveUsers, type PresenceUser } from "@/lib/actions/presence";

const REFRESH_MS = 60000;

function summary(users: PresenceUser[]): string {
  const active = users.filter((u) => u.status === "active").length;
  const away = users.length - active;
  if (users.length === 0) return "Nobody online";
  const parts = [];
  if (active) parts.push(`${active} active`);
  if (away) parts.push(`${away} away`);
  return `${parts.join(", ")} (${users.length} online)`;
}

/**
 * The badge count arrives with the page, and the list refreshes only
 * while the panel is open.
 *
 * This used to call getLiveUsers() on mount and then every minute for
 * as long as the tab was open, whether or not anyone had opened the
 * panel. A server action is not a cheap fetch: it goes through the
 * proxy, re-runs the whole layout, and only then does its own work --
 * about a second and a half each, for a list nobody was looking at. The
 * layout already renders this button and can hand over the first
 * snapshot for free, alongside the queries it makes anyway.
 */
export function LiveUsersButton({ initialUsers }: { initialUsers: PresenceUser[] }) {
  const [users, setUsers] = useState<PresenceUser[]>(initialUsers);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      const result = await getLiveUsers();
      if (cancelled) return;
      setUsers(result.users ?? []);
    }
    load();
    // Polled rather than pushed: a 15-minute slice of activity_events is
    // a cheap query, and presence going a minute stale is harmless.
    const interval = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [open]);

  const label = summary(users);

  return (
    <div className="quick-create-wrap">
      <button
        className="icon-btn topbar-icon-btn presence-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Who's online — ${label}`}
        title={label}
      >
        👥
        {users.length > 0 && <span className="presence-badge">{users.length}</span>}
      </button>
      {open && (
        <>
          <div className="quick-create-backdrop" onClick={() => setOpen(false)} />
          <div className="quick-create-menu presence-menu">
            <div className="qc-group">
              <div className="qc-group-label">{label.toUpperCase()}</div>
              {users.length === 0 && (
                <div className="presence-row presence-empty">
                  No one has been active in the last 15 minutes.
                </div>
              )}
              {users.map((u) => (
                <div className="presence-row" key={u.id}>
                  <span className={`presence-dot presence-dot-${u.status}`}>●</span>
                  <span className="presence-name">{u.name}</span>
                  <span className="presence-when">
                    {u.status === "active"
                      ? "active now"
                      : `idle ${u.lastSeenMinutes}m`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

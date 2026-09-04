"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getNotifications,
  markNotificationsRead,
  type BellData,
  type BellItem,
} from "@/lib/actions/notifications";
import { FRESH_EVENT } from "./popup-alerts";
import { usePopupPrefs } from "./popup-prefs";
import { PopupPrefsPanel } from "./popup-toast-list";
import "./popup-alerts.css";

type Tab = "all" | "message" | "money" | "job";

const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "message", label: "Messages" },
  { key: "money", label: "Money" },
  { key: "job", label: "Jobs" },
];

function ago(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

/**
 * The topbar bell. The feed is computed server-side from the tables
 * that already hold the facts, so this component only has to ask,
 * badge what's newer than the reader's watermark, and get out of the
 * way. Polls lazily, and refreshes at once when the popup watcher says
 * something new just landed -- so the badge never lags the toast.
 */
export function NotificationBell() {
  const router = useRouter();
  const [data, setData] = useState<BellData | null>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("all");
  const [showPrefs, setShowPrefs] = useState(false);
  const [prefs, updatePrefs] = usePopupPrefs();

  useEffect(() => {
    let dead = false;
    const load = async () => {
      const res = await getNotifications();
      if (!dead && res.data) setData(res.data);
    };
    load();
    const timer = setInterval(load, 60000);
    const onFresh = () => void load();
    window.addEventListener(FRESH_EVENT, onFresh);
    return () => {
      dead = true;
      clearInterval(timer);
      window.removeEventListener(FRESH_EVENT, onFresh);
    };
  }, []);

  const items = data?.items ?? [];
  const seenAt = data?.seenAt ?? null;
  const isNew = (i: BellItem) => !seenAt || i.at > seenAt;
  const unseen = items.filter(isNew).length;
  const shown = tab === "all" ? items : items.filter((i) => i.kind === tab);

  async function markRead() {
    // Optimistic: the watermark moves locally right away, and the
    // server upsert catches the next device.
    const stamp = new Date().toISOString();
    setData((d) => (d ? { ...d, seenAt: stamp } : d));
    await markNotificationsRead();
  }

  return (
    <div className="quick-create-wrap">
      <button
        type="button"
        className="icon-btn topbar-icon-btn bell-btn"
        title="Notifications"
        aria-label="Notifications"
        onClick={() => setOpen((o) => !o)}
      >
        🔔
        {unseen > 0 && <span className="bell-badge">{unseen > 9 ? "9+" : unseen}</span>}
      </button>

      {open && (
        <>
          <div className="quick-create-backdrop" onClick={() => setOpen(false)} />
          <div className="quick-create-menu bell-menu">
            <div className="bell-head">
              <strong>Notifications</strong>
              <span className="bell-head-actions">
                <button type="button" className="btn-ghost small" onClick={markRead}>
                  ✓ Mark all read
                </button>
                <button
                  type="button"
                  className={"btn-ghost small" + (showPrefs ? " bell-prefs-open" : "")}
                  title="Which alerts pop up on your screen"
                  aria-expanded={showPrefs}
                  onClick={() => setShowPrefs((s) => !s)}
                >
                  ⚙ Popups
                </button>
              </span>
            </div>

            {showPrefs && <PopupPrefsPanel prefs={prefs} onChange={updatePrefs} />}

            {data?.summary && (
              <p className="bell-summary">
                <strong>Needs attention:</strong> {data.summary}
              </p>
            )}

            <div className="bell-tabs">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={"bell-tab" + (tab === t.key ? " bell-tab-active" : "")}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {shown.length === 0 ? (
              <p className="empty-hint" style={{ padding: "14px 12px" }}>
                You&apos;re all caught up.
              </p>
            ) : (
              <ul className="bell-list">
                {shown.map((i) => (
                  <li key={i.id}>
                    <button
                      type="button"
                      className="bell-item"
                      onClick={() => {
                        setOpen(false);
                        router.push(i.href);
                      }}
                    >
                      <span className="bell-item-icon">{i.icon}</span>
                      <span className="bell-item-main">
                        <span className="bell-item-title">
                          {i.title}
                          {isNew(i) && <span className="bell-dot" aria-label="new" />}
                        </span>
                        <span className="bell-item-body">{i.body}</span>
                        <span className="bell-item-time">{ago(i.at)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

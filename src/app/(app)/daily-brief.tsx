"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { money } from "@/lib/data/types";
import {
  getDailyBrief,
  type BriefPeriod,
  type BriefStats,
  type DailyBrief,
} from "@/lib/actions/daily-brief";

// Shown once a day. Keyed by date so it reappears each morning but never
// nags on every page load.
const SEEN_KEY = "crm-daily-brief-seen";

const PERIOD_LABEL: Record<BriefPeriod, string> = {
  today: "Today",
  week: "This Week",
  month: "This Month",
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function Metric({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="brief-metric">
      <div className="brief-metric-value mono">{value}</div>
      <div className="brief-metric-label">{label}</div>
      {hint && <div className="brief-metric-hint">{hint}</div>}
    </div>
  );
}

function StatsGrid({ s }: { s: BriefStats }) {
  const showRate = s.showed + s.noShow > 0 ? Math.round((s.showed / (s.showed + s.noShow)) * 100) : null;
  return (
    <>
      <div className="brief-metrics">
        <Metric label="Leads Added" value={s.leadsAdded} />
        <Metric label="Appointments Booked" value={s.apptsBooked} />
        <Metric label="Appointments Scheduled" value={s.apptsScheduled} />
        <Metric
          label="Showed / No-show"
          value={`${s.showed} / ${s.noShow}`}
          hint={showRate !== null ? `${showRate}% show rate` : undefined}
        />
        <Metric label="Calls" value={s.calls} hint={s.talkMinutes ? `${s.talkMinutes}m talk time` : undefined} />
        <Metric label="Texts Out / In" value={`${s.textsOut} / ${s.textsIn}`} />
        <Metric label="Tasks Completed" value={s.tasksCompleted} />
        <Metric
          label="Won"
          value={s.won}
          hint={s.wonValue > 0 ? money(s.wonValue) : undefined}
        />
      </div>
      {s.won > 0 && s.wonValue === 0 && (
        <p className="hint-note">
          {s.won} deal{s.won === 1 ? "" : "s"} won with no value recorded, so revenue shows as $0.
          Fill in Est. Value on the contact for this to be meaningful.
        </p>
      )}
    </>
  );
}

export function DailyBriefButton({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState<DailyBrief | null>(null);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<BriefPeriod>("today");
  // Derived rather than stored -- it's simply "open, with nothing to show
  // yet", so there's no second source of truth to keep in sync.
  const loading = open && !brief && !error;

  // Auto-open once a day, for admins only.
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled || typeof window === "undefined") return;
      if (window.localStorage.getItem(SEEN_KEY) === todayKey()) return;
      setOpen(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  useEffect(() => {
    if (!open || brief || error) return;
    let cancelled = false;
    (async () => {
      const result = await getDailyBrief();
      if (cancelled) return;
      if (result.error) setError(result.error);
      else if (result.brief) setBrief(result.brief);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, brief, error]);

  function close() {
    setOpen(false);
    if (typeof window !== "undefined") window.localStorage.setItem(SEEN_KEY, todayKey());
  }

  if (!isAdmin) return null;

  const a = brief?.attention;
  const attentionItems = a
    ? [
        { n: a.overdueTasks, label: "overdue task", href: "/pipeline" },
        { n: a.unconfirmedSoon, label: "unconfirmed appointment in the next 2 days", href: "/schedule" },
        { n: a.staleRefunds, label: "refund request open 30+ days", href: "/lead-refunds" },
      ].filter((x) => x.n > 0)
    : [];

  return (
    <>
      <button
        className="icon-btn topbar-icon-btn"
        onClick={() => setOpen(true)}
        aria-label="Daily Brief"
        title="Daily Brief"
      >
        📈
      </button>

      {open && (
        <Modal title="Daily Brief" onClose={close} wide>
          {loading && <p className="empty-hint">Building your brief…</p>}
          {error && <p className="error-note">{error}</p>}

          {brief && (
            <div className="brief">
              <div className="brief-head">
                <div>
                  <div className="brief-company">{brief.companyName}</div>
                  <div className="brief-date">
                    {new Date(brief.generatedAt).toLocaleString(undefined, {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              </div>

              {attentionItems.length > 0 && (
                <div className="brief-attention">
                  <div className="brief-section-title">Needs Attention</div>
                  <ul>
                    {attentionItems.map((x) => (
                      <li key={x.label}>
                        <a href={x.href}>
                          <strong>{x.n}</strong> {x.label}
                          {x.n === 1 ? "" : "s"}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="chip-row no-margin" style={{ marginBottom: 14 }}>
                {(["today", "week", "month"] as BriefPeriod[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={"chip" + (period === p ? " chip-active" : "")}
                    onClick={() => setPeriod(p)}
                  >
                    {PERIOD_LABEL[p]}
                  </button>
                ))}
              </div>

              <StatsGrid s={brief.periods[period]} />

              <div className="brief-columns">
                <div>
                  <div className="brief-section-title">Where Leads Came From (7 days)</div>
                  {brief.topSources.length === 0 ? (
                    <p className="empty-hint">No leads in the last 7 days.</p>
                  ) : (
                    <table className="data-table">
                      <tbody>
                        {brief.topSources.map((s) => (
                          <tr key={s.source}>
                            <td>{s.source}</td>
                            <td className="right mono">{s.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                <div>
                  <div className="brief-section-title">Rep Activity (7 days)</div>
                  {brief.repActivity.length === 0 ? (
                    <p className="empty-hint">No rep activity in the last 7 days.</p>
                  ) : (
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Rep</th>
                          <th className="right">Appts</th>
                          <th className="right">Calls</th>
                        </tr>
                      </thead>
                      <tbody>
                        {brief.repActivity.map((r) => (
                          <tr key={r.name}>
                            <td>{r.name}</td>
                            <td className="right mono">{r.appts}</td>
                            <td className="right mono">{r.calls}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              <div className="modal-actions">
                <div />
                <button className="btn-primary" onClick={close}>
                  Got it
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

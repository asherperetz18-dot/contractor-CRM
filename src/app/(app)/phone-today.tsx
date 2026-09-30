"use client";

import { useState } from "react";
import Link from "next/link";
import { useTimeFormat } from "@/components/time-format-context";
import { formatClock, mapsUrl } from "@/lib/data/types";
import type { DashboardRollup } from "@/lib/data/dashboard-rollup";
import {
  attentionItems,
  deltaView,
  longDay,
  type QuickAction,
  type UpcomingCard,
} from "@/lib/phone-today";
import type { MobileIconName } from "@/lib/mobile-tabs";
import { MobileIcon } from "./mobile-icon";
import { useInboxCount } from "./use-inbox-count";

const ACTION_LOOK: Record<string, { icon: MobileIconName; tone: string }> = {
  "/pipeline": { icon: "leads", tone: "dispatch" },
  "/schedule": { icon: "schedule", tone: "schedule" },
  "/estimates": { icon: "file", tone: "accounting" },
  "/time-clock": { icon: "clock", tone: "staff" },
};

/**
 * The phone's Home (DECISIONS #090): quick buttons, what needs attention,
 * the next appointments with a way to drive there, and the month so far.
 * Shown only at phone width (globals.css); the full dashboard stays one
 * tap away underneath, and is the Home on every wider screen.
 */
export function PhoneToday({
  todayISO,
  attention,
  canMoney,
  month,
  cards,
  actions,
  children,
}: {
  todayISO: string;
  attention: DashboardRollup["attention"];
  canMoney: boolean;
  month: { leads: number; prevLeads: number; appts: number; prevAppts: number };
  cards: UpcomingCard[];
  actions: QuickAction[];
  /** The full dashboard, shown under Today on a phone when asked for. */
  children: React.ReactNode;
}) {
  const [showFull, setShowFull] = useState(false);
  const inboxCount = useInboxCount();
  const timeFormat = useTimeFormat();
  const items = attentionItems(attention, { canMoney, inboxCount });
  const leadsDelta = deltaView(month.leads, month.prevLeads);
  const apptsDelta = deltaView(month.appts, month.prevAppts);

  return (
    <>
      <section className="phone-today" aria-labelledby="phone-today-title">
        <header className="pt-head">
          <p className="pt-date">{longDay(todayISO)}</p>
          <h1 id="phone-today-title" className="pt-title">
            Today
          </h1>
        </header>

        {actions.length > 0 && (
          <nav className="pt-actions" aria-label="Quick actions">
            {actions.map((a) => {
              const look = ACTION_LOOK[a.page];
              return (
                <Link key={a.href} href={a.href} className="pt-action" data-mtone={look.tone}>
                  <span className="pt-action-icon">
                    <MobileIcon name={look.icon} />
                  </span>
                  {a.label}
                </Link>
              );
            })}
          </nav>
        )}

        <section className="pt-section" data-mtone="production">
          <h2 className="pt-sec">Needs attention</h2>
          <div className="pt-list">
            {items.map((i) => (
              <Link key={i.key} href={i.href} className="pt-row">
                <span className={"pt-dot" + (i.alarm ? " is-alarm" : "")} aria-hidden="true" />
                <span className="pt-row-label">{i.label}</span>
                <span className="pt-row-value mono">{i.value}</span>
                <span className="pt-chev">
                  <MobileIcon name="chevron" size={18} />
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="pt-section" data-mtone="schedule">
          <div className="pt-sec-row">
            <h2 className="pt-sec">Next up</h2>
            <Link href="/schedule" className="pt-sec-link">
              Schedule
            </Link>
          </div>
          {cards.length === 0 ? (
            <p className="pt-empty">Nothing scheduled.</p>
          ) : (
            cards.map((c) => (
              <div key={c.id} className="pt-appt">
                <div className="pt-when">
                  <span className="pt-day">{c.day}</span>
                  {c.time && <span className="pt-time mono">{formatClock(c.time, timeFormat)}</span>}
                </div>
                <Link href={c.href} className="pt-appt-body">
                  <span className="pt-appt-who">{c.who || c.title}</span>
                  <span className="pt-appt-what">
                    {[c.who ? c.title : null, c.address].filter(Boolean).join(" · ")}
                  </span>
                </Link>
                {c.address && (
                  <a
                    className="pt-nav"
                    href={mapsUrl(c.address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Directions to ${c.who || c.title}`}
                  >
                    <MobileIcon name="navigate" size={20} />
                  </a>
                )}
              </div>
            ))
          )}
        </section>

        <section className="pt-section" data-mtone="dispatch">
          <h2 className="pt-sec">This month</h2>
          <div className="pt-kpis">
            <Link href="/pipeline" className="pt-kpi">
              <span className="pt-kpi-value mono">{month.leads.toLocaleString("en-US")}</span>
              <span className="pt-kpi-label">New leads</span>
              <span className={"dash-delta " + (leadsDelta.dir === "flat" ? "muted" : leadsDelta.dir)}>
                {leadsDelta.text}
              </span>
            </Link>
            <Link href="/schedule" className="pt-kpi">
              <span className="pt-kpi-value mono">{month.appts.toLocaleString("en-US")}</span>
              <span className="pt-kpi-label">Appointments</span>
              <span className={"dash-delta " + (apptsDelta.dir === "flat" ? "muted" : apptsDelta.dir)}>
                {apptsDelta.text}
              </span>
            </Link>
          </div>
        </section>

        <button
          type="button"
          className="pt-full-toggle"
          aria-expanded={showFull}
          onClick={() => setShowFull((v) => !v)}
        >
          {showFull ? "Hide the full dashboard" : "Show the full dashboard"}
        </button>
      </section>

      <div className={"dash-full" + (showFull ? " open" : "")}>{children}</div>
    </>
  );
}

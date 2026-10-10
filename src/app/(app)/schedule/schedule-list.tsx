"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { requestsAddress } from "@/lib/report-address";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { useTimeFormat } from "@/components/time-format-context";
import {
  EVENT_STATUS_COLOR,
  appointmentResultOverdue,
  formatTimeRange,
  rainAlertLabel,
  stageColor,
  type CalendarRow,
  type LinkedEstimate,
  type Event,
  type Lead,
  type LeadNote,
  type LeadTask,
  type PipelineStageRow,
  type Profile,
} from "@/lib/data/types";
import type { AppointmentJob } from "@/lib/appointment-jobs";
import { repDropdownOptions } from "@/lib/data/rep-options";
import { EventForm } from "../calendar/event-form";
import { AppointmentWizard } from "./appointment-wizard";
import { useQuickCreate } from "../use-quick-create";
import {
  SCHEDULE_MAX,
  SCHEDULE_PAGE,
  listWindow,
  newestFirst,
  parseScheduleQuery,
  scheduleQueryString,
  type ScheduleQuery,
  type ScheduleRange,
} from "@/lib/schedule-window";

function formatEventDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return dateStr;
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, tomorrow)) return "Tomorrow";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function ScheduleList({
  query,
  events,
  hasMore,
  loadFailed,
  jobs,
  reps,
  allMembers,
  leads,
  stages,
  leadTasks,
  leadNotes,
  estimates,
  calendars,
  canWrite,
  canDeleteEvents,
  canAddNotes,
  viewerId,
  viewerIsDispatchScoped,
  appointmentHolders,
}: {
  /** The window the page loaded: range, rep and how many (DECISIONS #143). */
  query: ScheduleQuery;
  /** That window's appointments -- a day wider than the list shows, for time zones. */
  events: Event[];
  /** More appointments in the window than were loaded. */
  hasMore: boolean;
  loadFailed: boolean;
  jobs: AppointmentJob[];
  reps: Profile[];
  /** Whole roster, deactivated included -- name lookups only. */
  allMembers?: Profile[];
  leads: Lead[];
  stages: PipelineStageRow[];
  leadTasks: LeadTask[];
  leadNotes: LeadNote[];
  estimates: LinkedEstimate[];
  calendars: CalendarRow[];
  canWrite: boolean;
  canDeleteEvents: boolean;
  canAddNotes: boolean;
  viewerId: string | null;
  viewerIsDispatchScoped: boolean;
  appointmentHolders: Record<string, string | null>;
}) {
  const [editing, setEditing] = useState<Event | null>(null);
  // Quick Create's New Appointment (and the phone's Today button) land
  // here as /schedule?new=1 and the wizard opens by itself.
  const [showNew, setShowNew] = useQuickCreate("/schedule", canWrite);
  const timeFormat = useTimeFormat();
  // Captured once rather than read during render, so the same list does
  // not render differently on a re-render.
  const [openedAtMs] = useState(() => Date.now());
  // The window opens on what's coming. The page used to open on the
  // oldest appointment in history and everyone scrolled past months to
  // find today.
  const [range, setRange] = useState<ScheduleRange>(query.range);
  const [customFrom, setCustomFrom] = useState(query.from ?? "");
  const [customTo, setCustomTo] = useState(query.to ?? "");
  const [repFilter, setRepFilter] = useState(query.rep ?? "All");
  const [limit, setLimit] = useState(query.limit);

  // The page loads only the window in the address (DECISIONS #143).
  // Changing the range, the rep or asking for more puts the new window
  // there -- in a transition, so the list on screen stays put (and any
  // open appointment with it) until the new one arrives. A different
  // range or rep starts again from one page.
  const router = useRouter();
  const [windowPending, startWindow] = useTransition();
  const wantedQs = scheduleQueryString(
    parseScheduleQuery({ range, from: customFrom, to: customTo, rep: repFilter, limit })
  );
  const loadedQs = scheduleQueryString(query);
  // The address can also move without this list asking: the Daily Brief
  // opens from the top bar on this very page, and its appointment tiles
  // link here. Follow it, rather than sending it back to the old window
  // (adjusting state from a prop, during render, as React advises).
  const [seenQs, setSeenQs] = useState(loadedQs);
  if (seenQs !== loadedQs) {
    setSeenQs(loadedQs);
    if (loadedQs !== wantedQs) {
      setRange(query.range);
      setCustomFrom(query.from ?? "");
      setCustomTo(query.to ?? "");
      setRepFilter(query.rep ?? "All");
      setLimit(query.limit);
    }
  }
  // The address this view last asked for, so its own request arriving
  // isn't taken for a link -- and going back to the loaded period while
  // another is on its way still asks, so the router drops that one.
  const asked = useRef(loadedQs);
  const loadedBefore = useRef(loadedQs);
  useEffect(() => {
    const followed = loadedQs !== loadedBefore.current;
    loadedBefore.current = loadedQs;
    const ask = requestsAddress({
      wanted: wantedQs,
      loaded: loadedQs,
      sent: asked.current,
      pending: windowPending,
      followed,
    });
    asked.current = wantedQs;
    if (ask) {
      startWindow(() => router.replace(`/schedule${wantedQs}`, { scroll: false }));
    }
  }, [wantedQs, loadedQs, windowPending, router]);
  const loading = windowPending || wantedQs !== loadedQs;

  // Local calendar days, compared as the same yyyy-mm-dd strings the
  // rows store -- no timezone arithmetic to get wrong.
  const dayStr = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const today = dayStr(new Date(openedAtMs));
  // The list's own exact window, on this browser's "today".
  const { from: fromDay, to: toDay } = listWindow(range, today, customFrom, customTo);

  const shown = events.filter((ev) => {
    if (fromDay && ev.date < fromDay) return false;
    if (toDay && ev.date > toDay) return false;
    if (repFilter !== "All" && ev.assigned_to !== repFilter && ev.second_assigned_to !== repFilter)
      return false;
    return true;
  });

  const sorted = [...shown].sort((a, b) => {
    const cmp = (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? ""));
    // History reads newest-first -- "what happened lately", not a
    // scroll to July. The page loads it in that order, a page at a time.
    return newestFirst(range, customFrom || null) ? -cmp : cmp;
  });

  function repName(id: string | null) {
    if (!id) return null;
    return reps.find((r) => r.id === id)?.name || null;
  }
  function jobName(id: string | null) {
    if (!id) return null;
    return jobs.find((j) => j.id === id)?.name || null;
  }

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Schedule</h1>
          <p className="module-sub">
            {loading ? "Loading appointments…" : `${sorted.length} appointment${sorted.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="cr-range">
          <select
            value={range}
            onChange={(e) => {
              setRange(e.target.value as ScheduleRange);
              setLimit(SCHEDULE_PAGE);
            }}
            aria-label="Date range"
          >
            <option value="upcoming">Upcoming</option>
            <option value="today">Today</option>
            <option value="tomorrow">Tomorrow</option>
            <option value="7d">Next 7 days</option>
            <option value="month">This month</option>
            <option value="past">Past</option>
            <option value="all">All</option>
            <option value="custom">Custom range…</option>
          </select>
          {range === "custom" && (
            <>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => {
                  setCustomFrom(e.target.value);
                  setLimit(SCHEDULE_PAGE);
                }}
                aria-label="From date"
              />
              <span>–</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => {
                  setCustomTo(e.target.value);
                  setLimit(SCHEDULE_PAGE);
                }}
                aria-label="To date"
              />
            </>
          )}
          <select
            value={repFilter}
            onChange={(e) => {
              setRepFilter(e.target.value);
              setLimit(SCHEDULE_PAGE);
            }}
            aria-label="Rep"
          >
            <option value="All">All Reps</option>
            {repDropdownOptions(
              reps,
              // Salespeople plus anyone actually holding an appointment,
              // and the current tick so it stays visible to be undone.
              events.flatMap((e) => [e.assigned_to, e.second_assigned_to]).concat(repFilter)
            ).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name || r.email}
              </option>
            ))}
          </select>
          {canWrite && (
            <button className="btn-primary" onClick={() => setShowNew(true)}>
              + New Appointment
            </button>
          )}
        </div>
      </div>

      {loadFailed && (
        <p className="error-note">Couldn&apos;t load appointments. Refresh the page to try again.</p>
      )}

      {sorted.length === 0 ? (
        <div className="empty-state">
          <div className="empty-mark" aria-hidden="true">
            ＋
          </div>
          {/* Only the window is loaded now, so "nothing at all" can only be
              said when the window is everything. */}
          <p className="empty-label">
            {loading ? "Loading…" : range === "all" && repFilter === "All" ? "Nothing scheduled" : "Nothing in this window"}
          </p>
          <p className="empty-hint">
            {range === "all" && repFilter === "All"
              ? "Add estimates, site visits, or crew appointments."
              : "Widen the date range or switch back to All Reps."}
          </p>
        </div>
      ) : (
        <div className={"schedule-list" + (loading ? " schedule-loading" : "")} aria-busy={loading}>
          {sorted.map((ev) => {
            const rain = rainAlertLabel(ev.rain_alert_pop);
            return (
            <div className="schedule-row" key={ev.id} onClick={() => setEditing(ev)}>
              <div className="schedule-date">
                <span className="mono schedule-date-num">{formatEventDate(ev.date)}</span>
                <span className="mono schedule-time">{formatTimeRange(ev.time, ev.end_time, timeFormat)}</span>
              </div>
              <div className="schedule-body">
                <div className="schedule-title">{ev.title}</div>
                <div className="schedule-meta">
                  <Badge color={stageColor(calendars, ev.event_type)}>{ev.event_type}</Badge>
                  {/* The outcome, which the Calendar list has always shown
                      and this one didn't -- leaving no way to scan a week
                      and see which appointments actually happened. */}
                  <Badge color={EVENT_STATUS_COLOR[ev.status]}>{ev.status}</Badge>
                  {appointmentResultOverdue(ev, openedAtMs) && (
                    <span className="stale-tag">● no result yet</span>
                  )}
                  {rain && (
                    <span className={"rain-badge rain-badge-" + rain.tier}>☔ {rain.label}</span>
                  )}
                  {repName(ev.assigned_to) && <span>👷 {repName(ev.assigned_to)}</span>}
                  {repName(ev.second_assigned_to) && <span>👷 {repName(ev.second_assigned_to)}</span>}
                  {jobName(ev.job_id) && <span>{jobName(ev.job_id)}</span>}
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {hasMore && sorted.length > 0 && (
        <div className="schedule-more">
          {limit < SCHEDULE_MAX ? (
            <button
              type="button"
              className="btn-ghost"
              disabled={loading}
              onClick={() => setLimit((n) => Math.min(n + SCHEDULE_PAGE, SCHEDULE_MAX))}
            >
              {loading ? "Loading…" : newestFirst(range, customFrom || null) ? "Show more (older)" : "Show more (later)"}
            </button>
          ) : (
            <p className="empty-hint">
              Showing {SCHEDULE_MAX} appointments. Pick a custom date range to see others.
            </p>
          )}
        </div>
      )}

      {showNew && canWrite && (
        <AppointmentWizard
          reps={reps}
          stages={stages}
          calendars={calendars}
          onCancel={() => setShowNew(false)}
          onFinished={() => setShowNew(false)}
        />
      )}
      {editing && (
        // Keyed by the appointment, as on the Calendar (DECISIONS #197).
        <EventForm
          key={editing.id}
          event={editing}
          jobs={jobs}
          reps={reps}
          allMembers={allMembers}
          leads={leads}
          leadTasks={leadTasks}
          leadNotes={leadNotes}
          estimates={estimates}
          calendars={calendars}
          stages={stages}
          readOnly={!canWrite}
          canDelete={canDeleteEvents}
          canAddNotes={canAddNotes}
          viewerId={viewerId}
          viewerIsDispatchScoped={viewerIsDispatchScoped}
          appointmentHolders={appointmentHolders}
          onCancel={() => setEditing(null)}
          onSaved={() => setEditing(null)}
          onDeleted={() => setEditing(null)}
        />
      )}
    </div>
  );
}

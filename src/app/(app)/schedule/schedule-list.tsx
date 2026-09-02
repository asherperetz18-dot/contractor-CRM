"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { useTimeFormat } from "@/components/time-format-context";
import {
  EVENT_STATUS_COLOR,
  appointmentResultOverdue,
  formatTimeRange,
  stageColor,
  type CalendarRow,
  type LinkedEstimate,
  type Event,
  type Job,
  type Lead,
  type LeadNote,
  type LeadTask,
  type PipelineStageRow,
  type Profile,
} from "@/lib/data/types";
import { EventForm } from "../calendar/event-form";
import type { DispatcherPickerBootstrap } from "../calendar/dispatcher-picker";
import { AppointmentWizard } from "./appointment-wizard";

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
  events,
  jobs,
  reps,
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
  dispatcherPicker,
}: {
  events: Event[];
  jobs: Job[];
  reps: Profile[];
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
  dispatcherPicker?: DispatcherPickerBootstrap;
}) {
  const [editing, setEditing] = useState<Event | null>(null);
  const [showNew, setShowNew] = useState(false);
  const timeFormat = useTimeFormat();
  // Captured once rather than read during render, so the same list does
  // not render differently on a re-render.
  const [openedAtMs] = useState(() => Date.now());
  // The window opens on what's coming. The page used to open on the
  // oldest appointment in history and everyone scrolled past months to
  // find today.
  const [range, setRange] = useState("upcoming");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [repFilter, setRepFilter] = useState("All");

  // Local calendar days, compared as the same yyyy-mm-dd strings the
  // rows store -- no timezone arithmetic to get wrong.
  const dayStr = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const today = dayStr(new Date(openedAtMs));
  const plusDays = (n: number) => {
    const d = new Date(openedAtMs);
    d.setDate(d.getDate() + n);
    return dayStr(d);
  };
  let fromDay: string | null = null;
  let toDay: string | null = null; // inclusive
  if (range === "upcoming") fromDay = today;
  else if (range === "today") { fromDay = today; toDay = today; }
  else if (range === "tomorrow") { fromDay = plusDays(1); toDay = plusDays(1); }
  else if (range === "7d") { fromDay = today; toDay = plusDays(7); }
  else if (range === "month") {
    const d = new Date(openedAtMs);
    fromDay = dayStr(new Date(d.getFullYear(), d.getMonth(), 1));
    toDay = dayStr(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  } else if (range === "past") toDay = plusDays(-1);
  else if (range === "custom") {
    fromDay = customFrom || null;
    toDay = customTo || null;
  }

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
    // scroll to July.
    return range === "past" ? -cmp : cmp;
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
            {shown.length === events.length
              ? `${events.length} appointments`
              : `${shown.length} of ${events.length} appointments`}
          </p>
        </div>
        <div className="cr-range">
          <select value={range} onChange={(e) => setRange(e.target.value)} aria-label="Date range">
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
                onChange={(e) => setCustomFrom(e.target.value)}
                aria-label="From date"
              />
              <span>–</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                aria-label="To date"
              />
            </>
          )}
          <select
            value={repFilter}
            onChange={(e) => setRepFilter(e.target.value)}
            aria-label="Rep"
          >
            <option value="All">All Reps</option>
            {reps.map((r) => (
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

      {sorted.length === 0 ? (
        <div className="empty-state">
          <div className="empty-mark" aria-hidden="true">
            ＋
          </div>
          <p className="empty-label">
            {events.length === 0 ? "Nothing scheduled" : "Nothing in this window"}
          </p>
          <p className="empty-hint">
            {events.length === 0
              ? "Add estimates, site visits, or crew appointments."
              : "Widen the date range or switch back to All Reps."}
          </p>
        </div>
      ) : (
        <div className="schedule-list">
          {sorted.map((ev) => (
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
                  {repName(ev.assigned_to) && <span>👷 {repName(ev.assigned_to)}</span>}
                  {repName(ev.second_assigned_to) && <span>👷 {repName(ev.second_assigned_to)}</span>}
                  {jobName(ev.job_id) && <span>{jobName(ev.job_id)}</span>}
                </div>
              </div>
            </div>
          ))}
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
        <EventForm
          event={editing}
          jobs={jobs}
          reps={reps}
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
          dispatcherPicker={dispatcherPicker}
          onCancel={() => setEditing(null)}
          onSaved={() => setEditing(null)}
          onDeleted={() => setEditing(null)}
        />
      )}
    </div>
  );
}

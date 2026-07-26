"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  EVENT_STATUSES,
  EVENT_STATUS_COLOR,
  stageColor,
  type CalendarRow,
  type DocumentRecord,
  type Event,
  type EventStatus,
  type Job,
  type Lead,
  type LeadTask,
  type Profile,
} from "@/lib/data/types";
import { EventForm } from "./event-form";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ymd(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function toggleInSet<T>(setter: (updater: (prev: Set<T>) => Set<T>) => void, value: T) {
  setter((prev) => {
    const next = new Set(prev);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  });
}

type Cell = { inMonth: boolean; day: number; dateStr: string | null };

export function CalendarBoard({
  events,
  jobs,
  reps,
  leads,
  leadTasks,
  documents,
  calendars,
  canWrite,
}: {
  events: Event[];
  jobs: Job[];
  reps: Profile[];
  leads: Lead[];
  leadTasks: LeadTask[];
  documents: DocumentRecord[];
  calendars: CalendarRow[];
  canWrite: boolean;
}) {
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editing, setEditing] = useState<Event | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newDate, setNewDate] = useState(todayISO());
  const [statusFilter, setStatusFilter] = useState<Set<EventStatus>>(new Set());
  const [calendarFilter, setCalendarFilter] = useState<Set<string>>(new Set());
  const [repFilter, setRepFilter] = useState<Set<string>>(new Set());

  const { year, month } = cursor;
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const filteredEvents = events.filter((ev) => {
    if (statusFilter.size > 0 && !statusFilter.has(ev.status)) return false;
    if (calendarFilter.size > 0 && !calendarFilter.has(ev.event_type)) return false;
    if (repFilter.size > 0 && (!ev.assigned_to || !repFilter.has(ev.assigned_to))) return false;
    return true;
  });

  const eventsByDate = new Map<string, Event[]>();
  for (const ev of filteredEvents) {
    const list = eventsByDate.get(ev.date) ?? [];
    list.push(ev);
    eventsByDate.set(ev.date, list);
  }

  const cells: Cell[] = [];
  for (let i = 0; i < firstDow; i++) {
    cells.push({ inMonth: false, day: daysInPrevMonth - firstDow + 1 + i, dateStr: null });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ inMonth: true, day: d, dateStr: ymd(year, month, d) });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ inMonth: false, day: cells.length - (firstDow + daysInMonth) + 1, dateStr: null });
  }

  function prevMonth() {
    setCursor((c) => (c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 }));
  }
  function nextMonth() {
    setCursor((c) => (c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 }));
  }
  function goToday() {
    setCursor({ year: today.getFullYear(), month: today.getMonth() });
    setSelectedDate(todayISO());
  }
  function openNewOnDate(dateStr: string) {
    setNewDate(dateStr);
    setShowNew(true);
  }

  function repName(id: string | null) {
    if (!id) return null;
    return reps.find((r) => r.id === id)?.name || null;
  }
  function jobName(id: string | null) {
    if (!id) return null;
    return jobs.find((j) => j.id === id)?.name || null;
  }

  const todayStr = todayISO();
  const selectedEvents = selectedDate
    ? [...(eventsByDate.get(selectedDate) ?? [])].sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""))
    : [];

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Calendar</h1>
          <p className="module-sub">{filteredEvents.length} total appointments</p>
        </div>
        {canWrite && (
          <button
            className="btn-primary"
            onClick={() => openNewOnDate(selectedDate || todayISO())}
          >
            + New Appointment
          </button>
        )}
      </div>

      <div className="chip-row no-margin cal-status-chips">
        {EVENT_STATUSES.map((s) => (
          <button
            key={s}
            className={"chip" + (statusFilter.has(s) ? " chip-active" : "")}
            onClick={() => toggleInSet(setStatusFilter, s)}
          >
            <span className="tick" style={{ background: EVENT_STATUS_COLOR[s] }} /> {s}
          </button>
        ))}
      </div>

      <div className="cal-layout">
        <aside className="cal-filters">
          <div className="cal-filters-head">FILTERS</div>

          <div className="cal-filter-group">
            <div className="cal-filter-group-head">
              <span>CALENDARS</span>
              <button
                type="button"
                className="cal-select-all"
                onClick={() =>
                  setCalendarFilter((prev) =>
                    prev.size === calendars.length
                      ? new Set()
                      : new Set(calendars.map((c) => c.name))
                  )
                }
              >
                Select all
              </button>
            </div>
            {calendars.map((c) => (
              <label key={c.id} className="cal-filter-item">
                <input
                  type="checkbox"
                  checked={calendarFilter.has(c.name)}
                  onChange={() => toggleInSet(setCalendarFilter, c.name)}
                />
                <span className="tick" style={{ background: c.color }} />
                {c.name}
              </label>
            ))}
          </div>

          <div className="cal-filter-group">
            <div className="cal-filter-group-head">
              <span>REP AVAILABILITY</span>
              <button
                type="button"
                className="cal-select-all"
                onClick={() =>
                  setRepFilter((prev) =>
                    prev.size === reps.length ? new Set() : new Set(reps.map((r) => r.id))
                  )
                }
              >
                Select all
              </button>
            </div>
            {reps.map((r) => (
              <label key={r.id} className="cal-filter-item">
                <input
                  type="checkbox"
                  checked={repFilter.has(r.id)}
                  onChange={() => toggleInSet(setRepFilter, r.id)}
                />
                {r.name || r.email}
              </label>
            ))}
          </div>
        </aside>

        <div className="cal-main">
          <div className="cal-toolbar">
            <div className="cal-nav">
              <button className="icon-btn cal-nav-btn" onClick={prevMonth} aria-label="Previous month">
                ‹
              </button>
              <span className="cal-month-label">
                {MONTH_NAMES[month]} {year}
              </span>
              <button className="icon-btn cal-nav-btn" onClick={nextMonth} aria-label="Next month">
                ›
              </button>
            </div>
            <button className="btn-ghost small" onClick={goToday}>
              Today
            </button>
          </div>

          <div className="cal-grid">
            {WEEKDAY_LABELS.map((w) => (
              <div key={w} className="cal-weekday">
                {w}
              </div>
            ))}
            {cells.map((c, i) => {
              const dayEvents = c.dateStr ? eventsByDate.get(c.dateStr) ?? [] : [];
              const isToday = c.dateStr === todayStr;
              const isSelected = !!c.dateStr && c.dateStr === selectedDate;
              return (
                <div
                  key={i}
                  className={
                    "cal-cell" +
                    (c.inMonth ? "" : " cal-cell-out") +
                    (isToday ? " cal-cell-today" : "") +
                    (isSelected ? " cal-cell-selected" : "")
                  }
                  onClick={() => c.dateStr && setSelectedDate(c.dateStr)}
                  onDoubleClick={() => c.dateStr && canWrite && openNewOnDate(c.dateStr)}
                >
                  <span className="cal-cell-day">{c.day}</span>
                  <div className="cal-cell-events">
                    {dayEvents.slice(0, 3).map((ev) => (
                      <div
                        key={ev.id}
                        className="cal-event-chip"
                        style={{ borderLeftColor: stageColor(calendars, ev.event_type) }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditing(ev);
                        }}
                      >
                        <span className="mono cal-event-time">{ev.time}</span> {ev.title}
                      </div>
                    ))}
                    {dayEvents.length > 3 && (
                      <div className="cal-event-more">+{dayEvents.length - 3} more</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {selectedDate && (
            <div className="cal-day-panel">
              <div className="cal-day-panel-head">
                <span>{selectedDate}</span>
                {canWrite && (
                  <button className="btn-ghost small" onClick={() => openNewOnDate(selectedDate)}>
                    + Add
                  </button>
                )}
              </div>
              {selectedEvents.length === 0 ? (
                <p className="hint-note" style={{ marginTop: 0 }}>
                  Nothing scheduled this day.
                </p>
              ) : (
                <div className="schedule-list">
                  {selectedEvents.map((ev) => (
                    <div className="schedule-row" key={ev.id} onClick={() => setEditing(ev)}>
                      <div className="schedule-date">
                        <span className="mono schedule-time">{ev.time}</span>
                      </div>
                      <div className="schedule-body">
                        <div className="schedule-title">{ev.title}</div>
                        <div className="schedule-meta">
                          <Badge color={stageColor(calendars, ev.event_type)}>{ev.event_type}</Badge>
                          <Badge color={EVENT_STATUS_COLOR[ev.status]}>{ev.status}</Badge>
                          {repName(ev.assigned_to) && <span>👷 {repName(ev.assigned_to)}</span>}
                          {jobName(ev.job_id) && <span>{jobName(ev.job_id)}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showNew && canWrite && (
        <EventForm
          initialDate={newDate}
          jobs={jobs}
          reps={reps}
          leads={leads}
          leadTasks={leadTasks}
          documents={documents}
          calendars={calendars}
          onCancel={() => setShowNew(false)}
          onSaved={() => {
            setShowNew(false);
            setSelectedDate(newDate);
          }}
        />
      )}
      {editing && (
        <EventForm
          event={editing}
          jobs={jobs}
          reps={reps}
          leads={leads}
          leadTasks={leadTasks}
          documents={documents}
          calendars={calendars}
          readOnly={!canWrite}
          onCancel={() => setEditing(null)}
          onSaved={() => setEditing(null)}
          onDeleted={() => setEditing(null)}
        />
      )}
    </div>
  );
}

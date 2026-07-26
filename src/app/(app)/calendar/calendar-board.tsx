"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { Event, Job, Profile } from "@/lib/data/types";
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

type Cell = { inMonth: boolean; day: number; dateStr: string | null };

export function CalendarBoard({
  events,
  jobs,
  reps,
  canWrite,
}: {
  events: Event[];
  jobs: Job[];
  reps: Profile[];
  canWrite: boolean;
}) {
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editing, setEditing] = useState<Event | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newDate, setNewDate] = useState(todayISO());

  const { year, month } = cursor;
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const eventsByDate = new Map<string, Event[]>();
  for (const ev of events) {
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
          <p className="module-sub">{events.length} total appointments</p>
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
                      <Badge color="#2D5F8A">{ev.event_type}</Badge>
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

      {showNew && canWrite && (
        <EventForm
          initialDate={newDate}
          jobs={jobs}
          reps={reps}
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
          readOnly={!canWrite}
          onCancel={() => setEditing(null)}
          onSaved={() => setEditing(null)}
          onDeleted={() => setEditing(null)}
        />
      )}
    </div>
  );
}

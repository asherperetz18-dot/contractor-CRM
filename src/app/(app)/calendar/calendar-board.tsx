"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { useTimeFormat } from "@/components/time-format-context";
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
  type LeadNote,
  type LeadTask,
  type PipelineStageRow,
  type Profile,
  type TimeFormat,
} from "@/lib/data/types";
import { useRouter } from "next/navigation";
import { rescheduleEvent } from "@/lib/actions/events";
import { EventForm } from "./event-form";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type ViewMode = "month" | "week" | "day";

function ymd(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function ymdFromDate(d: Date) {
  return ymd(d.getFullYear(), d.getMonth(), d.getDate());
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function startOfWeek(dateStr: string): Date {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function formatEventTime(time: string | null, format: TimeFormat): string {
  if (!time) return "";
  const hhmm = time.slice(0, 5);
  if (format === "24h") return hhmm;
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
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
  leadNotes,
  documents,
  calendars,
  stages,
  canWrite,
}: {
  events: Event[];
  jobs: Job[];
  reps: Profile[];
  leads: Lead[];
  leadTasks: LeadTask[];
  leadNotes: LeadNote[];
  documents: DocumentRecord[];
  calendars: CalendarRow[];
  stages: PipelineStageRow[];
  canWrite: boolean;
}) {
  const timeFormat = useTimeFormat();
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [cursorDate, setCursorDate] = useState(todayISO());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editing, setEditing] = useState<Event | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newDate, setNewDate] = useState(todayISO());
  const [statusFilter, setStatusFilter] = useState<Set<EventStatus>>(new Set());
  const [calendarFilter, setCalendarFilter] = useState<Set<string>>(new Set());
  const [repFilter, setRepFilter] = useState<Set<string>>(new Set());
  const router = useRouter();
  const [draggingId, setDraggingId] = useState("");
  const [dragOverDate, setDragOverDate] = useState("");
  const [moveError, setMoveError] = useState("");
  // Applied immediately on drop so the chip appears in its new day right
  // away, rather than snapping back until the server round-trip lands.
  const [pendingMove, setPendingMove] = useState<{ id: string; date: string } | null>(null);

  async function handleDropOnDate(eventId: string, date: string) {
    const moving = events.find((e) => e.id === eventId);
    setDraggingId("");
    setDragOverDate("");
    if (!moving || moving.date === date) return;

    setMoveError("");
    setPendingMove({ id: eventId, date });
    // Date only -- the month grid has no time slots, so the appointment
    // keeps its existing time.
    const result = await rescheduleEvent(eventId, date);
    if (result?.error) {
      setPendingMove(null);
      setMoveError(result.error);
      return;
    }
    router.refresh();
    setPendingMove(null);
  }

  const cursor = new Date(`${cursorDate}T00:00:00`);
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const filteredEvents = events.filter((ev) => {
    if (statusFilter.size > 0 && !statusFilter.has(ev.status)) return false;
    if (calendarFilter.size > 0 && !calendarFilter.has(ev.event_type)) return false;
    if (
      repFilter.size > 0 &&
      !(ev.assigned_to && repFilter.has(ev.assigned_to)) &&
      !(ev.second_assigned_to && repFilter.has(ev.second_assigned_to))
    )
      return false;
    return true;
  });

  const eventsByDate = new Map<string, Event[]>();
  for (const ev of filteredEvents) {
    // While a drop is in flight, group the moved appointment under its new
    // day so it doesn't visibly snap back before the refresh arrives.
    const date = pendingMove && pendingMove.id === ev.id ? pendingMove.date : ev.date;
    const list = eventsByDate.get(date) ?? [];
    list.push(ev);
    eventsByDate.set(date, list);
  }
  for (const list of eventsByDate.values()) {
    list.sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
  }

  const monthCells: Cell[] = [];
  for (let i = 0; i < firstDow; i++) {
    monthCells.push({ inMonth: false, day: daysInPrevMonth - firstDow + 1 + i, dateStr: null });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    monthCells.push({ inMonth: true, day: d, dateStr: ymd(year, month, d) });
  }
  while (monthCells.length % 7 !== 0) {
    monthCells.push({
      inMonth: false,
      day: monthCells.length - (firstDow + daysInMonth) + 1,
      dateStr: null,
    });
  }

  const weekStart = startOfWeek(cursorDate);
  const weekCells: Cell[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return { inMonth: true, day: d.getDate(), dateStr: ymdFromDate(d) };
  });

  function shiftCursor(days: number) {
    const d = new Date(`${cursorDate}T00:00:00`);
    d.setDate(d.getDate() + days);
    setCursorDate(ymdFromDate(d));
  }
  function goPrev() {
    if (viewMode === "day") shiftCursor(-1);
    else if (viewMode === "week") shiftCursor(-7);
    else {
      const d = new Date(year, month - 1, 1);
      setCursorDate(ymdFromDate(d));
    }
  }
  function goNext() {
    if (viewMode === "day") shiftCursor(1);
    else if (viewMode === "week") shiftCursor(7);
    else {
      const d = new Date(year, month + 1, 1);
      setCursorDate(ymdFromDate(d));
    }
  }
  function goToday() {
    setCursorDate(todayISO());
    setSelectedDate(todayISO());
  }
  function openNewOnDate(dateStr: string) {
    setNewDate(dateStr);
    setShowNew(true);
  }
  function selectDate(dateStr: string) {
    setSelectedDate(dateStr);
    setCursorDate(dateStr);
  }
  function changeView(mode: ViewMode) {
    if (mode === "day" && selectedDate) setCursorDate(selectedDate);
    setViewMode(mode);
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
  const selectedEvents = selectedDate ? eventsByDate.get(selectedDate) ?? [] : [];
  const dayViewEvents = eventsByDate.get(cursorDate) ?? [];

  const periodLabel =
    viewMode === "day"
      ? new Date(`${cursorDate}T00:00:00`).toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        })
      : viewMode === "week"
        ? (() => {
            const end = new Date(weekStart);
            end.setDate(weekStart.getDate() + 6);
            const sameMonth = weekStart.getMonth() === end.getMonth();
            const startLabel = weekStart.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            });
            const endLabel = end.toLocaleDateString("en-US", {
              month: sameMonth ? undefined : "short",
              day: "numeric",
              year: "numeric",
            });
            return `${startLabel} – ${endLabel}`;
          })()
        : `${MONTH_NAMES[month]} ${year}`;

  function renderGrid(cells: Cell[], gridClassName: string, maxPerCell: number) {
    return (
      <>
      {moveError && <p className="error-note">{moveError}</p>}
      <div className={`cal-grid ${gridClassName}`}>
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
                (isSelected ? " cal-cell-selected" : "") +
                (dragOverDate && dragOverDate === c.dateStr ? " cal-cell-drop" : "")
              }
              onClick={() => c.dateStr && selectDate(c.dateStr)}
              onDoubleClick={() => c.dateStr && canWrite && openNewOnDate(c.dateStr)}
              onDragOver={(e) => {
                if (!canWrite || !c.dateStr || !draggingId) return;
                // Required for the drop to be allowed at all.
                e.preventDefault();
                if (dragOverDate !== c.dateStr) setDragOverDate(c.dateStr);
              }}
              onDragLeave={() => {
                if (dragOverDate === c.dateStr) setDragOverDate("");
              }}
              onDrop={(e) => {
                if (!canWrite || !c.dateStr) return;
                e.preventDefault();
                const id = e.dataTransfer.getData("text/plain") || draggingId;
                if (id) handleDropOnDate(id, c.dateStr);
              }}
            >
              <span className="cal-cell-day">{c.day}</span>
              <div className="cal-cell-events">
                {dayEvents.slice(0, maxPerCell).map((ev) => (
                  <div
                    key={ev.id}
                    className={
                      "cal-event-chip" +
                      (canWrite ? " cal-event-draggable" : "") +
                      (draggingId === ev.id ? " cal-event-dragging" : "")
                    }
                    style={{ borderLeftColor: stageColor(calendars, ev.event_type) }}
                    draggable={canWrite}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", ev.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDraggingId(ev.id);
                    }}
                    onDragEnd={() => {
                      setDraggingId("");
                      setDragOverDate("");
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing(ev);
                    }}
                  >
                    <span className="mono cal-event-time">{formatEventTime(ev.time, timeFormat)}</span>{" "}
                    {ev.title}
                  </div>
                ))}
                {dayEvents.length > maxPerCell && (
                  <div className="cal-event-more">+{dayEvents.length - maxPerCell} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      </>
    );
  }

  function renderAgenda(list: Event[]) {
    if (list.length === 0) {
      return (
        <p className="hint-note" style={{ marginTop: 0 }}>
          Nothing scheduled this day.
        </p>
      );
    }
    return (
      <div className="schedule-list">
        {list.map((ev) => (
          <div className="schedule-row" key={ev.id} onClick={() => setEditing(ev)}>
            <div className="schedule-date">
              <span className="mono schedule-time">{formatEventTime(ev.time, timeFormat)}</span>
            </div>
            <div className="schedule-body">
              <div className="schedule-title">{ev.title}</div>
              <div className="schedule-meta">
                <Badge color={stageColor(calendars, ev.event_type)}>{ev.event_type}</Badge>
                <Badge color={EVENT_STATUS_COLOR[ev.status]}>{ev.status}</Badge>
                {repName(ev.assigned_to) && <span>👷 {repName(ev.assigned_to)}</span>}
                {repName(ev.second_assigned_to) && <span>👷 {repName(ev.second_assigned_to)}</span>}
                {jobName(ev.job_id) && <span>{jobName(ev.job_id)}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

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
            onClick={() => openNewOnDate(selectedDate || cursorDate)}
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
              <button className="icon-btn cal-nav-btn" onClick={goPrev} aria-label="Previous">
                ‹
              </button>
              <span className="cal-month-label">{periodLabel}</span>
              <button className="icon-btn cal-nav-btn" onClick={goNext} aria-label="Next">
                ›
              </button>
            </div>
            <div className="cal-toolbar-right">
              <div className="segmented cal-view-toggle">
                {(["month", "week", "day"] as ViewMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={"segmented-btn" + (viewMode === m ? " active" : "")}
                    onClick={() => changeView(m)}
                  >
                    {m[0].toUpperCase() + m.slice(1)}
                  </button>
                ))}
              </div>
              <button className="btn-ghost small" onClick={goToday}>
                Today
              </button>
            </div>
          </div>

          {viewMode === "month" && renderGrid(monthCells, "", 3)}
          {viewMode === "week" && renderGrid(weekCells, "cal-grid-week", 8)}

          {viewMode === "day" && (
            <div className="cal-day-view">
              {canWrite && (
                <button className="btn-ghost small" onClick={() => openNewOnDate(cursorDate)}>
                  + Add Appointment
                </button>
              )}
              <div style={{ marginTop: 10 }}>{renderAgenda(dayViewEvents)}</div>
            </div>
          )}

          {viewMode !== "day" && selectedDate && (
            <div className="cal-day-panel">
              <div className="cal-day-panel-head">
                <span>{selectedDate}</span>
                {canWrite && (
                  <button className="btn-ghost small" onClick={() => openNewOnDate(selectedDate)}>
                    + Add
                  </button>
                )}
              </div>
              {renderAgenda(selectedEvents)}
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
          leadNotes={leadNotes}
          documents={documents}
          calendars={calendars}
          stages={stages}
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
          leadNotes={leadNotes}
          documents={documents}
          calendars={calendars}
          stages={stages}
          readOnly={!canWrite}
          onCancel={() => setEditing(null)}
          onSaved={() => setEditing(null)}
          onDeleted={() => setEditing(null)}
        />
      )}
    </div>
  );
}

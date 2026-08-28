"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import { useTimeFormat } from "@/components/time-format-context";
import {
  EVENT_STATUSES,
  EVENT_STATUS_COLOR,
  eventVisualState,
  formatClock,
  formatTimeRange,
  stageColor,
  type CalendarRow,
  type LinkedEstimate,
  type Event,
  type EventStatus,
  type Job,
  type Lead,
  type LeadNote,
  type LeadTask,
  type PipelineStageRow,
  type Profile,
} from "@/lib/data/types";
import { useRouter, useSearchParams } from "next/navigation";
import { safeInternalPath } from "@/lib/safe-path";
import { rescheduleEvent } from "@/lib/actions/events";
import { EventForm } from "./event-form";
import { AppointmentWizard } from "../schedule/appointment-wizard";
import type { DispatcherPickerBootstrap } from "./dispatcher-picker";
import { FilterSelect } from "@/components/filter-select";

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

function toggleInSet<T>(setter: (updater: (prev: Set<T>) => Set<T>) => void, value: T) {
  setter((prev) => {
    const next = new Set(prev);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  });
}

type Cell = { inMonth: boolean; day: number; dateStr: string | null };

/**
 * Whether this is a phone-width screen.
 *
 * useSyncExternalStore rather than reading window during render: the
 * server has no window, and a render that disagrees with the server's is
 * a hydration mismatch. The server snapshot says "not narrow", matching
 * what it renders, and the real value arrives on hydration.
 */
function useIsNarrowScreen(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia("(max-width: 640px)");
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(max-width: 640px)").matches,
    () => false
  );
}

export function CalendarBoard({
  events,
  jobs,
  reps,
  filterReps,
  leads,
  leadTasks,
  leadNotes,
  estimates,
  calendars,
  stages,
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
  /** Every active member: name lookups and the assignee picker. */
  reps: Profile[];
  /** Just the salespeople, for the rep filter. */
  filterReps: Profile[];
  leads: Lead[];
  leadTasks: LeadTask[];
  leadNotes: LeadNote[];
  estimates: LinkedEstimate[];
  calendars: CalendarRow[];
  stages: PipelineStageRow[];
  canWrite: boolean;
  canDeleteEvents: boolean;
  canAddNotes: boolean;
  viewerId: string | null;
  viewerIsDispatchScoped: boolean;
  appointmentHolders: Record<string, string | null>;
  dispatcherPicker?: DispatcherPickerBootstrap;
}) {
  const timeFormat = useTimeFormat();
  /**
   * Null until the user picks a view for themselves, so the default can
   * depend on the screen without overriding a deliberate choice.
   */
  const [chosenView, setChosenView] = useState<ViewMode | null>(null);
  const narrow = useIsNarrowScreen();

  /**
   * Phones open on Day, not Month.
   *
   * Seven columns across a 375px screen leaves each appointment chip
   * about 30 pixels wide: the time and the customer's name are still in
   * the markup, and none of it is readable. A rep checking their round
   * from the van got a grid of coloured dots. The same appointments in
   * Day view get 270px and read in full.
   *
   * Derived rather than set in an effect: this is a value computed from
   * the screen and the user's choice, not state to synchronise, and
   * setting it from an effect cascades an extra render on every load.
   */
  // Desktop opens on Week: seven roomy columns where an appointment
  // card can carry its rep and both confirmations, which a month cell
  // cannot. Month stays one click away for planning ahead.
  const viewMode: ViewMode = chosenView ?? (narrow ? "day" : "week");
  const setViewMode = setChosenView;
  const [cursorDate, setCursorDate] = useState(todayISO());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editing, setEditing] = useState<Event | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newDate, setNewDate] = useState(todayISO());
  const [statusFilter, setStatusFilter] = useState<Set<EventStatus>>(new Set());
  const [calendarFilter, setCalendarFilter] = useState<Set<string>>(new Set());
  const [repFilter, setRepFilter] = useState<Set<string>>(new Set());
  const [dispatcherFilter, setDispatcherFilter] = useState<Set<string>>(new Set());
  const router = useRouter();
  const searchParams = useSearchParams();
  const [consumedOpenId, setConsumedOpenId] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState<string | null>(null);

  /**
   * Open one appointment by id, for links from elsewhere in the app.
   *
   * The contact card's Appointments tab points here: recording what
   * happened at a visit belongs in the appointment itself, so the link
   * brings you to it rather than growing a second result form.
   */
  const openEventId = searchParams.get("openEvent");
  if (openEventId && openEventId !== consumedOpenId) {
    setConsumedOpenId(openEventId);
    setReturnTo(safeInternalPath(searchParams.get("from")));
    const found = events.find((e) => e.id === openEventId);
    if (found) setEditing(found);
  } else if (!openEventId && consumedOpenId) {
    // Param stripped below -- clear the guard so the same appointment can
    // be opened again later without a full reload.
    setConsumedOpenId(null);
  }

  useEffect(() => {
    if (searchParams.get("openEvent")) {
      router.replace("/calendar", { scroll: false });
    }
  }, [searchParams, router]);

  /**
   * Close the appointment, returning to whatever sent us here.
   *
   * Only for the deep-linked case. An appointment opened by clicking the
   * calendar has nowhere else to go, and navigating away from the
   * calendar there would be its own bug.
   */
  function closeEvent() {
    setEditing(null);
    if (returnTo) {
      const target = returnTo;
      setReturnTo(null);
      router.push(target);
    }
  }
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

  // The dispatcher is held on the lead, not the appointment -- one person
  // owns the customer from arrival until the job sells, across however
  // many visits it takes. So an appointment's dispatcher is its lead's.
  const dispatcherByLead = new Map<string, string>();
  for (const l of leads ?? []) {
    if (l.dispatcher_id) dispatcherByLead.set(l.id, l.dispatcher_id);
  }
  // Built from who actually holds leads, not from who has the role.
  //
  // Resolved against the full member list, not the narrowed rep filter
  // list: dispatchers are precisely the people that list leaves out, so
  // looking them up there returned nothing and every name read "Unnamed".
  const dispatchers = [...new Set(dispatcherByLead.values())]
    .map((id) => {
      const person = reps.find((r) => r.id === id);
      return { id, name: person?.name || person?.email || "Unnamed" };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const filteredEvents = events.filter((ev) => {
    if (statusFilter.size > 0 && !statusFilter.has(ev.status)) return false;
    if (calendarFilter.size > 0 && !calendarFilter.has(ev.event_type)) return false;
    if (dispatcherFilter.size > 0) {
      const owner = ev.lead_id ? dispatcherByLead.get(ev.lead_id) : null;
      if (!owner || !dispatcherFilter.has(owner)) return false;
    }
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

  // Edge cells carry their real dates. They used to be dateStr: null,
  // which rendered "Sep 1" in August's last row as a dead cell that
  // silently showed no events -- a dispatcher booked an appointment
  // there, saw the printed date empty, concluded the booking failed,
  // and booked it twice. A visible date that hides its appointments is
  // worse than not drawing the date at all.
  const monthCells: Cell[] = [];
  for (let i = 0; i < firstDow; i++) {
    const day = daysInPrevMonth - firstDow + 1 + i;
    // Through the Date constructor so December/January edges roll the
    // year rather than producing month 0 or 13.
    monthCells.push({ inMonth: false, day, dateStr: ymdFromDate(new Date(year, month - 1, day)) });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    monthCells.push({ inMonth: true, day: d, dateStr: ymd(year, month, d) });
  }
  while (monthCells.length % 7 !== 0) {
    const day = monthCells.length - (firstDow + daysInMonth) + 1;
    monthCells.push({ inMonth: false, day, dateStr: ymdFromDate(new Date(year, month + 1, day)) });
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

  // Stable per-rep colour, hashed from the id so it never shifts as the
  // roster changes; the palette keeps every pair distinguishable.
  const REP_PALETTE = [
    "#2d5f8a", "#c7691b", "#2f855a", "#6b46c1", "#b83280",
    "#0f766e", "#b7791f", "#c53030", "#3182ce", "#805ad5",
  ];
  function repColor(id: string): string {
    let h = 0;
    for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return REP_PALETTE[h % REP_PALETTE.length];
  }
  function repInitials(name: string): string {
    return (
      name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0].toUpperCase())
        .join("") || "?"
    );
  }

  function renderGrid(cells: Cell[], gridClassName: string, maxPerCell: number, roomy = false) {
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
                      ` cal-ev-${eventVisualState(ev)}` +
                      (canWrite ? " cal-event-draggable" : "") +
                      (draggingId === ev.id ? " cal-event-dragging" : "")
                    }
                    style={{ borderLeftColor: stageColor(calendars, ev.event_type) }}
                    title={
                      eventVisualState(ev) === "cancelled"
                        ? "Cancelled"
                        : eventVisualState(ev) === "noshow"
                          ? "Customer did not show"
                          : ev.customer_confirmed
                            ? "Customer confirmed"
                            : "Not confirmed yet"
                    }
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
                    {/* The dot sits alongside the calendar colour rather
                        than replacing it, so one chip can say both what
                        kind of visit it is and whether the customer has
                        confirmed. */}
                    <span className="cal-ev-dot" />
                    <span className="mono cal-event-time">{formatClock(ev.time, timeFormat)}</span>{" "}
                    {ev.assigned_to && repName(ev.assigned_to) && (
                      <span
                        className="cal-rep-avatar"
                        style={{ background: repColor(ev.assigned_to) }}
                        title={repName(ev.assigned_to) ?? undefined}
                      >
                        {repInitials(repName(ev.assigned_to)!)}
                      </span>
                    )}
                    {ev.title}
                    {/* Week cells have the room to say who has agreed to
                        this visit; a month cell does not, and two badges
                        in a 30px chip would bury the title. */}
                    {roomy && (
                      <span className="cal-confirm-row">
                        <span className={"cal-confirm-badge" + (ev.rep_confirmed ? " cal-confirm-on" : "")}>
                          REP {ev.rep_confirmed ? "✓" : "·"}
                        </span>
                        <span
                          className={
                            "cal-confirm-badge" + (ev.customer_confirmed ? " cal-confirm-on" : "")
                          }
                        >
                          CUST {ev.customer_confirmed ? "✓" : "·"}
                        </span>
                      </span>
                    )}
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
          <div
            className={"schedule-row cal-ev-" + eventVisualState(ev)}
            key={ev.id}
            onClick={() => setEditing(ev)}
          >
            <div className="schedule-date">
              <span className="mono schedule-time">{formatTimeRange(ev.time, ev.end_time, timeFormat)}</span>
            </div>
            <div className="schedule-body">
              <div className="schedule-title">{ev.title}</div>
              <div className="schedule-meta">
                <Badge color={stageColor(calendars, ev.event_type)}>{ev.event_type}</Badge>
                <Badge color={EVENT_STATUS_COLOR[ev.status]}>{ev.status}</Badge>
                <span className={"cal-confirm-badge" + (ev.rep_confirmed ? " cal-confirm-on" : "")}>
                  REP {ev.rep_confirmed ? "✓" : "·"}
                </span>
                <span
                  className={"cal-confirm-badge" + (ev.customer_confirmed ? " cal-confirm-on" : "")}
                >
                  CUST {ev.customer_confirmed ? "✓" : "·"}
                </span>
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

          <FilterSelect
            title="CALENDARS"
            options={calendars.map((c) => ({ id: c.name, label: c.name, color: c.color }))}
            selected={calendarFilter}
            onChange={setCalendarFilter}
          />

          <FilterSelect
            title="REP AVAILABILITY"
            // A member with neither name nor email rendered as a blank
            // row with a checkbox beside it -- a filter you cannot tell
            // apart from the one above it.
            options={filterReps.map((r) => ({ id: r.id, label: r.name || r.email || "Unnamed" }))}
            selected={repFilter}
            onChange={setRepFilter}
          />

          {/* Only shown when someone actually holds leads as dispatcher.
              Listing every member with the role would put permanently
              empty checkboxes on the page -- a filter that can only ever
              return nothing is worse than no filter. */}
          {dispatchers.length > 0 && (
            <FilterSelect
              title="DISPATCHER"
              options={dispatchers.map((d) => ({ id: d.id, label: d.name }))}
              selected={dispatcherFilter}
              onChange={setDispatcherFilter}
            />
          )}
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
          {viewMode === "week" && renderGrid(weekCells, "cal-grid-week", 8, true)}

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

      {/* The same two-step wizard the Schedule page and Quick Create
          use -- pick or create the contact, then set the time. The bare
          event form used to open here, with no way to choose a client;
          it remains for EDITING below, where the contact already
          exists. */}
      {showNew && canWrite && (
        <AppointmentWizard
          leads={leads}
          reps={reps}
          stages={stages ?? []}
          calendars={calendars}
          initialDate={newDate}
          onCancel={() => setShowNew(false)}
          onFinished={() => {
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
          onCancel={closeEvent}
          onSaved={closeEvent}
          onDeleted={closeEvent}
        />
      )}
    </div>
  );
}

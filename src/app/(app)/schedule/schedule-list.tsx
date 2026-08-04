"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { useTimeFormat } from "@/components/time-format-context";
import {
  formatTimeRange,
  stageColor,
  type CalendarRow,
  type DocumentRecord,
  type Event,
  type Job,
  type Lead,
  type LeadTask,
  type PipelineStageRow,
  type Profile,
} from "@/lib/data/types";
import { EventForm } from "../calendar/event-form";
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
  documents,
  calendars,
  canWrite,
}: {
  events: Event[];
  jobs: Job[];
  reps: Profile[];
  leads: Lead[];
  stages: PipelineStageRow[];
  leadTasks: LeadTask[];
  documents: DocumentRecord[];
  calendars: CalendarRow[];
  canWrite: boolean;
}) {
  const [editing, setEditing] = useState<Event | null>(null);
  const [showNew, setShowNew] = useState(false);
  const timeFormat = useTimeFormat();

  const sorted = [...events].sort((a, b) =>
    (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? ""))
  );

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
          <p className="module-sub">{events.length} appointments</p>
        </div>
        {canWrite && (
          <button className="btn-primary" onClick={() => setShowNew(true)}>
            + New Appointment
          </button>
        )}
      </div>

      {sorted.length === 0 ? (
        <div className="empty-state">
          <div className="empty-mark" aria-hidden="true">
            ＋
          </div>
          <p className="empty-label">Nothing scheduled</p>
          <p className="empty-hint">Add estimates, site visits, or crew appointments.</p>
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
          leads={leads}
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

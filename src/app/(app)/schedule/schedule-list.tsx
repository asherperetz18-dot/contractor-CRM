"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import type {
  DocumentRecord,
  Event,
  Job,
  Lead,
  LeadTask,
  PipelineStageRow,
  Profile,
} from "@/lib/data/types";
import { EventForm } from "../calendar/event-form";
import { AppointmentWizard } from "./appointment-wizard";

export function ScheduleList({
  events,
  jobs,
  reps,
  leads,
  stages,
  leadTasks,
  documents,
  canWrite,
}: {
  events: Event[];
  jobs: Job[];
  reps: Profile[];
  leads: Lead[];
  stages: PipelineStageRow[];
  leadTasks: LeadTask[];
  documents: DocumentRecord[];
  canWrite: boolean;
}) {
  const [editing, setEditing] = useState<Event | null>(null);
  const [showNew, setShowNew] = useState(false);

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
                <span className="mono schedule-date-num">{ev.date}</span>
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

      {showNew && canWrite && (
        <AppointmentWizard
          leads={leads}
          reps={reps}
          stages={stages}
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
          readOnly={!canWrite}
          onCancel={() => setEditing(null)}
          onSaved={() => setEditing(null)}
          onDeleted={() => setEditing(null)}
        />
      )}
    </div>
  );
}

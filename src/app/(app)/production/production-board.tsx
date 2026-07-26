"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { JOB_COLOR, JOB_STATUSES, type Job, type Profile } from "@/lib/data/types";
import { JobForm } from "./job-form";

export function ProductionBoard({
  jobs,
  assignees,
  canWrite,
}: {
  jobs: Job[];
  assignees: Profile[];
  canWrite: boolean;
}) {
  const [filter, setFilter] = useState<string>("All");
  const [editing, setEditing] = useState<Job | null>(null);
  const [showNew, setShowNew] = useState(false);

  const filtered = filter === "All" ? jobs : jobs.filter((j) => j.status === filter);
  const assigneeName = (id: string | null) =>
    id ? assignees.find((a) => a.id === id)?.name || null : null;

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Production</h1>
          <p className="module-sub">{jobs.length} projects</p>
        </div>
        {canWrite && (
          <button className="btn-primary" onClick={() => setShowNew(true)}>
            + New Job
          </button>
        )}
      </div>

      <div className="chip-row">
        {["All", ...JOB_STATUSES].map((s) => (
          <button
            key={s}
            className={"chip" + (filter === s ? " chip-active" : "")}
            onClick={() => setFilter(s)}
          >
            {s}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-mark" aria-hidden="true">
            ＋
          </div>
          <p className="empty-label">No jobs here</p>
          <p className="empty-hint">
            Jobs created from won leads, or add one directly.
          </p>
        </div>
      ) : (
        <div className="job-grid">
          {filtered.map((j) => (
            <div className="job-card" key={j.id} onClick={() => setEditing(j)}>
              <div className="job-card-top">
                <span className="job-name">{j.name}</span>
                <Badge color={JOB_COLOR[j.status]}>{j.status}</Badge>
              </div>
              {j.address && <div className="job-address">{j.address}</div>}
              <div className="job-meta-row">
                {assigneeName(j.assigned_to) && (
                  <span>👷 {assigneeName(j.assigned_to)}</span>
                )}
                {j.start_date && (
                  <span className="mono">
                    {j.start_date}
                    {j.end_date ? " → " + j.end_date : ""}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showNew && canWrite && (
        <JobForm
          assignees={assignees}
          onCancel={() => setShowNew(false)}
          onSaved={() => setShowNew(false)}
        />
      )}
      {editing && (
        <JobForm
          job={editing}
          assignees={assignees}
          readOnly={!canWrite}
          onCancel={() => setEditing(null)}
          onSaved={() => setEditing(null)}
          onDeleted={() => setEditing(null)}
        />
      )}
    </div>
  );
}

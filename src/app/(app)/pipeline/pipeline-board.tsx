"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  LEAD_STAGES,
  STAGE_COLOR,
  computeLeadWarnings,
  daysSince,
  hasFollowUpDue,
  isColdLead,
  leadDisplayName,
  money,
  type Lead,
  type LeadTask,
  type LeadWarnings,
  type PipelineStage,
  type Profile,
} from "@/lib/data/types";
import { moveLeadStage } from "@/lib/actions/leads";
import { LeadForm } from "./lead-form";
import { AttentionDigest } from "./attention-digest";
import { CsvImportPanel } from "./csv-import-panel";

type StatusFilter = "Open" | "Won" | "Lost";
type SortBy = "Name" | "Days" | "Amount";

export function PipelineBoard({
  leads,
  tasks,
  reps,
  canWrite,
  canDelete,
}: {
  leads: Lead[];
  tasks: LeadTask[];
  reps: Profile[];
  canWrite: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("Open");
  const [sortBy, setSortBy] = useState<SortBy>("Days");
  const [repFilter, setRepFilter] = useState<string>("All Reps");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const tasksByLead = useMemo(() => {
    const map = new Map<string, LeadTask[]>();
    for (const t of tasks) {
      const list = map.get(t.lead_id) ?? [];
      list.push(t);
      map.set(t.lead_id, list);
    }
    return map;
  }, [tasks]);

  const warningsByLead = useMemo(() => {
    const map = new Map<string, LeadWarnings>();
    for (const l of leads) {
      map.set(l.id, computeLeadWarnings(l, l.has_appt, tasksByLead.get(l.id) ?? []));
    }
    return map;
  }, [leads, tasksByLead]);

  function repName(id: string | null) {
    if (!id) return "Unassigned";
    return reps.find((r) => r.id === id)?.name || "Unassigned";
  }

  function handleDrop(stage: string) {
    if (draggedId && canWrite) {
      startTransition(async () => {
        await moveLeadStage(draggedId, stage as PipelineStage);
        router.refresh();
      });
    }
    setDraggedId(null);
    setDragOverStage(null);
  }

  const repFiltered =
    repFilter === "All Reps" ? leads : leads.filter((l) => repName(l.assigned_to) === repFilter);

  const statusFiltered = repFiltered.filter((l) => {
    if (statusFilter === "Open") return !["Won", "Lost"].includes(l.stage);
    if (statusFilter === "Won") return l.stage === "Won";
    return l.stage === "Lost";
  });

  const openLeads = repFiltered.filter((l) => !["Won", "Lost"].includes(l.stage));
  const pipelineValue = openLeads.reduce((s, l) => s + (Number(l.value) || 0), 0);
  const avgDealSize = openLeads.length ? pipelineValue / openLeads.length : 0;
  const wonValue = repFiltered
    .filter((l) => l.stage === "Won")
    .reduce((s, l) => s + (Number(l.value) || 0), 0);
  const staleCount = openLeads.filter((l) => daysSince(l.created_at) > 14).length;
  const noApptCount = openLeads.filter((l) => !l.has_appt).length;

  const followUpsDue = openLeads.filter((l) => hasFollowUpDue(tasksByLead.get(l.id) ?? []));
  const coldLeads = openLeads.filter((l) => {
    const w = warningsByLead.get(l.id);
    return w && isColdLead(w);
  });

  const sortedFiltered = [...statusFiltered].sort((a, b) => {
    if (sortBy === "Name")
      return leadDisplayName(a).localeCompare(leadDisplayName(b));
    if (sortBy === "Amount") return (Number(b.value) || 0) - (Number(a.value) || 0);
    return daysSince(b.created_at) - daysSince(a.created_at);
  });

  const grouped = LEAD_STAGES.filter((s) => !["Won", "Lost"].includes(s)).map(
    (stage) => ({
      stage,
      items: sortedFiltered.filter((l) => l.stage === stage),
    })
  );

  const displayGroups: { stage: string; items: Lead[] }[] =
    statusFilter === "Won"
      ? [{ stage: "Won", items: sortedFiltered }]
      : statusFilter === "Lost"
        ? [{ stage: "Lost", items: sortedFiltered }]
        : grouped;

  const repOptions = ["All Reps", "Unassigned", ...reps.map((r) => r.name || r.email || "")];

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Pipeline</h1>
          <p className="module-sub">
            {leads.length} opps · {statusFilter.toLowerCase()}
          </p>
        </div>
        {canWrite && (
          <div>
            <button className="btn-ghost" onClick={() => setShowImport(true)}>
              Import CSV
            </button>
            <button className="btn-primary" onClick={() => setShowNew(true)}>
              + New Lead
            </button>
          </div>
        )}
      </div>

      <div className="stat-grid stat-grid-5">
        <div className="stat-card stat-static">
          <div className="stat-value mono">{money(pipelineValue)}</div>
          <div className="stat-label">Pipeline Value</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{money(avgDealSize)}</div>
          <div className="stat-label">Avg Deal Size</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{money(wonValue)}</div>
          <div className="stat-label">Won</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{staleCount}</div>
          <div className="stat-label">Stale (&gt;14d)</div>
        </div>
        <div className="stat-card" onClick={() => setStatusFilter("Open")}>
          <div className="stat-value mono">{noApptCount}</div>
          <div className="stat-label">No Appt Yet</div>
        </div>
      </div>

      <AttentionDigest
        followUpsDue={followUpsDue}
        coldLeads={coldLeads}
        warningsByLead={warningsByLead}
        repName={repName}
        onOpenLead={setEditing}
      />

      <div className="filter-bar">
        <div className="chip-row no-margin">
          {(["Open", "Won", "Lost"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              className={"chip" + (statusFilter === s ? " chip-active" : "")}
              onClick={() => setStatusFilter(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="filter-bar-right">
          <select
            className="ur-company-filter"
            value={repFilter}
            onChange={(e) => setRepFilter(e.target.value)}
          >
            {repOptions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <span className="filter-label">Sort by</span>
          {(["Name", "Days", "Amount"] as SortBy[]).map((s) => (
            <button
              key={s}
              className={"chip" + (sortBy === s ? " chip-active" : "")}
              onClick={() => setSortBy(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {leads.length === 0 ? (
        <div className="empty-state">
          <div className="empty-mark" aria-hidden="true">
            ＋
          </div>
          <p className="empty-label">No leads yet</p>
          <p className="empty-hint">
            Add your first lead to start filling the pipeline.
          </p>
        </div>
      ) : (
        <div className="pipeline-board">
          {displayGroups.map(({ stage, items }) => (
            <div
              className={
                "pipeline-col" +
                (dragOverStage === stage && stage !== "Other"
                  ? " pipeline-col-dragover"
                  : "")
              }
              key={stage}
              onDragOver={(e) => {
                if (stage !== "Other") {
                  e.preventDefault();
                  setDragOverStage(stage);
                }
              }}
              onDragLeave={() =>
                setDragOverStage((s) => (s === stage ? null : s))
              }
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(stage);
              }}
            >
              <div className="pipeline-col-head">
                <span
                  className="tick"
                  style={{ background: STAGE_COLOR[stage] }}
                />
                <span>{stage}</span>
                <span className="count-pill">{items.length}</span>
              </div>
              <div className="pipeline-col-body">
                {items.map((l) => {
                  const stale = daysSince(l.created_at);
                  return (
                    <div
                      className={
                        "lead-card" +
                        (draggedId === l.id ? " lead-card-dragging" : "")
                      }
                      key={l.id}
                      draggable={canWrite}
                      onDragStart={(e) => {
                        setDraggedId(l.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => {
                        setDraggedId(null);
                        setDragOverStage(null);
                      }}
                      onClick={() => setEditing(l)}
                    >
                      <div className="lead-card-name-row">
                        <span className="lead-card-name">
                          {leadDisplayName(l)}
                        </span>
                        {l.source && (
                          <span className="source-tag">{l.source}</span>
                        )}
                      </div>
                      {l.phone && <div className="lead-card-line">☎ {l.phone}</div>}
                      {l.email && <div className="lead-card-line">✉ {l.email}</div>}
                      {l.address && (
                        <div className="lead-card-line">📍 {l.address}</div>
                      )}
                      {l.project_type && (
                        <div className="lead-card-project">{l.project_type}</div>
                      )}
                      <div className="lead-card-foot">
                        <span className="mono">{money(l.value)}</span>
                        <span>{repName(l.assigned_to)}</span>
                      </div>
                      {stale > 14 && !["Won", "Lost"].includes(l.stage) && (
                        <div className="lead-card-foot">
                          <span className="stale-tag">● {stale} days — stale</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {showNew && canWrite && (
        <LeadForm
          reps={reps}
          onCancel={() => setShowNew(false)}
          onSaved={() => setShowNew(false)}
        />
      )}
      {showImport && canWrite && (
        <CsvImportPanel onCancel={() => setShowImport(false)} />
      )}
      {editing && (
        <LeadForm
          lead={editing}
          reps={reps}
          tasks={tasksByLead.get(editing.id) ?? []}
          readOnly={!canWrite}
          canDelete={canDelete}
          onCancel={() => setEditing(null)}
          onSaved={() => setEditing(null)}
          onDeleted={() => setEditing(null)}
        />
      )}
    </div>
  );
}

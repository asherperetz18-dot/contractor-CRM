"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  LEAD_STAGES,
  STAGE_COLOR,
  daysSince,
  leadDisplayName,
  money,
  type Lead,
  type PipelineStage,
} from "@/lib/data/types";
import { moveLeadStage } from "@/lib/actions/leads";
import { LeadForm } from "./lead-form";

type StatusFilter = "Open" | "Won" | "Lost";
type SortBy = "Name" | "Days" | "Amount";

export function PipelineBoard({
  leads,
  canWrite,
}: {
  leads: Lead[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("Open");
  const [sortBy, setSortBy] = useState<SortBy>("Days");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [showNew, setShowNew] = useState(false);

  function handleDrop(stage: string) {
    if (draggedId && stage !== "Other" && canWrite) {
      startTransition(async () => {
        await moveLeadStage(draggedId, stage as PipelineStage);
        router.refresh();
      });
    }
    setDraggedId(null);
    setDragOverStage(null);
  }

  const statusFiltered = leads.filter((l) => {
    if (statusFilter === "Open") return !["Won", "Lost"].includes(l.stage);
    if (statusFilter === "Won") return l.stage === "Won";
    return l.stage === "Lost";
  });

  const openLeads = leads.filter((l) => !["Won", "Lost"].includes(l.stage));
  const pipelineValue = openLeads.reduce((s, l) => s + (Number(l.value) || 0), 0);
  const avgDealSize = openLeads.length ? pipelineValue / openLeads.length : 0;
  const wonValue = leads
    .filter((l) => l.stage === "Won")
    .reduce((s, l) => s + (Number(l.value) || 0), 0);
  const staleCount = openLeads.filter((l) => daysSince(l.created_at) > 14).length;
  const noApptCount = openLeads.filter((l) => !l.has_appt).length;

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
          <button className="btn-primary" onClick={() => setShowNew(true)}>
            + New Lead
          </button>
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
        <div
          className="stat-card"
          onClick={() => setStatusFilter("Open")}
        >
          <div className="stat-value mono">{noApptCount}</div>
          <div className="stat-label">No Appt Yet</div>
        </div>
      </div>

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
                        {stale > 14 && !["Won", "Lost"].includes(l.stage) && (
                          <span className="stale-tag">
                            ● {stale} days — stale
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {showNew && canWrite && (
        <LeadForm onCancel={() => setShowNew(false)} onSaved={() => setShowNew(false)} />
      )}
      {editing && (
        <LeadForm
          lead={editing}
          readOnly={!canWrite}
          onCancel={() => setEditing(null)}
          onSaved={() => setEditing(null)}
          onDeleted={() => setEditing(null)}
        />
      )}
    </div>
  );
}

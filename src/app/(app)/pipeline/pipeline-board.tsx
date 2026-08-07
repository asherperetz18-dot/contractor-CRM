"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  computeLeadWarnings,
  daysSince,
  hasFollowUpDue,
  isColdLead,
  isSettledStage,
  leadDisplayName,
  mapsUrl,
  money,
  shortReceivedDate,
  stageColor,
  type CalendarRow,
  type Lead,
  type LeadFile,
  type LeadNote,
  type LeadSourceRow,
  type LeadTask,
  type LeadWarnings,
  type PipelineStage,
  type PipelineStageRow,
  type ProjectTypeRow,
  type Profile,
} from "@/lib/data/types";
import { moveLeadStage } from "@/lib/actions/leads";
import { LeadForm } from "./lead-form";
import { AttentionDigest } from "./attention-digest";
import { CsvImportPanel } from "./csv-import-panel";

type StatusFilter = "Open" | "Won" | "Lost";
type SortBy = "Name" | "Days" | "Amount";
type SortDir = "asc" | "desc";
type AgeFilter = "All" | "7" | "30" | "Stale";

const HIDDEN_STAGES_KEY = "pipeline-hidden-stages";

function loadHiddenStages(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(HIDDEN_STAGES_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function PipelineBoard({
  leads,
  tasks,
  notes,
  files,
  reps,
  stages,
  calendars,
  projectTypes,
  sources,
  canWrite,
  canDelete,
  isAdmin,
}: {
  leads: Lead[];
  tasks: LeadTask[];
  notes: LeadNote[];
  files: LeadFile[];
  reps: Profile[];
  stages: PipelineStageRow[];
  calendars: CalendarRow[];
  projectTypes: ProjectTypeRow[];
  sources: LeadSourceRow[];
  canWrite: boolean;
  canDelete: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("Open");
  const [sortBy, setSortBy] = useState<SortBy>("Days");
  // Ascending by default. Paired with the Days sort that means newest
  // leads sit at the top of each column, which is the order they need
  // working in -- descending buried today's arrivals under year-old
  // imported ones.
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [repFilter, setRepFilter] = useState<string>("All Reps");
  const [ageFilter, setAgeFilter] = useState<AgeFilter>("All");
  const [noApptOnly, setNoApptOnly] = useState(false);
  const [hiddenStages, setHiddenStages] = useState<Set<string>>(() => loadHiddenStages());
  const [showColumnsMenu, setShowColumnsMenu] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [scrollMetrics, setScrollMetrics] = useState({ scrollLeft: 0, scrollWidth: 0, clientWidth: 0 });
  const [dragThumb, setDragThumb] = useState<{ startX: number; startScrollLeft: number } | null>(
    null
  );
  const scrollElRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showValueBreakdown, setShowValueBreakdown] = useState(false);
  const [showImport, setShowImport] = useState(false);

  // Narrows the board to one stage. Hiding every other column is what
  // "take me to that pipeline" means on a kanban -- the previous handler
  // cleared the hidden set instead, which showed all fifteen columns
  // again, the opposite of what was asked for. Restore them from the
  // Columns menu.
  function focusStage(stage: string) {
    const others = stages.map((s) => s.name).filter((n) => n !== stage);
    setHiddenStages(new Set(others));
    window.localStorage.setItem(HIDDEN_STAGES_KEY, JSON.stringify(others));
    setShowValueBreakdown(false);
    scrollElRef.current?.scrollTo({ left: 0, behavior: "smooth" });
  }

  function showAllStages() {
    setHiddenStages(new Set());
    window.localStorage.setItem(HIDDEN_STAGES_KEY, "[]");
  }

  function toggleStageVisible(name: string) {
    setHiddenStages((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      window.localStorage.setItem(HIDDEN_STAGES_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  function measureScroll(el: HTMLDivElement) {
    setScrollMetrics({
      scrollLeft: el.scrollLeft,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    });
  }

  const setScrollContainer = useCallback((node: HTMLDivElement | null) => {
    scrollElRef.current = node;
    if (!node) return;
    measureScroll(node);
    const onScroll = () => measureScroll(node);
    node.addEventListener("scroll", onScroll);
    return () => node.removeEventListener("scroll", onScroll);
  }, []);

  function scrollByAmount(delta: number) {
    scrollElRef.current?.scrollBy({ left: delta, behavior: "smooth" });
  }

  useEffect(() => {
    if (!dragThumb) return;
    function onMove(e: MouseEvent) {
      const el = scrollElRef.current;
      if (!el || !dragThumb) return;
      const trackWidth = trackRef.current?.clientWidth ?? el.clientWidth;
      const scrollableWidth = el.scrollWidth - el.clientWidth;
      const thumbWidth = trackWidth * (el.clientWidth / el.scrollWidth);
      const draggableTrack = Math.max(1, trackWidth - thumbWidth);
      const ratio = scrollableWidth / draggableTrack;
      const deltaX = e.clientX - dragThumb.startX;
      el.scrollLeft = dragThumb.startScrollLeft + deltaX * ratio;
      measureScroll(el);
    }
    function onUp() {
      setDragThumb(null);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragThumb]);

  const tasksByLead = useMemo(() => {
    const map = new Map<string, LeadTask[]>();
    for (const t of tasks) {
      const list = map.get(t.lead_id) ?? [];
      list.push(t);
      map.set(t.lead_id, list);
    }
    return map;
  }, [tasks]);

  const notesByLead = useMemo(() => {
    const map = new Map<string, LeadNote[]>();
    for (const n of notes) {
      const list = map.get(n.lead_id) ?? [];
      list.push(n);
      map.set(n.lead_id, list);
    }
    return map;
  }, [notes]);

  const filesByLead = useMemo(() => {
    const map = new Map<string, LeadFile[]>();
    for (const f of files) {
      const list = map.get(f.lead_id) ?? [];
      list.push(f);
      map.set(f.lead_id, list);
    }
    return map;
  }, [files]);

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
    if (statusFilter === "Open") return !isSettledStage(l.stage);
    if (statusFilter === "Won") return l.stage === "Won";
    return l.stage === "Lost";
  });

  const ageFiltered = statusFiltered.filter((l) => {
    if (ageFilter === "All") return true;
    const age = daysSince(l.date_received);
    if (ageFilter === "7") return age <= 7;
    if (ageFilter === "30") return age <= 30;
    return age > 14;
  });

  const apptFiltered = noApptOnly ? ageFiltered.filter((l) => !l.has_appt) : ageFiltered;

  const openLeads = repFiltered.filter((l) => !isSettledStage(l.stage));
  const pipelineValue = openLeads.reduce((s, l) => s + (Number(l.value) || 0), 0);
  const avgDealSize = openLeads.length ? pipelineValue / openLeads.length : 0;
  const wonValue = repFiltered
    .filter((l) => l.stage === "Won")
    .reduce((s, l) => s + (Number(l.value) || 0), 0);
  const staleCount = openLeads.filter((l) => daysSince(l.date_received) > 14).length;
  // What the two money figures are actually made of. A value of 0 is
  // counted as a lead but contributes nothing, which is why the note
  // below the table says how many of those there are -- otherwise the
  // averages look inexplicably low.
  const leadsWithNoValue = openLeads.filter((l) => !Number(l.value)).length;
  const valueByStage = (() => {
    const map = new Map<string, { count: number; value: number }>();
    for (const l of openLeads) {
      const row = map.get(l.stage) ?? { count: 0, value: 0 };
      row.count += 1;
      row.value += Number(l.value) || 0;
      map.set(l.stage, row);
    }
    return [...map.entries()]
      .map(([stage, row]) => ({ stage, ...row }))
      .sort((a, b) => b.value - a.value || b.count - a.count);
  })();
  const noApptCount = openLeads.filter((l) => !l.has_appt).length;

  const followUpsDue = openLeads.filter((l) => hasFollowUpDue(tasksByLead.get(l.id) ?? []));
  const coldLeads = openLeads.filter((l) => {
    const w = warningsByLead.get(l.id);
    return w && isColdLead(w);
  });

  const sortedFiltered = [...apptFiltered].sort((a, b) => {
    let cmp: number;
    if (sortBy === "Name") cmp = leadDisplayName(a).localeCompare(leadDisplayName(b));
    else if (sortBy === "Amount") cmp = (Number(a.value) || 0) - (Number(b.value) || 0);
    else cmp = daysSince(a.date_received) - daysSince(b.date_received);
    return sortDir === "asc" ? cmp : -cmp;
  });

  const openStageNames = stages.map((s) => s.name).filter((s) => !isSettledStage(s));
  const visibleStageNames = openStageNames.filter((s) => !hiddenStages.has(s));
  const visibleColumnCount = openStageNames.length - hiddenStages.size;

  const grouped = visibleStageNames.map((stage) => ({
    stage,
    items: sortedFiltered.filter((l) => l.stage === stage),
  }));

  const displayGroups: { stage: string; items: Lead[] }[] =
    statusFilter === "Won"
      ? [{ stage: "Won", items: sortedFiltered }]
      : statusFilter === "Lost"
        ? [{ stage: "Lost", items: sortedFiltered }]
        : grouped;

  const repOptions = ["All Reps", "Unassigned", ...reps.map((r) => r.name || r.email || "")];

  const clientWidth = scrollMetrics.clientWidth || 1;
  const totalScrollWidth = scrollMetrics.scrollWidth || clientWidth;
  const thumbWidthPct = Math.min(100, (clientWidth / totalScrollWidth) * 100);
  const maxScroll = Math.max(1, totalScrollWidth - clientWidth);
  const thumbLeftPct = (scrollMetrics.scrollLeft / maxScroll) * (100 - thumbWidthPct);
  const canScrollLeft = scrollMetrics.scrollLeft > 2;
  const canScrollRight = scrollMetrics.scrollLeft < maxScroll - 2;
  const showScrollbar = totalScrollWidth > clientWidth + 4;

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

      {/* Every card acts on the board below rather than navigating: the
          detail behind these numbers is the lead list already on screen,
          so filtering it in place beats a second page that shows the same
          rows. The two money figures have no equivalent filter -- they're
          sums over every open lead -- so those open a breakdown instead. */}
      <div className="stat-grid stat-grid-5">
        <div
          className={"stat-card" + (showValueBreakdown ? " stat-card-active" : "")}
          onClick={() => setShowValueBreakdown((v) => !v)}
          title="Show what makes up this total, stage by stage"
        >
          <div className="stat-value mono">{money(pipelineValue)}</div>
          <div className="stat-label">Pipeline Value</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{money(avgDealSize)}</div>
          <div className="stat-label">Avg Deal Size</div>
        </div>
        <div
          className={"stat-card" + (statusFilter === "Won" ? " stat-card-active" : "")}
          onClick={() => setStatusFilter((s) => (s === "Won" ? "Open" : "Won"))}
          title="Toggle: show the won deals behind this figure"
        >
          <div className="stat-value mono">{money(wonValue)}</div>
          <div className="stat-label">Won</div>
        </div>
        <div
          className={"stat-card" + (ageFilter === "Stale" ? " stat-card-active" : "")}
          onClick={() => setAgeFilter((a) => (a === "Stale" ? "All" : "Stale"))}
          title="Toggle: show only leads older than 14 days"
        >
          <div className="stat-value mono">{staleCount}</div>
          <div className="stat-label">Stale (&gt;14d)</div>
        </div>
        <div
          className={"stat-card" + (noApptOnly ? " stat-card-active" : "")}
          onClick={() => setNoApptOnly((v) => !v)}
          title="Toggle: show only leads with no appointment yet"
        >
          <div className="stat-value mono">{noApptCount}</div>
          <div className="stat-label">No Appt Yet</div>
        </div>
      </div>

      {showValueBreakdown && (
        <div className="value-breakdown">
          <div className="value-breakdown-head">
            <span>Open pipeline by stage</span>
            <button
              type="button"
              className="btn-ghost small"
              onClick={() => setShowValueBreakdown(false)}
            >
              Close
            </button>
          </div>
          {valueByStage.length === 0 ? (
            <p className="empty-hint">No open leads to break down.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Stage</th>
                  <th className="right">Leads</th>
                  <th className="right">Value</th>
                  <th className="right">Avg</th>
                </tr>
              </thead>
              <tbody>
                {valueByStage.map((row) => (
                  <tr
                    key={row.stage}
                    className="value-breakdown-row"
                    onClick={() => focusStage(row.stage)}
                    title={`Show only the ${row.stage} column`}
                  >
                    <td>{row.stage}</td>
                    <td className="right mono">{row.count}</td>
                    <td className="right mono">{money(row.value)}</td>
                    <td className="right mono">
                      {money(row.count ? row.value / row.count : 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="hint-note">
            {leadsWithNoValue} of {openLeads.length} open leads have no value recorded, so
            they add nothing to these totals.
          </p>
        </div>
      )}

      {hiddenStages.size > 0 && (
        // Hidden columns persist across reloads, so without this the board
        // just looks like most of the pipeline vanished.
        <div className="stage-focus-bar">
          <span>
            Showing <strong>{visibleColumnCount}</strong> of {openStageNames.length} stages
          </span>
          <button type="button" className="btn-ghost small" onClick={showAllStages}>
            Show all stages
          </button>
        </div>
      )}

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
          <button
            className={"chip" + (noApptOnly ? " chip-active" : "")}
            onClick={() => setNoApptOnly((v) => !v)}
          >
            No Appt Yet
          </button>
          <select
            className="ur-company-filter"
            value={ageFilter}
            onChange={(e) => setAgeFilter(e.target.value as AgeFilter)}
          >
            <option value="All">All Ages</option>
            <option value="7">Last 7 Days</option>
            <option value="30">Last 30 Days</option>
            <option value="Stale">14+ Days (Stale)</option>
          </select>
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
          <button
            className="icon-btn"
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            title={sortDir === "desc" ? "Descending — click for ascending" : "Ascending — click for descending"}
            aria-label="Toggle sort direction"
          >
            {sortDir === "desc" ? "↓" : "↑"}
          </button>
          <div className="columns-menu-wrap">
            <button className="btn-ghost" onClick={() => setShowColumnsMenu((v) => !v)}>
              Columns ({visibleColumnCount}/{openStageNames.length})
            </button>
            {showColumnsMenu && (
              <>
                <div
                  className="quick-create-backdrop"
                  onClick={() => setShowColumnsMenu(false)}
                />
                <div className="columns-menu">
                  {openStageNames.map((name) => (
                    <label key={name} className="columns-menu-item">
                      <input
                        type="checkbox"
                        checked={!hiddenStages.has(name)}
                        onChange={() => toggleStageVisible(name)}
                      />
                      {name}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
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
        <>
          {showScrollbar && (
            <div className="pipeline-scrollbar">
              <button
                className="pipeline-scroll-arrow"
                onClick={() => scrollByAmount(-320)}
                disabled={!canScrollLeft}
                aria-label="Scroll left"
              >
                ◀
              </button>
              <div className="pipeline-scroll-track" ref={trackRef}>
                <div
                  className="pipeline-scroll-thumb"
                  style={{ width: `${thumbWidthPct}%`, left: `${thumbLeftPct}%` }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setDragThumb({ startX: e.clientX, startScrollLeft: scrollMetrics.scrollLeft });
                  }}
                />
              </div>
              <button
                className="pipeline-scroll-arrow"
                onClick={() => scrollByAmount(320)}
                disabled={!canScrollRight}
                aria-label="Scroll right"
              >
                ▶
              </button>
            </div>
          )}
        <div className="pipeline-board" ref={setScrollContainer}>
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
                  style={{ background: stageColor(stages, stage) }}
                />
                <span>{stage}</span>
                <span className="count-pill">{items.length}</span>
              </div>
              <div className="pipeline-col-body">
                {items.map((l) => {
                  const stale = daysSince(l.date_received);
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
                        <div className="lead-card-line">
                          📍{" "}
                          <a
                            href={mapsUrl(l.address)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {l.address}
                          </a>
                        </div>
                      )}
                      {l.project_type && (
                        <div className="lead-card-project">{l.project_type}</div>
                      )}
                      <div className="lead-card-foot">
                        <span className="mono">{money(l.value)}</span>
                        <span>{repName(l.assigned_to)}</span>
                      </div>
                      <div className="lead-card-foot">
                        <span
                          className={"lead-card-date" + (stale > 14 ? " lead-card-date-old" : "")}
                          title={`Received ${l.date_received} — ${stale} day${stale === 1 ? "" : "s"} ago`}
                        >
                          {shortReceivedDate(l.date_received)}
                        </span>
                        {/* Clamped: a lead dated in the future is a typo,
                            and "-3d old" reads as a bug. */}
                        <span className="lead-card-age">
                          {stale <= 0 ? "today" : `${stale}d`}
                        </span>
                      </div>
                      {stale > 14 && !isSettledStage(l.stage) && (
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
        </>
      )}

      {showNew && canWrite && (
        <LeadForm
          reps={reps}
          stages={stages}
          calendars={calendars}
          projectTypes={projectTypes}
          sources={sources}
          onCancel={() => setShowNew(false)}
          onSaved={() => setShowNew(false)}
        />
      )}
      {showImport && canWrite && (
        <CsvImportPanel stages={stages} onCancel={() => setShowImport(false)} />
      )}
      {editing && (
        <LeadForm
          lead={editing}
          reps={reps}
          stages={stages}
          calendars={calendars}
          projectTypes={projectTypes}
          sources={sources}
          tasks={tasksByLead.get(editing.id) ?? []}
          notes={notesByLead.get(editing.id) ?? []}
          files={filesByLead.get(editing.id) ?? []}
          readOnly={!canWrite}
          canDelete={canDelete}
          isAdmin={isAdmin}
          onCancel={() => setEditing(null)}
          onSaved={() => setEditing(null)}
          onDeleted={() => setEditing(null)}
        />
      )}
    </div>
  );
}

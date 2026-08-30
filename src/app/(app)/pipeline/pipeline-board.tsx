"use client";

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
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
import type { DispatcherPickerBootstrap } from "../calendar/dispatcher-picker";
import type { LeadEstimateIndex } from "@/lib/data/lead-estimate-index";
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

// Cards rendered in a column up front, and added as it is scrolled.
// Comfortably more than a column shows at once.
const CARD_BATCH = 40;

/**
 * One stage column, memoized. Opening the lead window is a state change
 * on the board, and before this it re-rendered every card of every
 * stage -- thousands of DOM nodes reconciled per click, which is what
 * made a lead card take seconds to open on a full book. With stable
 * items arrays and handlers, that render now skips the columns
 * entirely; only an actual drag touches them.
 */
const PipelineColumn = memo(function PipelineColumn({
  stage,
  items,
  stages,
  canWrite,
  isDragOver,
  draggedId,
  repById,
  onOpenLead,
  onDragStartCard,
  onDragEndCard,
  onDragOverCol,
  onDragLeaveCol,
  onDropCol,
}: {
  stage: string;
  items: Lead[];
  stages: PipelineStageRow[];
  canWrite: boolean;
  isDragOver: boolean;
  draggedId: string | null;
  repById: Map<string, string>;
  onOpenLead: (lead: Lead) => void;
  onDragStartCard: (id: string) => void;
  onDragEndCard: () => void;
  onDragOverCol: (stage: string) => void;
  onDragLeaveCol: (stage: string) => void;
  onDropCol: (stage: string) => void;
}) {
  /**
   * Cards enter the page as the column is scrolled, not all at once.
   *
   * The board rendered every lead in every stage: 36,379 DOM nodes on a
   * full book, against a recommended ceiling nearer 1,400, which made
   * this one of the two slowest pages to open and the worst of them on a
   * phone. A column shows a handful of cards at a time and nobody reads
   * a thousand of them.
   *
   * Dragging is unaffected: a card can only be picked up if it is on
   * screen, and a drop targets the column rather than a position within
   * it. The count in the header still counts every lead in the stage,
   * not the rendered ones.
   */
  const [shown, setShown] = useState(CARD_BATCH);
  const visible = shown >= items.length ? items : items.slice(0, shown);
  const remaining = items.length - visible.length;
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const end = endRef.current;
    if (!end) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setShown((n) => n + CARD_BATCH);
      },
      { rootMargin: "600px" }
    );
    io.observe(end);
    return () => io.disconnect();
  }, [shown, items.length]);

  return (
    <div
      className={
        "pipeline-col" + (isDragOver && stage !== "Other" ? " pipeline-col-dragover" : "")
      }
      onDragOver={(e) => {
        if (stage !== "Other") {
          e.preventDefault();
          onDragOverCol(stage);
        }
      }}
      onDragLeave={() => onDragLeaveCol(stage)}
      onDrop={(e) => {
        e.preventDefault();
        onDropCol(stage);
      }}
    >
      <div className="pipeline-col-head">
        <span className="tick" style={{ background: stageColor(stages, stage) }} />
        <span>{stage}</span>
        <span className="count-pill">{items.length}</span>
      </div>
      <div className="pipeline-col-body">
        {visible.map((l) => {
          const stale = daysSince(l.date_received);
          return (
            <div
              className={"lead-card" + (draggedId === l.id ? " lead-card-dragging" : "")}
              key={l.id}
              draggable={canWrite}
              onDragStart={(e) => {
                onDragStartCard(l.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={onDragEndCard}
              onClick={() => onOpenLead(l)}
            >
              <div className="lead-card-name-row">
                <span className="lead-card-name">{leadDisplayName(l)}</span>
                {l.source && <span className="source-tag">{l.source}</span>}
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
              {l.project_type && <div className="lead-card-project">{l.project_type}</div>}
              <div className="lead-card-foot">
                <span className="mono">{money(l.value)}</span>
                <span>
                  {(l.assigned_to && repById.get(l.assigned_to)) || "Unassigned"}
                </span>
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
                <span className="lead-card-age">{stale <= 0 ? "today" : `${stale}d`}</span>
              </div>
              {stale > 14 && !isSettledStage(l.stage) && (
                <div className="lead-card-foot">
                  <span className="stale-tag">● {stale} days — stale</span>
                </div>
              )}
            </div>
          );
        })}
        {remaining > 0 && (
          <div ref={endRef} className="pipeline-col-more">
            {remaining.toLocaleString()} more
          </div>
        )}
      </div>
    </div>
  );
});

export function PipelineBoard({
  leads,
  tasks,
  notes,
  files,
  reps,
  allMembers,
  stages,
  calendars,
  projectTypes,
  sources,
  canWrite,
  canCreateLeads,
  canDelete,
  isAdmin,
  estimateIndex,
  dispatcherPicker,
}: {
  leads: Lead[];
  tasks: LeadTask[];
  notes: LeadNote[];
  files: LeadFile[];
  reps: Profile[];
  /** For putting a name to an id only -- includes deactivated members. */
  allMembers: Profile[];
  stages: PipelineStageRow[];
  calendars: CalendarRow[];
  projectTypes: ProjectTypeRow[];
  sources: LeadSourceRow[];
  canWrite: boolean;
  /** Adding to the book is narrower than working it -- a plain
      dispatcher edits their leads but may not enter new ones. */
  canCreateLeads: boolean;
  canDelete: boolean;
  isAdmin: boolean;
  estimateIndex: LeadEstimateIndex;
  dispatcherPicker?: DispatcherPickerBootstrap;
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
  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  const [showWonBreakdown, setShowWonBreakdown] = useState(false);
  const [showImport, setShowImport] = useState(false);

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

  // A Map instead of reps.find per lead: the rep filter and every card
  // footer used to do a linear scan of the roster per lead per render.
  const repById = useMemo(
    () => new Map(reps.map((r) => [r.id, r.name || "Unassigned"])),
    [reps]
  );
  function repName(id: string | null) {
    if (!id) return "Unassigned";
    return repById.get(id) || "Unassigned";
  }

  /**
   * The dispatcher holding this lead.
   *
   * Looked up against every member rather than the Active ones, and says
   * "—" rather than "Unassigned" when the field is empty: most leads
   * genuinely have no dispatcher, and printing "Unassigned" next to the
   * rep column would read as a gap to fill rather than a field nobody
   * uses on that lead.
   */
  function dispatcherName(id: string | null) {
    if (!id) return "—";
    const m = allMembers.find((r) => r.id === id);
    if (!m) return "—";
    return (m.name || m.email || "—") + (m.status === "Active" ? "" : " (inactive)");
  }

  // Stable handlers for the memoized columns. Identity only changes
  // while a drag is actually in flight, so opening the lead window (a
  // setEditing render) leaves every column's props untouched and
  // React.memo skips re-rendering the whole board.
  const onDropCol = useCallback(
    (stage: string) => {
      if (draggedId && canWrite) {
        startTransition(async () => {
          await moveLeadStage(draggedId, stage as PipelineStage);
          router.refresh();
        });
      }
      setDraggedId(null);
      setDragOverStage(null);
    },
    [draggedId, canWrite, router, startTransition]
  );
  const onDragEndCard = useCallback(() => {
    setDraggedId(null);
    setDragOverStage(null);
  }, []);
  const onDragLeaveCol = useCallback((stage: string) => {
    setDragOverStage((s) => (s === stage ? null : s));
  }, []);

  // The whole filter/sort/group chain is memoized so its arrays keep
  // their identity across unrelated renders. Before this, clicking a
  // card re-ran a dozen full passes over every lead -- and rebuilt
  // every column's items array, which would also have made memoizing
  // the columns pointless -- before the lead window could paint.
  const repFiltered = useMemo(
    () =>
      repFilter === "All Reps"
        ? leads
        : leads.filter(
            (l) => ((l.assigned_to && repById.get(l.assigned_to)) || "Unassigned") === repFilter
          ),
    [leads, repFilter, repById]
  );

  const statusFiltered = useMemo(
    () =>
      repFiltered.filter((l) => {
        if (statusFilter === "Open") return !isSettledStage(l.stage);
        if (statusFilter === "Won") return l.stage === "Won";
        return l.stage === "Lost";
      }),
    [repFiltered, statusFilter]
  );

  const ageFiltered = useMemo(
    () =>
      statusFiltered.filter((l) => {
        if (ageFilter === "All") return true;
        const age = daysSince(l.date_received);
        if (ageFilter === "7") return age <= 7;
        if (ageFilter === "30") return age <= 30;
        return age > 14;
      }),
    [statusFiltered, ageFilter]
  );

  const apptFiltered = useMemo(
    () => (noApptOnly ? ageFiltered.filter((l) => !l.has_appt) : ageFiltered),
    [ageFiltered, noApptOnly]
  );

  const openLeads = useMemo(() => repFiltered.filter((l) => !isSettledStage(l.stage)), [repFiltered]);
  const pipelineValue = openLeads.reduce((s, l) => s + (Number(l.value) || 0), 0);
  const avgDealSize = openLeads.length ? pipelineValue / openLeads.length : 0;
  const wonLeads = useMemo(
    () =>
      repFiltered
        .filter((l) => l.stage === "Won")
        .sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0)),
    [repFiltered]
  );
  const wonValue = wonLeads.reduce((s, l) => s + (Number(l.value) || 0), 0);
  const staleCount = useMemo(
    () => openLeads.filter((l) => daysSince(l.date_received) > 14).length,
    [openLeads]
  );
  // What the two money figures are actually made of. A value of 0 is
  // counted as a lead but contributes nothing, which is why the note
  // below the table says how many of those there are -- otherwise the
  // averages look inexplicably low.
  const leadsWithNoValue = useMemo(
    () => openLeads.filter((l) => !Number(l.value)).length,
    [openLeads]
  );
  const valueByStage = useMemo(() => {
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
  }, [openLeads]);
  const noApptCount = useMemo(() => openLeads.filter((l) => !l.has_appt).length, [openLeads]);

  const followUpsDue = useMemo(
    () => openLeads.filter((l) => hasFollowUpDue(tasksByLead.get(l.id) ?? [])),
    [openLeads, tasksByLead]
  );
  const coldLeads = useMemo(
    () =>
      openLeads.filter((l) => {
        const w = warningsByLead.get(l.id);
        return w && isColdLead(w);
      }),
    [openLeads, warningsByLead]
  );

  const sortedFiltered = useMemo(
    () =>
      [...apptFiltered].sort((a, b) => {
        let cmp: number;
        if (sortBy === "Name") cmp = leadDisplayName(a).localeCompare(leadDisplayName(b));
        else if (sortBy === "Amount") cmp = (Number(a.value) || 0) - (Number(b.value) || 0);
        else cmp = daysSince(a.date_received) - daysSince(b.date_received);
        return sortDir === "asc" ? cmp : -cmp;
      }),
    [apptFiltered, sortBy, sortDir]
  );

  const openStageNames = useMemo(
    () => stages.map((s) => s.name).filter((s) => !isSettledStage(s)),
    [stages]
  );
  const visibleStageNames = useMemo(
    () => openStageNames.filter((s) => !hiddenStages.has(s)),
    [openStageNames, hiddenStages]
  );
  // Counted from the rendered list, not by subtracting the hidden set --
  // that set can contain settled stages which were never columns, which
  // made a focused board report "-1 of 15".
  const visibleColumnCount = visibleStageNames.length;

  const displayGroups: { stage: string; items: Lead[] }[] = useMemo(() => {
    if (statusFilter === "Won") return [{ stage: "Won", items: sortedFiltered }];
    if (statusFilter === "Lost") return [{ stage: "Lost", items: sortedFiltered }];
    return visibleStageNames.map((stage) => ({
      stage,
      items: sortedFiltered.filter((l) => l.stage === stage),
    }));
  }, [statusFilter, sortedFiltered, visibleStageNames]);

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
        {canCreateLeads && (
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
          className={
            "stat-card" +
            (pipelineValue > 0 ? " stat-card-gold" : "") +
            (showValueBreakdown ? " stat-card-active" : "")
          }
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
          className={
            "stat-card" +
            // Green only once something has actually been won. A green box
            // reading $0 is not encouragement, it is a reminder.
            (wonValue > 0 ? " stat-card-won" : "") +
            (showWonBreakdown ? " stat-card-active" : "")
          }
          onClick={() => setShowWonBreakdown((v) => !v)}
          title="Show the deals behind this figure"
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
                {valueByStage.map((row) => {
                  const open = expandedStage === row.stage;
                  // The leads themselves, right under the row that was
                  // clicked. Narrowing the board's columns instead was too
                  // indirect -- the board still looked like a board, so it
                  // read as "nothing happened".
                  const stageLeads = open
                    ? openLeads
                        .filter((l) => l.stage === row.stage)
                        .sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))
                    : [];
                  return (
                    <Fragment key={row.stage}>
                      <tr
                        className={"value-breakdown-row" + (open ? " is-open" : "")}
                        onClick={() => setExpandedStage(open ? null : row.stage)}
                        title={open ? "Hide these leads" : `Show the ${row.count} leads here`}
                      >
                        <td>
                          <span className="value-breakdown-caret">{open ? "▾" : "▸"}</span>{" "}
                          {row.stage}
                        </td>
                        <td className="right mono">{row.count}</td>
                        <td className="right mono">{money(row.value)}</td>
                        <td className="right mono">
                          {money(row.count ? row.value / row.count : 0)}
                        </td>
                      </tr>
                      {open && (
                        <tr className="value-breakdown-detail">
                          <td colSpan={4}>
                            <div className="value-lead-list">
                              {stageLeads.map((l) => (
                                <div
                                  key={l.id}
                                  className="value-lead-row"
                                  onClick={() => setEditing(l)}
                                  title="Open this contact"
                                >
                                  <span className="value-lead-name">{leadDisplayName(l)}</span>
                                  <span className="value-lead-meta">
                                    {l.phone || "no phone"} · {repName(l.assigned_to)}
                                  </span>
                                  <span className="mono value-lead-value">{money(l.value)}</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
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


      {showWonBreakdown && (
        <div className="value-breakdown">
          <div className="value-breakdown-head">
            <span>Won deals</span>
            <button
              type="button"
              className="btn-ghost small"
              onClick={() => setShowWonBreakdown(false)}
            >
              Close
            </button>
          </div>
          {wonLeads.length === 0 ? (
            <p className="empty-hint">No won deals yet.</p>
          ) : (
            <div className="value-lead-list">
              {wonLeads.map((l) => (
                <div
                  key={l.id}
                  className="value-lead-row"
                  onClick={() => setEditing(l)}
                  title="Open this contact"
                >
                  <span className="value-lead-name">{leadDisplayName(l)}</span>
                  <span className="value-lead-meta">
                    {l.phone || "no phone"} · {repName(l.assigned_to)}
                  </span>
                  <span className="mono value-lead-value">{money(l.value)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="hint-note">
            {wonLeads.filter((l) => !Number(l.value)).length} of {wonLeads.length} won deals
            have no value recorded, so they add nothing to the total.
          </p>
        </div>
      )}

      <AttentionDigest
        followUpsDue={followUpsDue}
        coldLeads={coldLeads}
        warningsByLead={warningsByLead}
        repName={repName}
        dispatcherName={dispatcherName}
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
            <PipelineColumn
              key={stage}
              stage={stage}
              items={items}
              stages={stages}
              canWrite={canWrite}
              isDragOver={dragOverStage === stage}
              draggedId={draggedId}
              repById={repById}
              onOpenLead={setEditing}
              onDragStartCard={setDraggedId}
              onDragEndCard={onDragEndCard}
              onDragOverCol={setDragOverStage}
              onDragLeaveCol={onDragLeaveCol}
              onDropCol={onDropCol}
            />
          ))}
        </div>
        </>
      )}

      {showNew && canCreateLeads && (
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
          estimateIndex={estimateIndex}
          dispatcherPicker={dispatcherPicker}
          onCancel={() => setEditing(null)}
          onSaved={() => setEditing(null)}
          onDeleted={() => setEditing(null)}
        />
      )}
    </div>
  );
}

"use client";

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  daysSince,
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
  type PipelineStage,
  type PipelineStageRow,
  type ProjectTypeRow,
  type Profile,
} from "@/lib/data/types";
import { repDropdownOptions } from "@/lib/data/rep-options";
import { moveLeadStage } from "@/lib/actions/leads";
import { getLeadCard, getPipelineBoardData, getStageCards } from "@/lib/actions/pipeline-board";
import type { BoardCard, PipelineBoardData, PipelineBoardQuery } from "@/lib/pipeline-board-types";
import { PIPELINE_CARD_WINDOW } from "./board-query";
import { LeadForm } from "./lead-form";
import type { DispatcherPickerBootstrap } from "../calendar/dispatcher-picker";
import type { LeadEstimateIndex } from "@/lib/data/lead-estimate-index";
import { AttentionDigest } from "./attention-digest";
import { CsvImportPanel } from "./csv-import-panel";
import { BulkEmailModal } from "@/components/bulk-email-modal";

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
  count,
  stages,
  canWrite,
  isDragOver,
  draggedId,
  repById,
  onOpenLead,
  onLoadMore,
  onDragStartCard,
  onDragEndCard,
  onDragOverCol,
  onDragLeaveCol,
  onDropCol,
  selectMode,
  selected,
  onToggleSelect,
}: {
  stage: string;
  items: BoardCard[];
  /** Every lead in the stage, not just the fetched window. */
  count: number;
  stages: PipelineStageRow[];
  canWrite: boolean;
  isDragOver: boolean;
  draggedId: string | null;
  repById: Map<string, string>;
  onOpenLead: (card: BoardCard) => void;
  /** Ask the server for the column's next window of cards. */
  onLoadMore: (stage: string) => void;
  onDragStartCard: (id: string) => void;
  onDragEndCard: () => void;
  onDragOverCol: (stage: string) => void;
  onDragLeaveCol: (stage: string) => void;
  onDropCol: (stage: string) => void;
  selectMode: boolean;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
}) {
  /**
   * Cards arrive from the server as the column is scrolled, not all at
   * once: the page carries each column's first window, and reaching the
   * bottom asks for the next. The count in the header still counts
   * every lead in the stage, not the fetched ones. Dragging is
   * unaffected: a card can only be picked up if it is on screen, and a
   * drop targets the column rather than a position within it.
   */
  const visible = items;
  const remaining = Math.max(0, count - visible.length);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const end = endRef.current;
    if (!end) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMore(stage);
      },
      { rootMargin: "600px" }
    );
    io.observe(end);
    return () => io.disconnect();
  }, [stage, onLoadMore, items.length]);

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
        <span className="count-pill">{count.toLocaleString()}</span>
      </div>
      <div className="pipeline-col-body">
        {visible.map((l) => {
          const stale = daysSince(l.date_received);
          return (
            <div
              className={
                "lead-card" +
                (draggedId === l.id ? " lead-card-dragging" : "") +
                (selectMode && selected.has(l.id) ? " lead-card-selected" : "")
              }
              key={l.id}
              // Dragging and multi-select don't mix -- a drag gesture
              // started on a card that's meant to be checked off would
              // silently also try to move its stage.
              draggable={canWrite && !selectMode}
              onDragStart={(e) => {
                onDragStartCard(l.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={onDragEndCard}
              onClick={() => (selectMode ? onToggleSelect(l.id) : onOpenLead(l))}
            >
              <div className="lead-card-name-row">
                {selectMode && (
                  <input
                    type="checkbox"
                    checked={selected.has(l.id)}
                    onChange={() => onToggleSelect(l.id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Select ${leadDisplayName(l)}`}
                  />
                )}
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
  initialBoard,
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
  canManageMoney,
  estimateIndex,
  dispatcherPicker,
}: {
  initialBoard: PipelineBoardData | null;
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
  canManageMoney?: boolean;
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
  // "All" | "unassigned" | a rep's profile id -- ids, not display
  // names, since the server filters assigned_to by them.
  const [repFilter, setRepFilter] = useState<string>("All");
  const [ageFilter, setAgeFilter] = useState<AgeFilter>("All");
  const [noApptOnly, setNoApptOnly] = useState(false);
  const [hiddenStages, setHiddenStages] = useState<Set<string>>(() => loadHiddenStages());
  const [showColumnsMenu, setShowColumnsMenu] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  /** The opened lead window: the full row plus its tasks/notes/files,
   *  fetched when the card is clicked -- they no longer ride with the
   *  page for every lead at once. */
  const [editing, setEditing] = useState<{
    lead: Lead;
    tasks: LeadTask[];
    notes: LeadNote[];
    files: LeadFile[];
  } | null>(null);
  const [openingLeadId, setOpeningLeadId] = useState<string | null>(null);
  const [scrollMetrics, setScrollMetrics] = useState({ scrollLeft: 0, scrollWidth: 0, clientWidth: 0 });
  const [dragThumb, setDragThumb] = useState<{ startX: number; startScrollLeft: number } | null>(
    null
  );
  const scrollElRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showValueBreakdown, setShowValueBreakdown] = useState(false);
  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  /** The expanded stage's biggest deals, fetched when its row is
   *  clicked -- the board no longer holds every lead to filter from. */
  const [expandedStageLeads, setExpandedStageLeads] = useState<BoardCard[]>([]);
  const [showWonBreakdown, setShowWonBreakdown] = useState(false);
  const [showImport, setShowImport] = useState(false);
  // Off by default: dragging is the board's everyday interaction, and
  // checkboxes on every card would fight it for clicks. Turning select
  // mode on is an explicit, occasional detour for a bulk action.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showBulkEmail, setShowBulkEmail] = useState(false);

  const toggleSelected = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
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
    // One measurement per frame, not per scroll event: scroll fires far
    // faster than frames paint, and every measurement is a setState that
    // re-renders the whole board -- at this data size that read as jank
    // the moment anyone dragged the board sideways. Passive, since the
    // handler never preventDefaults.
    let raf: number | null = null;
    const onScroll = () => {
      if (raf !== null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        measureScroll(node);
      });
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
      node.removeEventListener("scroll", onScroll);
    };
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

  /**
   * Everything on screen, asked of the server per filter change: each
   * column's window of cards with exact counts, the stat-tile numbers,
   * and the attention digest. The whole book used to arrive as props
   * and get reduced here -- at 79k contacts that was tens of megabytes
   * and a page that took minutes to open.
   */
  const [board, setBoard] = useState<PipelineBoardData | null>(initialBoard);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const loadingMoreRef = useRef<Set<string>>(new Set());

  const boardQuery: PipelineBoardQuery = useMemo(() => {
    const today = new Date();
    const iso = (daysBack: number) => {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysBack);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    return {
      statusFilter,
      repFilter,
      receivedSince: ageFilter === "7" ? iso(7) : ageFilter === "30" ? iso(30) : "",
      receivedBefore: ageFilter === "Stale" ? iso(14) : "",
      noApptOnly,
      sortBy,
      sortDir,
      window: PIPELINE_CARD_WINDOW,
    };
  }, [statusFilter, repFilter, ageFilter, noApptOnly, sortBy, sortDir]);

  // Newest query wins: every fetch of the whole board -- a filter
  // change or a post-drop refetch -- takes a token, and only the
  // holder of the latest token may write the board or merge cards
  // into a column. The server-rendered default board is page one.
  const firstQueryRef = useRef(true);
  const queryIdRef = useRef(0);

  const refetchBoard = useCallback(async () => {
    queryIdRef.current += 1;
    const id = queryIdRef.current;
    setLoadingBoard(true);
    try {
      const fresh = await getPipelineBoardData(boardQuery);
      if (fresh && queryIdRef.current === id) setBoard(fresh);
    } finally {
      if (queryIdRef.current === id) setLoadingBoard(false);
    }
  }, [boardQuery]);

  useEffect(() => {
    if (firstQueryRef.current) {
      firstQueryRef.current = false;
      return;
    }
    void refetchBoard();
  }, [refetchBoard]);

  const onLoadMore = useCallback(
    (stage: string) => {
      setBoard((current) => {
        if (!current) return current;
        const col = current.columns.find((c) => c.stage === stage);
        if (!col || col.cards.length >= col.count) return current;
        if (loadingMoreRef.current.has(stage)) return current;
        loadingMoreRef.current.add(stage);
        // Capture the active query token so a response from a filter
        // that has since changed is discarded rather than merged into
        // the column (its cards and count belong to the old filter).
        const id = queryIdRef.current;
        getStageCards(boardQuery, stage, col.cards.length, PIPELINE_CARD_WINDOW)
          .then((more) => {
            if (queryIdRef.current !== id) return;
            setBoard((b) => {
              if (!b) return b;
              return {
                ...b,
                columns: b.columns.map((c) => {
                  if (c.stage !== stage) return c;
                  // Drop anything already on screen: the column can have
                  // shifted under us (a drag, a save) between windows.
                  const seen = new Set(c.cards.map((x) => x.id));
                  return {
                    ...c,
                    count: more.count,
                    cards: [...c.cards, ...more.cards.filter((x) => !seen.has(x.id))],
                  };
                }),
              };
            });
          })
          .finally(() => loadingMoreRef.current.delete(stage));
        return current;
      });
    },
    [boardQuery]
  );

  /** A card, digest row, or breakdown row was clicked: fetch the full
   *  lead and its panels, then open the window. A second click while
   *  one is already loading is ignored rather than queued -- two lead
   *  windows racing each other would open whichever landed last. */
  const openLead = useCallback(
    async (card: { id: string }) => {
      if (openingLeadId) return;
      setOpeningLeadId(card.id);
      try {
        const bundle = await getLeadCard(card.id);
        if (bundle) setEditing(bundle);
      } finally {
        setOpeningLeadId(null);
      }
    },
    [openingLeadId]
  );

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
        // The card jumps columns immediately; the server then recounts.
        setBoard((b) => {
          if (!b) return b;
          let moved: BoardCard | undefined;
          const stripped = b.columns.map((c) => {
            const hit = c.cards.find((x) => x.id === draggedId);
            if (!hit) return c;
            moved = { ...hit, stage };
            return { ...c, cards: c.cards.filter((x) => x.id !== draggedId), count: Math.max(0, c.count - 1) };
          });
          if (!moved) return b;
          return {
            ...b,
            columns: stripped.map((c) =>
              c.stage === stage ? { ...c, cards: [moved!, ...c.cards], count: c.count + 1 } : c
            ),
          };
        });
        startTransition(async () => {
          await moveLeadStage(draggedId, stage as PipelineStage);
          await refetchBoard();
          router.refresh();
        });
      }
      setDraggedId(null);
      setDragOverStage(null);
    },
    [draggedId, canWrite, router, startTransition, refetchBoard]
  );
  const onDragEndCard = useCallback(() => {
    setDraggedId(null);
    setDragOverStage(null);
  }, []);
  const onDragLeaveCol = useCallback((stage: string) => {
    setDragOverStage((s) => (s === stage ? null : s));
  }, []);

  // The numbers behind the tiles and breakdowns now arrive computed --
  // the same arithmetic, run server-side over a slim scan (see
  // src/lib/pipeline-aggregates.ts and its tests).
  const aggregates = board?.aggregates;
  const pipelineValue = aggregates?.pipelineValue ?? 0;
  const avgDealSize = aggregates?.avgDealSize ?? 0;
  const wonValue = aggregates?.wonValue ?? 0;
  const wonCount = aggregates?.wonCount ?? 0;
  const staleCount = aggregates?.staleCount ?? 0;
  const leadsWithNoValue = aggregates?.leadsWithNoValue ?? 0;
  const valueByStage = aggregates?.valueByStage ?? [];
  const noApptCount = aggregates?.noApptCount ?? 0;
  const openCount = aggregates?.openCount ?? 0;
  const wonTop = board?.wonTop ?? [];
  const digest = board?.digest;

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

  const displayGroups: { stage: string; items: BoardCard[]; count: number }[] = useMemo(() => {
    const columns = board?.columns ?? [];
    if (statusFilter !== "Open")
      return columns.map((c) => ({ stage: c.stage, items: c.cards, count: c.count }));
    return columns
      .filter((c) => !hiddenStages.has(c.stage))
      .map((c) => ({ stage: c.stage, items: c.cards, count: c.count }));
  }, [board, statusFilter, hiddenStages]);

  const repOptions = [
    { value: "All", label: "All Reps" },
    { value: "unassigned", label: "Unassigned" },
    // Salespeople only, plus the current tick -- "All"/"unassigned"
    // match no member id, so passing the raw filter value is harmless.
    ...repDropdownOptions(reps, [repFilter]).map((r) => ({
      value: r.id,
      label: r.name || r.email || "",
    })),
  ];

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
            {(board?.totalLeads ?? 0).toLocaleString()} opps · {statusFilter.toLowerCase()}
            {loadingBoard ? " · updating…" : ""}
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
                  // clicked -- fetched biggest-first when the row opens,
                  // since the board no longer holds the whole book.
                  const stageLeads = open ? expandedStageLeads : [];
                  return (
                    <Fragment key={row.stage}>
                      <tr
                        className={"value-breakdown-row" + (open ? " is-open" : "")}
                        onClick={() => {
                          if (open) {
                            setExpandedStage(null);
                            return;
                          }
                          setExpandedStage(row.stage);
                          setExpandedStageLeads([]);
                          getStageCards(
                            { ...boardQuery, sortBy: "Amount", sortDir: "desc" },
                            row.stage,
                            0,
                            50
                          ).then((r) => setExpandedStageLeads(r.cards));
                        }}
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
                                  onClick={() => openLead(l)}
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
            {leadsWithNoValue.toLocaleString()} of {openCount.toLocaleString()} open leads have
            no value recorded, so they add nothing to these totals.
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
          {wonCount === 0 ? (
            <p className="empty-hint">No won deals yet.</p>
          ) : (
            <div className="value-lead-list">
              {wonTop.map((l) => (
                <div
                  key={l.id}
                  className="value-lead-row"
                  onClick={() => openLead(l)}
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
            {wonCount > wonTop.length
              ? `Showing the ${wonTop.length} biggest of ${wonCount.toLocaleString()} won deals. `
              : ""}
            {aggregates?.wonNoValueCount ?? 0} of {wonCount.toLocaleString()} won deals have no
            value recorded, so they add nothing to the total.
          </p>
        </div>
      )}

      {digest && (
        <AttentionDigest
          followUpsDue={digest.followUpsDue}
          followUpsDueCount={digest.followUpsDueCount}
          coldLeads={digest.coldLeads}
          coldLeadsCount={digest.coldLeadsCount}
          warnings={digest.warnings}
          windowSize={digest.windowSize}
          repName={repName}
          dispatcherName={dispatcherName}
          onOpenLead={openLead}
        />
      )}

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
              <option key={r.value} value={r.value}>
                {r.label}
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
          {canWrite && (
            <button
              className={"chip" + (selectMode ? " chip-active" : "")}
              onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            >
              {selectMode ? "Done Selecting" : "Select"}
            </button>
          )}
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

      {selectMode && selected.size > 0 && (
        <div className="bulk-action-bar">
          <span>{selected.size} selected</span>
          <button type="button" className="btn-primary small" onClick={() => setShowBulkEmail(true)}>
            ✉ Email Selected
          </button>
          <button type="button" className="btn-ghost small" onClick={exitSelectMode}>
            Done
          </button>
        </div>
      )}

      {(board?.totalLeads ?? 0) === 0 ? (
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
          {displayGroups.map(({ stage, items, count }) => (
            <PipelineColumn
              key={stage}
              stage={stage}
              items={items}
              count={count}
              stages={stages}
              canWrite={canWrite}
              isDragOver={dragOverStage === stage}
              draggedId={draggedId}
              repById={repById}
              onOpenLead={openLead}
              onLoadMore={onLoadMore}
              onDragStartCard={setDraggedId}
              onDragEndCard={onDragEndCard}
              onDragOverCol={setDragOverStage}
              onDragLeaveCol={onDragLeaveCol}
              onDropCol={onDropCol}
              selectMode={selectMode}
              selected={selected}
              onToggleSelect={toggleSelected}
            />
          ))}
        </div>
        </>
      )}

      {showBulkEmail && (
        <BulkEmailModal
          // Selection only ever happens on cards that are on screen, so
          // the loaded columns hold every selected lead.
          leads={(board?.columns ?? [])
            .flatMap((c) => c.cards)
            .filter((l) => selected.has(l.id))
            .map((l) => ({ id: l.id, name: leadDisplayName(l), email: l.email }))}
          onClose={() => setShowBulkEmail(false)}
          onSent={exitSelectMode}
        />
      )}

      {showNew && canCreateLeads && (
        <LeadForm
          reps={reps}
          allMembers={allMembers}
          stages={stages}
          calendars={calendars}
          projectTypes={projectTypes}
          sources={sources}
          onCancel={() => setShowNew(false)}
          onSaved={() => {
            setShowNew(false);
            void refetchBoard();
          }}
        />
      )}
      {showImport && canWrite && (
        <CsvImportPanel stages={stages} onCancel={() => setShowImport(false)} />
      )}
      {editing && (
        <LeadForm
          lead={editing.lead}
          reps={reps}
          allMembers={allMembers}
          stages={stages}
          calendars={calendars}
          projectTypes={projectTypes}
          sources={sources}
          tasks={editing.tasks}
          notes={editing.notes}
          files={editing.files}
          readOnly={!canWrite}
          canDelete={canDelete}
          isAdmin={isAdmin}
          canManageMoney={canManageMoney}
          estimateIndex={estimateIndex}
          dispatcherPicker={dispatcherPicker}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refetchBoard();
          }}
          onDeleted={() => {
            setEditing(null);
            void refetchBoard();
          }}
        />
      )}
    </div>
  );
}

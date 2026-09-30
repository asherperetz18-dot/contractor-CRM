"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { JOB_COLOR, JOB_STATUSES, type Job, type JobStatus } from "@/lib/data/types";
import { Modal } from "@/components/ui/modal";
import { crewDropdownOptions, repDisplayName, type RepPickable } from "@/lib/data/rep-options";
import { jobChipClass } from "@/lib/job-chips";
import {
  boardPlacement,
  dropBlock,
  filterJobs,
  fmtDay,
  jobDateInfo,
  jobSummary,
  recentlyComplete,
  weekBounds,
  type BoardPlacement,
  type ProjectFacts,
  type QuickFilter,
} from "@/lib/production-board";
import { backfillJobsFromSignedContracts, updateJobStatus } from "@/lib/actions/jobs";
import { JobForm } from "./job-form";

/** A job as the board shows it: its status is the column the rules put
 *  it in, and `placement` says why. */
type PlacedJob = Job & { placement: BoardPlacement };

/** Where the completion certificate is raised and read: its section on
 *  the contract's own page. */
const certificateHref = (contractId: string) => `/estimates/${contractId}#completion-certificate`;

function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "?";
}

// The date never notifies; it is read fresh on each render and string
// equality stops re-render loops.
const subscribeNever = () => () => {};
const localIsoDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
};

export function ProductionBoard({
  jobs,
  roster,
  projectFacts,
  canWrite,
  canSetProjectHold,
  initialToday,
}: {
  jobs: Job[];
  /** The whole roster, every status — name lookups must keep resolving
   *  people who have since been deactivated. */
  roster: RepPickable[];
  /** lead_id → what the documents say about the project: its live
   *  contract (the "Open project" jump), certificate, hold, cancellation. */
  projectFacts: Record<string, ProjectFacts>;
  canWrite: boolean;
  /** Office/Admin: may put a project on or off hold by dragging. */
  canSetProjectHold: boolean;
  initialToday: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // The server rendered UTC's date; the browser corrects to the user's
  // own calendar day — a job due today must not read as overdue at 5pm
  // Pacific because the server's clock rolled past midnight.
  // useSyncExternalStore, not a render-time Date, so the first client
  // render matches the server's HTML (the hydration rule the Projects
  // column toggle learned the hard way).
  const today = useSyncExternalStore(subscribeNever, localIsoDate, () => initialToday);

  const [search, setSearch] = useState("");
  const [crewId, setCrewId] = useState("");
  const [quick, setQuick] = useState<QuickFilter>(null);
  const [statusChip, setStatusChip] = useState<string>("All");
  const [editing, setEditing] = useState<PlacedJob | null>(null);
  // A card dropped on Complete with no signed certificate waits here for
  // the office to say whether to raise one.
  const [confirmComplete, setConfirmComplete] = useState<PlacedJob | null>(null);
  const [showAllComplete, setShowAllComplete] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<JobStatus | null>(null);
  // A dropped card jumps columns immediately; the server then confirms.
  const [override, setOverride] = useState<Record<string, JobStatus>>({});
  const [moveError, setMoveError] = useState("");
  const [syncPending, setSyncPending] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  const factsFor = (j: Job): ProjectFacts | undefined =>
    j.lead_id ? projectFacts[j.lead_id] : undefined;

  // Every card goes where the rules put it -- the certificate, the
  // project's hold and a voided contract outrank the stored status, the
  // same as on Projects. A just-dropped card counts as its new status
  // (and, for a hold, the project's new hold) until the server confirms.
  const board = useMemo<PlacedJob[]>(
    () =>
      jobs.flatMap((j) => {
        const moved = override[j.id];
        const stored = moved ? { ...j, status: moved } : j;
        const f = j.lead_id ? projectFacts[j.lead_id] : undefined;
        const facts = f && moved ? { ...f, onHold: moved === "On Hold" ? f.onHold : false } : f;
        const placement = boardPlacement(stored, facts, today);
        return placement ? [{ ...stored, status: placement.status, placement }] : [];
      }),
    [jobs, override, projectFacts, today]
  );

  // The summary cards follow search and crew but not the quick card
  // itself — clicking "Past end date" narrows the board, not the other
  // three numbers, or the cards would each be counting a different list.
  const scoped = useMemo(
    () => filterJobs(board, { search, crewId, quick: null }, today),
    [board, search, crewId, today]
  );
  const summary = jobSummary(scoped, today);
  const filtered = useMemo(
    () => filterJobs(board, { search, crewId, quick }, today),
    [board, search, crewId, quick, today]
  );
  // Complete shows the last 30 days unless asked for everything -- once
  // every finished job lands there, it is the column that never stops
  // growing.
  const olderComplete = filtered.filter(
    (j) => j.status === "Complete" && !recentlyComplete(j, j.placement, today)
  ).length;
  const shown = showAllComplete
    ? filtered
    : filtered.filter((j) => j.status !== "Complete" || recentlyComplete(j, j.placement, today));

  // Active crew plus whoever the rows or the current tick point at —
  // a crew member with jobs on the board stays reachable after
  // deactivation, and a tick stays visible so it can be undone.
  const crewOptions = useMemo(
    () => crewDropdownOptions(roster, [...board.map((j) => j.assigned_to), crewId]),
    [roster, board, crewId]
  );

  const wk = weekBounds(today);

  const move = (id: string, status: JobStatus) => {
    setOverride((o) => ({ ...o, [id]: status }));
    startTransition(async () => {
      const res = await updateJobStatus(id, status);
      const drop = (o: Record<string, JobStatus>) => {
        const next = { ...o };
        delete next[id];
        return next;
      };
      if (res?.error) {
        setOverride(drop);
        setMoveError(res.error);
      } else {
        setMoveError("");
        // The transition stays pending until the refresh lands, so
        // dropping the override here swaps it for the fresh server
        // row rather than flashing the old column back.
        router.refresh();
        setOverride(drop);
      }
    });
  };

  const dropOn = (status: JobStatus) => {
    const j = draggedId && canWrite ? board.find((x) => x.id === draggedId) : undefined;
    setDraggedId(null);
    setDragOverStatus(null);
    if (!j || j.status === status) return;
    const f = factsFor(j);
    // A move the rules would put straight back is refused with the
    // reason, rather than the card jumping home unexplained.
    const blocked = dropBlock(j, j.placement, status, f, today, canSetProjectHold);
    if (blocked) {
      setMoveError(blocked);
      return;
    }
    // Finished is the customer's word, on the certificate: ask before a
    // drag says it for them.
    if (status === "Complete" && f?.contractId && !f.completedOn) {
      setConfirmComplete(j);
      return;
    }
    move(j.id, status);
  };

  const toggleQuick = (q: Exclude<QuickFilter, null>) => setQuick((cur) => (cur === q ? null : q));

  async function runBackfill() {
    setSyncPending(true);
    setSyncMsg("");
    const res = await backfillJobsFromSignedContracts();
    setSyncPending(false);
    if (res.error) {
      setSyncMsg(res.error);
    } else if (!res.created) {
      setSyncMsg("Every signed contract already has its job.");
    } else {
      setSyncMsg(`Added ${res.created} job${res.created === 1 ? "" : "s"} from signed contracts.`);
      router.refresh();
    }
  }

  const card = (j: PlacedJob, withBadge: boolean) => {
    const dates = jobDateInfo(j, today);
    const projectId = factsFor(j)?.contractId ?? undefined;
    const crewName = j.assigned_to ? repDisplayName(j.assigned_to, roster) : null;
    const { auto, completedOn } = j.placement;
    // The customer's signature decides this card's column, not a drag.
    const locked = auto === "certificate";
    return (
      <div
        className={"job-card" + (draggedId === j.id ? " job-card-dragging" : "")}
        key={j.id}
        draggable={canWrite && !withBadge && !locked}
        title={locked ? "The customer signed the completion certificate" : undefined}
        onDragStart={(e) => {
          setDraggedId(j.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={() => {
          setDraggedId(null);
          setDragOverStatus(null);
        }}
        onClick={() => setEditing(j)}
      >
        <div className="job-card-top">
          <span className="job-name">{j.name}</span>
          {withBadge && <Badge color={JOB_COLOR[j.status]}>{j.status}</Badge>}
        </div>
        {j.address && <div className="job-address">{j.address}</div>}
        <div className="job-crew-row">
          {crewName ? (
            <>
              <span className="job-avatar" aria-hidden="true">
                {initials(crewName)}
              </span>
              <span>{crewName}</span>
            </>
          ) : (
            <span className="job-unassigned">Unassigned</span>
          )}
          {dates.text && (
            <span
              className={
                "job-dates" +
                (dates.tone === "overdue"
                  ? " job-dates-overdue"
                  : dates.tone === "done"
                    ? " job-dates-done"
                    : "")
              }
            >
              {dates.text}
            </span>
          )}
        </div>
        {((auto === "certificate" && completedOn) || (auto === "started" && j.start_date)) && (
          <div className="proj-chip-row job-status-chips">
            {auto === "certificate" && completedOn && projectId ? (
              <Link
                href={certificateHref(projectId)}
                className={jobChipClass("certificate")}
                onClick={(e) => e.stopPropagation()}
              >
                ✓ Certificate signed {fmtDay(completedOn, today)}
              </Link>
            ) : auto === "certificate" && completedOn ? (
              <span className={jobChipClass("certificate")}>
                ✓ Certificate signed {fmtDay(completedOn, today)}
              </span>
            ) : null}
            {auto === "started" && j.start_date && (
              <span className={jobChipClass("started")}>Started {fmtDay(j.start_date, today)}</span>
            )}
          </div>
        )}
        {projectId && (
          <Link
            href={`/projects?focus=${projectId}`}
            className="job-project-link"
            onClick={(e) => e.stopPropagation()}
          >
            Open project
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              aria-hidden="true"
            >
              <path d="M7 17L17 7" />
              <path d="M9 7h8v8" />
            </svg>
          </Link>
        )}
      </div>
    );
  };

  const phoneList = statusChip === "All" ? shown : shown.filter((j) => j.status === statusChip);

  const completeToggle = olderComplete > 0 && (
    <button type="button" className="prod-col-more" onClick={() => setShowAllComplete((v) => !v)}>
      {showAllComplete ? "Show the last 30 days only" : `Show ${olderComplete} older`}
    </button>
  );

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Production</h1>
          <p className="module-sub">
            {board.length} jobs · {board.filter((j) => j.status !== "Complete").length} active
          </p>
        </div>
        {canWrite && (
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button
              className="btn-ghost"
              onClick={runBackfill}
              disabled={syncPending}
              title="Create a job for every signed contract that doesn't have one yet — safe to click twice, nothing is doubled"
            >
              {syncPending ? "Adding…" : "Add signed jobs"}
            </button>
            <button className="btn-primary" onClick={() => setShowNew(true)}>
              + New Job
            </button>
          </div>
        )}
      </div>

      {syncMsg && <p className="hint-note">{syncMsg}</p>}

      <div className="stat-grid">
        <button
          type="button"
          className={"stat-card" + (quick === "active" ? " stat-card-active" : "")}
          onClick={() => toggleQuick("active")}
          title="Not started, in progress and on hold"
        >
          <div className="stat-value">{summary.active}</div>
          <div className="stat-label">Active jobs</div>
        </button>
        <button
          type="button"
          className={"stat-card" + (quick === "startingThisWeek" ? " stat-card-active" : "")}
          onClick={() => toggleQuick("startingThisWeek")}
          title={`Mon ${fmtDay(wk.start, today)} – Sun ${fmtDay(wk.end, today)}`}
        >
          <div className="stat-value" style={{ color: "var(--blueprint)" }}>
            {summary.startingThisWeek}
          </div>
          <div className="stat-label">Starting this week</div>
        </button>
        <button
          type="button"
          className={"stat-card" + (quick === "pastEnd" ? " stat-card-active" : "")}
          onClick={() => toggleQuick("pastEnd")}
          title="End date passed and the job isn't complete"
        >
          <div
            className="stat-value"
            style={summary.pastEnd > 0 ? { color: "var(--danger)" } : undefined}
          >
            {summary.pastEnd}
          </div>
          <div className="stat-label">Past end date</div>
        </button>
        <button
          type="button"
          className={"stat-card" + (quick === "unassigned" ? " stat-card-active" : "")}
          onClick={() => toggleQuick("unassigned")}
          title="No crew on the job"
        >
          <div
            className="stat-value"
            style={summary.unassigned > 0 ? { color: "var(--safety)" } : undefined}
          >
            {summary.unassigned}
          </div>
          <div className="stat-label">Unassigned</div>
        </button>
      </div>

      <div className="prod-filter-row">
        <input
          className="ur-search"
          style={{ maxWidth: 220 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or address"
        />
        <select
          className="ur-company-filter"
          value={crewId}
          onChange={(e) => setCrewId(e.target.value)}
        >
          <option value="">All crew</option>
          {crewOptions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name || m.email || "Unnamed"}
            </option>
          ))}
        </select>
        {moveError && <span className="error-note">{moveError}</span>}
      </div>

      {jobs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-mark" aria-hidden="true">
            ＋
          </div>
          <p className="empty-label">No jobs here</p>
          <p className="empty-hint">
            Jobs appear when a contract is signed or a won lead is converted.
            {canWrite
              ? " Click “Add signed jobs” above to pull in the contracts already signed, or add one directly."
              : ""}
          </p>
        </div>
      ) : (
        <>
          <div className="prod-board">
            {JOB_STATUSES.map((s) => {
              const col = shown.filter((j) => j.status === s);
              return (
                <div
                  key={s}
                  className={
                    "prod-col" +
                    (dragOverStatus === s && draggedId ? " prod-col-dragover" : "")
                  }
                  onDragOver={(e) => {
                    if (canWrite) {
                      e.preventDefault();
                      setDragOverStatus(s);
                    }
                  }}
                  onDragLeave={() => setDragOverStatus((cur) => (cur === s ? null : cur))}
                  onDrop={(e) => {
                    e.preventDefault();
                    dropOn(s);
                  }}
                >
                  <div className="prod-col-head">
                    <span className="prod-col-dot" style={{ background: JOB_COLOR[s] }} />
                    <span>{s}</span>
                    <span className="prod-col-count">{col.length}</span>
                  </div>
                  {col.length === 0 ? (
                    <div className="prod-col-empty">No jobs</div>
                  ) : (
                    col.map((j) => card(j, false))
                  )}
                  {s === "Complete" && completeToggle}
                </div>
              );
            })}
          </div>

          <div className="prod-phone">
            <div className="chip-row">
              {["All", ...JOB_STATUSES].map((s) => (
                <button
                  key={s}
                  className={"chip" + (statusChip === s ? " chip-active" : "")}
                  onClick={() => setStatusChip(s)}
                >
                  {s === "All"
                    ? `All ${shown.length}`
                    : `${s} ${shown.filter((j) => j.status === s).length}`}
                </button>
              ))}
            </div>
            {phoneList.length === 0 ? (
              <div className="empty-state">
                <p className="empty-label">No jobs here</p>
              </div>
            ) : (
              <div className="job-grid">{phoneList.map((j) => card(j, true))}</div>
            )}
            {(statusChip === "All" || statusChip === "Complete") && completeToggle}
          </div>
        </>
      )}

      {showNew && canWrite && (
        <JobForm
          roster={roster}
          onCancel={() => setShowNew(false)}
          onSaved={() => setShowNew(false)}
        />
      )}
      {confirmComplete && (
        <Modal title={`Mark ${confirmComplete.name} complete?`} onClose={() => setConfirmComplete(null)}>
          <p className="hint-note">
            The customer hasn&apos;t signed a completion certificate yet. That signature is what
            starts the warranty and releases commission.
          </p>
          <div className="modal-actions">
            <div className="modal-actions-left" />
            <div className="prod-confirm-actions">
              <button type="button" className="btn-ghost" onClick={() => setConfirmComplete(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  move(confirmComplete.id, "Complete");
                  setConfirmComplete(null);
                }}
              >
                Just move the card
              </button>
              <Link
                className="btn-primary"
                href={certificateHref(factsFor(confirmComplete)?.contractId ?? "")}
              >
                Raise completion certificate
              </Link>
            </div>
          </div>
        </Modal>
      )}
      {editing && (
        <JobForm
          job={editing}
          roster={roster}
          readOnly={!canWrite}
          statusNote={
            editing.placement.auto === "certificate"
              ? "Complete: the customer signed the completion certificate."
              : editing.placement.auto === "hold"
                ? "On hold on the Projects page. Take it off hold there, or drag the card out of On Hold."
                : undefined
          }
          onCancel={() => setEditing(null)}
          onSaved={() => {
            // A save makes the server authoritative for every field --
            // a stale drag override must not outvote the form's status.
            setOverride({});
            setEditing(null);
          }}
          onDeleted={() => setEditing(null)}
        />
      )}
    </div>
  );
}

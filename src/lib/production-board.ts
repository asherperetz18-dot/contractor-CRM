import type { JobStatus } from "./data/types.ts";

/**
 * The Production Board's numbers, date words and filters, as pure
 * functions — the board and its summary cards read these so the card a
 * user clicks and the list it filters to can never disagree.
 *
 * `today` is always a parameter ("YYYY-MM-DD") so every rule is
 * testable; ISO date strings compare correctly as plain strings, which
 * is what keeps this module free of timezone arithmetic.
 */

/** The slice of a jobs row the board logic reads. */
export type BoardJob = {
  id: string;
  name: string;
  address: string | null;
  status: JobStatus;
  start_date: string | null;
  end_date: string | null;
  assigned_to: string | null;
  /** When the row was last written -- the Complete column's last-resort
   *  finish date for a job with no certificate and no end date. */
  updated_at?: string | null;
};

/** One summary card each; null = no quick filter engaged. */
export type QuickFilter = "active" | "startingThisWeek" | "pastEnd" | "unassigned" | null;

export type JobDateTone = "muted" | "overdue" | "done";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sep 23", with the year spelled out only when it isn't today's. */
export function fmtDay(iso: string, today: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const base = `${MONTHS[(m ?? 1) - 1]} ${d}`;
  return String(y) === today.slice(0, 4) ? base : `${base}, ${y}`;
}

/** Monday through Sunday of the week `today` falls in. */
export function weekBounds(today: string): { start: string; end: string } {
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const sinceMonday = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - sinceMonday);
  const start = dt.toISOString().slice(0, 10);
  dt.setUTCDate(dt.getUTCDate() + 6);
  return { start, end: dt.toISOString().slice(0, 10) };
}

function daysBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

const isActive = (j: BoardJob) => j.status !== "Complete";
const startsThisWeek = (j: BoardJob, today: string) => {
  if (!isActive(j) || !j.start_date) return false;
  const { start, end } = weekBounds(today);
  return j.start_date >= start && j.start_date <= end;
};
const isPastEnd = (j: BoardJob, today: string) =>
  isActive(j) && !!j.end_date && j.end_date < today;
const isUnassigned = (j: BoardJob) => isActive(j) && !j.assigned_to;

/**
 * The four summary cards. Fed the search/crew-FILTERED list, never the
 * whole book — an unfiltered card above a filtered board gets quoted as
 * the filtered number (the estimates funnel learned this first).
 */
export function jobSummary(jobs: readonly BoardJob[], today: string): {
  active: number;
  startingThisWeek: number;
  pastEnd: number;
  unassigned: number;
} {
  return {
    active: jobs.filter(isActive).length,
    startingThisWeek: jobs.filter((j) => startsThisWeek(j, today)).length,
    pastEnd: jobs.filter((j) => isPastEnd(j, today)).length,
    unassigned: jobs.filter(isUnassigned).length,
  };
}

/**
 * The one date line a job card shows. Overdue is loud and reserved for
 * live jobs — a completed job's old end date is history, not an alarm.
 */
export function jobDateInfo(job: BoardJob, today: string): { text: string; tone: JobDateTone } {
  const { start_date: s, end_date: e } = job;
  if (job.status === "Complete") {
    if (s && e) return { text: `${fmtDay(s, today)} – ${fmtDay(e, today)}`, tone: "done" };
    if (s || e) return { text: fmtDay((s || e) as string, today), tone: "done" };
    return { text: "Done", tone: "done" };
  }
  if (s && s > today) return { text: `Starts ${fmtDay(s, today)}`, tone: "muted" };
  if (e && e < today) {
    const range = s ? `${fmtDay(s, today)} – ${fmtDay(e, today)}` : fmtDay(e, today);
    return { text: `${range} · ${daysBetween(e, today)}d over`, tone: "overdue" };
  }
  if (s && e) return { text: `${fmtDay(s, today)} – ${fmtDay(e, today)}`, tone: "muted" };
  if (s) return { text: `${fmtDay(s, today)} →`, tone: "muted" };
  if (e) return { text: `By ${fmtDay(e, today)}`, tone: "muted" };
  return { text: "", tone: "muted" };
}

/**
 * Search + crew + quick-card, stacked. The quick filters reuse the very
 * predicates the summary counts with, so clicking a card always shows
 * exactly the jobs it counted.
 */
export function filterJobs<T extends BoardJob>(
  jobs: readonly T[],
  f: { search: string; crewId: string; quick: QuickFilter },
  today: string
): T[] {
  const q = f.search.trim().toLowerCase();
  return jobs.filter((j) => {
    if (f.crewId && j.assigned_to !== f.crewId) return false;
    if (q && !`${j.name} ${j.address ?? ""}`.toLowerCase().includes(q)) return false;
    if (f.quick === "active") return isActive(j);
    if (f.quick === "startingThisWeek") return startsThisWeek(j, today);
    if (f.quick === "pastEnd") return isPastEnd(j, today);
    if (f.quick === "unassigned") return isUnassigned(j);
    return true;
  });
}

// ── Auto-status: the board follows the project ─────────────────────────
//
// The Projects page reads Complete, On Hold and Cancelled from the
// documents (a signed completion certificate, the contract's hold flag,
// a voided contract). The board used to keep a status of its own that
// only a drag changed, so a job the customer had signed off sat in Not
// Started. These rules put the card where the documents say, the same
// way Projects does, every time the board loads -- so the two pages
// can't disagree, and jobs finished before this shipped move by
// themselves with nothing to backfill.

/** The slice of an estimates row the project rules read. */
export type ProjectDoc = {
  id: string;
  lead_id: string | null;
  kind: string | null;
  status: string;
  parent_estimate_id: string | null;
  signed_at: string | null;
  completed_on: string | null;
  project_on_hold?: boolean | null;
};

/** What the documents say about one lead's project. */
export type ProjectFacts = {
  /** The live contract: the latest signed one. Null when every contract
   *  was voided. */
  contractId: string | null;
  cancelled: boolean;
  onHold: boolean;
  /** YYYY-MM-DD the work finished, once the customer has signed the
   *  completion certificate. */
  completedOn: string | null;
};

/**
 * One entry per lead that has ever had a signed contract. Only the
 * certificate on the LIVE contract completes the project -- one signed
 * on a version since superseded speaks for work that was re-contracted.
 */
export function projectFactsByLead(docs: readonly ProjectDoc[]): Map<string, ProjectFacts> {
  const contracts = new Map<string, { live: ProjectDoc | null }>();
  for (const d of docs) {
    // Only a contract is a project (an allow-list, so a new kind stays out).
    if ((d.kind ?? "contract") !== "contract" || !d.lead_id) continue;
    if (d.status !== "Signed" && d.status !== "Void") continue;
    const held = contracts.get(d.lead_id) ?? { live: null };
    if (d.status === "Signed" && (!held.live || (d.signed_at ?? "") > (held.live.signed_at ?? ""))) {
      held.live = d;
    }
    contracts.set(d.lead_id, held);
  }

  const out = new Map<string, ProjectFacts>();
  for (const [leadId, { live }] of contracts) {
    const cert = live
      ? docs.find(
          (d) => d.kind === "completion" && d.status === "Signed" && d.parent_estimate_id === live.id
        )
      : undefined;
    const completedOn = cert
      ? cert.completed_on ?? cert.signed_at?.slice(0, 10) ?? null
      : live?.completed_on ?? null;
    out.set(leadId, {
      contractId: live?.id ?? null,
      cancelled: !live,
      onHold: !!live?.project_on_hold,
      completedOn,
    });
  }
  return out;
}

/** Where a card sits, and why when the documents moved it rather than a drag. */
export type BoardPlacement = {
  status: JobStatus;
  auto: "certificate" | "hold" | "started" | null;
  completedOn: string | null;
};

/**
 * The column a card belongs in. Null means off the board: a cancelled
 * job is no work for the crew. `facts` is undefined for a job with no
 * contract behind it (added by hand), which keeps its dragged status.
 */
export function boardPlacement(
  job: BoardJob,
  facts: ProjectFacts | undefined,
  today: string
): BoardPlacement | null {
  if (facts?.cancelled) return null;
  if (facts?.completedOn) {
    return { status: "Complete", auto: "certificate", completedOn: facts.completedOn };
  }
  if (facts?.onHold) return { status: "On Hold", auto: "hold", completedOn: null };
  // Only with a crew on it: a start date nobody is assigned to is a
  // plan, not a job under way.
  if (job.status === "Not Started" && job.assigned_to && job.start_date && job.start_date <= today) {
    return { status: "In Progress", auto: "started", completedOn: null };
  }
  return { status: job.status, auto: null, completedOn: null };
}

/**
 * The Complete column shows what finished in the last 30 days; the rest
 * sits behind "Show all". Finish date: the certificate's, else the
 * job's end date, else when it was last written. A job with none of
 * those shows -- hiding it would lose it.
 */
export function recentlyComplete(job: BoardJob, placement: BoardPlacement, today: string): boolean {
  const finished = placement.completedOn ?? job.end_date ?? job.updated_at?.slice(0, 10) ?? null;
  return !finished || daysBetween(finished, today) <= 30;
}

/**
 * Why a drag can't stick, in the words the board shows -- or null when
 * it can. A drop the rules would put straight back is refused up front
 * rather than letting the card jump back with no explanation.
 */
export function dropBlock(
  job: BoardJob,
  placement: BoardPlacement,
  target: JobStatus,
  facts: ProjectFacts | undefined,
  today: string,
  canSetProjectHold: boolean
): string | null {
  if (placement.auto === "certificate" && target !== "Complete") {
    return `${job.name}: the customer signed the completion certificate, so the job stays in Complete. Void the certificate to reopen it.`;
  }
  if (target === "Not Started" && job.assigned_to && job.start_date && job.start_date <= today) {
    return `${job.name}: it started ${fmtDay(job.start_date, today)}. Change its start date to move it back to Not Started.`;
  }
  if (facts?.onHold && target !== "On Hold" && !canSetProjectHold) {
    return `${job.name}: on hold on the Projects page. Only Office or Admin can take it off hold.`;
  }
  return null;
}

/**
 * One on-hold switch, from the board's side: the project hold a card
 * moved to `status` implies, or null when the project already agrees.
 */
export function projectHoldForJobStatus(status: JobStatus, projectOnHold: boolean): boolean | null {
  if (status === "On Hold" && !projectOnHold) return true;
  if (status !== "On Hold" && projectOnHold) return false;
  return null;
}

/**
 * The same switch from the Projects side: where the card goes when the
 * project is held or released, or null to leave it. Releasing a hold
 * only moves a card that is sitting in On Hold.
 */
export function jobStatusForProjectHold(onHold: boolean, current: JobStatus): JobStatus | null {
  if (onHold) return current === "On Hold" ? null : "On Hold";
  return current === "On Hold" ? "In Progress" : null;
}

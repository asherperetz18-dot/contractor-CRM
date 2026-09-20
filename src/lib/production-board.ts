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

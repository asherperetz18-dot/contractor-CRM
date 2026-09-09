import type { ProjectCard, ProjectStatus } from "./projects-view";

/**
 * The Projects page's filters, as pure functions.
 *
 * Shared between the on-screen view and the printable report so that
 * "In progress, Rafi, last 30 days" means exactly the same list on paper
 * as it does on the screen -- the report is reached from the page with
 * the filters in its URL, and the two disagreeing would make the
 * printout look wrong even when both are right.
 */

export type ProjectChip =
  | "All"
  | "InProgress"
  | "OnHold"
  | "Complete"
  | "Cancelled"
  | "Bleeding"
  | "Owed";

export const PROJECT_CHIPS: ProjectChip[] = [
  "All",
  "InProgress",
  "OnHold",
  "Complete",
  "Cancelled",
  "Bleeding",
  "Owed",
];

export type ProjectDateRange = "any" | "week" | "month" | "year" | "custom";

const CHIP_STATUS: Partial<Record<ProjectChip, ProjectStatus>> = {
  InProgress: "in_progress",
  OnHold: "on_hold",
  Complete: "complete",
  Cancelled: "cancelled",
};

/** Whether a card belongs under a status chip. Every chip except
 *  Cancelled speaks only for live jobs -- folding a voided contract into
 *  "All" or "Owed" would report money the company is never getting. */
export function chipMatches(p: ProjectCard, chip: ProjectChip): boolean {
  if (chip === "Cancelled") return p.status === "cancelled";
  if (p.status === "cancelled") return false;
  if (chip === "All") return true;
  if (chip === "Bleeding") return p.rollup.netCashCents < 0;
  if (chip === "Owed") return p.rollup.receivableCents > 0;
  return p.status === CHIP_STATUS[chip];
}

/** [start, end] ms bounds for "signed on" a job falls in, or null for no
 *  date filter at all. Custom leaves either side open when blank, so
 *  "from" alone means "since then" and "to" alone means "up to then". */
export function dateRangeBounds(
  range: ProjectDateRange,
  customFrom: string,
  customTo: string
): [number, number] | null {
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  if (range === "week") return [now - 7 * DAY, now];
  if (range === "month") return [now - 30 * DAY, now];
  if (range === "year") return [now - 365 * DAY, now];
  if (range === "custom") {
    const from = customFrom ? new Date(customFrom).getTime() : -Infinity;
    // Include the entire "to" day, not just its midnight instant.
    const to = customTo ? new Date(customTo).getTime() + DAY - 1 : Infinity;
    if (from === -Infinity && to === Infinity) return null;
    return [from, to];
  }
  return null;
}

/**
 * The quick search plus the structured filters, stacked on top of
 * whichever chip is selected. `search` is the raw text from the box;
 * amount matching strips $, commas, periods and spaces so "57600",
 * "57,600" and "$576" all normalize to a plain digit string that can be
 * matched straight against a cents integer's own digits.
 */
export function matchesProjectFilters(
  p: ProjectCard,
  f: {
    search: string;
    client: string;
    rep: string;
    bounds: [number, number] | null;
  }
): boolean {
  if (f.client && p.customer !== f.client) return false;
  if (f.rep && p.repName !== f.rep) return false;
  if (f.bounds) {
    if (!p.signedAt) return false;
    const signedMs = new Date(p.signedAt).getTime();
    if (signedMs < f.bounds[0] || signedMs > f.bounds[1]) return false;
  }
  const q = f.search.trim().toLowerCase();
  if (q) {
    const qDigits = q.replace(/[^0-9]/g, "");
    const haystack = [p.title, p.docNumber, p.customer, p.address, p.repName]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const textMatch = haystack.includes(q);
    // A bare digit or two over-matches (almost every project has a
    // "1" somewhere), so amount matching only kicks in past that.
    const amountMatch =
      qDigits.length >= 2 &&
      [
        p.rollup.soldCents,
        p.rollup.collectedCents,
        p.rollup.receivableCents,
        p.rollup.costCents,
        p.rollup.netCashCents,
        p.unpaidBillsCents,
      ].some((cents) => String(Math.abs(cents)).includes(qDigits));
    if (!textMatch && !amountMatch) return false;
  }
  return true;
}

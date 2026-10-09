// Relative and with the extension, not "@/...": this module runs under
// node's test runner (via project-filters.test.ts), which resolves no
// tsconfig path aliases -- same idiom as every *.test.ts import.
import { addDays, calendarDay, dayEndInZone, dayStartInZone } from "../../../lib/company-clock.ts";
import { netAccrualCents } from "../../../lib/data/types.ts";
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
  | "Owed"
  | "NewMonth";

export const PROJECT_CHIPS: ProjectChip[] = [
  "All",
  "InProgress",
  "OnHold",
  "Complete",
  "Cancelled",
  "Bleeding",
  "Owed",
  "NewMonth",
];

export type ProjectDateRange = "any" | "week" | "month" | "year" | "custom";

const CHIP_STATUS: Partial<Record<ProjectChip, ProjectStatus>> = {
  InProgress: "in_progress",
  OnHold: "on_hold",
  Complete: "complete",
  Cancelled: "cancelled",
};

/**
 * The company's calendar for these filters, worked out once per draw:
 * its today, its zone, and this month as the instants between the 1st's
 * midnight and next month's there. A contract signed at 7pm Pacific on
 * the 30th is this month's, not the next (UTC) one's.
 */
export type ProjectClock = {
  /** The company's today, YYYY-MM-DD. */
  today: string;
  zone: string;
  /** [the 1st's midnight, next month's 1st's midnight), in ms. */
  month: [number, number];
};

export function projectClock(today: string, zone: string): ProjectClock {
  const first = `${today.slice(0, 8)}01`;
  // 31 days past any 1st is in the next month.
  const nextFirst = `${addDays(first, 31).slice(0, 8)}01`;
  return {
    today,
    zone,
    month: [dayStartInZone(first, zone).getTime(), dayStartInZone(nextFirst, zone).getTime()],
  };
}

/** Whether a card belongs under a status chip. Every chip except
 *  Cancelled speaks only for live jobs -- folding a voided contract into
 *  "All" or "Owed" would report money the company is never getting. */
export function chipMatches(p: ProjectCard, chip: ProjectChip, clock: ProjectClock): boolean {
  if (chip === "Cancelled") return p.status === "cancelled";
  if (p.status === "cancelled") return false;
  if (chip === "All") return true;
  // Signed this calendar month, the company's. The "New this month"
  // chip label counts with this same rule.
  if (chip === "NewMonth") {
    if (!p.signedAt) return false;
    const signed = Date.parse(p.signedAt);
    return signed >= clock.month[0] && signed < clock.month[1];
  }
  // On the accrual figure: bills filed but unpaid count against the
  // job, so it goes red before the cash actually leaves (owner's rule).
  if (chip === "Bleeding")
    return (
      netAccrualCents({
        netCashCents: p.rollup.netCashCents,
        unpaidBillsCents: p.unpaidBillsCents ?? 0,
      }) < 0
    );
  if (chip === "Owed") return p.rollup.receivableCents > 0;
  return p.status === CHIP_STATUS[chip];
}

/** The money cards' sums over exactly the cards given. Pure and fed
 *  the FILTERED list, so the cards always speak for what the table
 *  shows -- an unfiltered card above a filtered table gets quoted as
 *  the filtered number (the estimates funnel learned this first). */
export function projectTotals(cards: ProjectCard[]): {
  sold: number;
  collected: number;
  cost: number;
  receivable: number;
  net: number;
  unpaid: number;
  /** Commission actually paid or advanced across these jobs. */
  commission: number;
} {
  return cards.reduce(
    (acc, p) => ({
      sold: acc.sold + p.rollup.soldCents,
      collected: acc.collected + p.rollup.collectedCents,
      cost: acc.cost + p.rollup.costCents,
      receivable: acc.receivable + p.rollup.receivableCents,
      net: acc.net + p.rollup.netCashCents,
      unpaid: acc.unpaid + p.unpaidBillsCents,
      commission: acc.commission + (p.rollup.commissionCents ?? 0),
    }),
    { sold: 0, collected: 0, cost: 0, receivable: 0, net: 0, unpaid: 0, commission: 0 }
  );
}

/** [start, end] ms bounds for "signed on" a job falls in, or null for no
 *  date filter at all. Custom leaves either side open when blank, so
 *  "from" alone means "since then" and "to" alone means "up to then".
 *  Custom days are the company's: from the first day's midnight there
 *  to the last moment of the last day. A date's UTC midnight cut the
 *  range at 5pm Pacific instead, leaving out the last evening. */
export function dateRangeBounds(
  range: ProjectDateRange,
  customFrom: string,
  customTo: string,
  zone: string
): [number, number] | null {
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  if (range === "week") return [now - 7 * DAY, now];
  if (range === "month") return [now - 30 * DAY, now];
  if (range === "year") return [now - 365 * DAY, now];
  if (range === "custom") {
    // A date that isn't a real day (one still being typed, or a bad
    // address) is no edge rather than a broken range.
    const fromDay = calendarDay(customFrom);
    const toDay = calendarDay(customTo);
    const from = fromDay ? dayStartInZone(fromDay, zone).getTime() : -Infinity;
    // Include the entire "to" day, not just its midnight instant.
    const to = toDay ? dayEndInZone(toDay, zone).getTime() : Infinity;
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
    /** A deep link (?focus=<estimateId>, e.g. from a Production Board
     *  card) narrows the page to that one project until cleared. */
    focusId?: string;
  }
): boolean {
  if (f.focusId && p.estimateId !== f.focusId) return false;
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

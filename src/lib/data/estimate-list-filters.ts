import { isoDay } from "./date-range.ts";
import type { FunnelCardKey } from "./funnel-order.ts";
import type { Estimate } from "./types.ts";

/**
 * The filter bar over the Estimates & Contracts list: a search box,
 * follow-up chips that change with the card, and sortable columns. The
 * date range reuses the shared window in date-range.ts, so "last 30
 * days" here means what it means on every report.
 */

/** What the search box reads on one document. */
export type EstimateSearchFields = {
  docNumber: string;
  customer: string;
  email: string | null;
  title: string | null;
  /** The client's own address. */
  address: string | null;
  /** Where the work happens, when that isn't the client's address. */
  jobAddress: string | null;
};

/**
 * Whether a document matches the search box. Every word has to appear
 * somewhere, not the whole phrase in one field: "vance addition" is a
 * customer word plus a title word, which is how people remember a job.
 */
export function matchesEstimateSearch(f: EstimateSearchFields, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [f.docNumber, f.customer, f.email, f.title, f.address, f.jobAddress]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return words.every((w) => haystack.includes(w));
}

export type FollowUpChip =
  | "no_price"
  | "stale_draft"
  | "not_opened"
  | "opened_often"
  | "expiring_soon";

/**
 * The chips each card offers. Only where there is someone to chase:
 * drafts that nobody finished, proposals waiting on a customer. A signed
 * or declined document has no next step a chip could point at.
 */
export const FOLLOW_UP_CHIPS: Record<FunnelCardKey, FollowUpChip[]> = {
  drafts: ["no_price", "stale_draft"],
  sent: ["not_opened", "opened_often", "expiring_soon"],
  signed: [],
  declined: [],
  void: [],
  changes: [],
  co_pending: [],
};

export const FOLLOW_UP_CHIP_LABELS: Record<FollowUpChip, string> = {
  no_price: "No price yet",
  stale_draft: "Older than 7 days",
  not_opened: "Not opened",
  opened_often: "Opened 3+ times",
  expiring_soon: "Expires within 7 days",
};

/** The slice of a document the chips read, plus its customer opens. */
export type FollowUpDoc = Pick<Estimate, "total_cents" | "created_at" | "expires_at"> & {
  views: number;
};

const STALE_DAYS = 7;
const EXPIRING_DAYS = 7;
const OPENED_OFTEN = 3;

/** `now` shifted by whole calendar days, as YYYY-MM-DD. */
function dayOffset(now: Date, days: number): string {
  return isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
}

export function matchesFollowUpChip(
  doc: FollowUpDoc,
  chip: FollowUpChip,
  now: Date = new Date()
): boolean {
  switch (chip) {
    case "no_price":
      return !doc.total_cents;
    case "stale_draft":
      // Exactly a week old is still this week's work.
      return doc.created_at.slice(0, 10) < dayOffset(now, -STALE_DAYS);
    case "not_opened":
      return doc.views === 0;
    case "opened_often":
      return doc.views >= OPENED_OFTEN;
    case "expiring_soon": {
      if (!doc.expires_at) return false;
      const day = doc.expires_at.slice(0, 10);
      // Already lapsed is Expired and has left the card; today still counts.
      return day >= isoDay(now) && day <= dayOffset(now, EXPIRING_DAYS);
    }
  }
}

export type EstimateSortKey = "date" | "views" | "total";
export type EstimateSort = { key: EstimateSortKey; dir: "asc" | "desc" };

/** The list's own order: newest first, the order the page loads in. */
export const DEFAULT_ESTIMATE_SORT: EstimateSort = { key: "date", dir: "desc" };

/** A sorted copy -- the caller's list is left as it was. */
export function sortEstimates<T extends Pick<Estimate, "created_at" | "total_cents">>(
  rows: T[],
  sort: EstimateSort,
  viewsOf: (row: T) => number
): T[] {
  const value = (r: T): number =>
    sort.key === "views"
      ? viewsOf(r)
      : sort.key === "total"
        ? r.total_cents || 0
        : new Date(r.created_at).getTime();
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => (value(a) - value(b)) * sign);
}

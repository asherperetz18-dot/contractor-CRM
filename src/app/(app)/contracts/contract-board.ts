// Relative and with the extension, not "@/...": this module runs under
// node's test runner (via contract-board.test.ts), which resolves no
// tsconfig path aliases -- same idiom as every *.test.ts import.
import { effectiveEstimateStatus } from "../../../lib/data/funnel-cards.ts";
import { isSellableKind, type Estimate } from "../../../lib/data/types.ts";

/**
 * The Contract Board's rules, as pure functions.
 *
 * A contract is an estimates row with kind 'contract' -- "Signed" already
 * means "this is a contract" (migration 0059's own words). The board is a
 * view over those rows, so nothing here writes anything: which column a
 * document stands in, what the stat cards total, and which cards deserve
 * an attention chip all derive from fields the estimates pages maintain.
 *
 * Cards do NOT move between columns by drag. Every column transition is
 * a real event -- sending, the customer opening it, a signature -- and a
 * drag would fake the record (DECISIONS #049).
 */

export type BoardColumnKey = "draft" | "sent" | "viewed" | "signed" | "closed";

export const BOARD_COLUMNS: { key: BoardColumnKey; label: string; tick: string }[] = [
  { key: "draft", label: "Draft", tick: "#7c8798" },
  { key: "sent", label: "Sent", tick: "#a97a00" },
  { key: "viewed", label: "Viewed", tick: "#2d5f8a" },
  { key: "signed", label: "Signed", tick: "#1a7f45" },
  // One column for the three end states rather than three columns of
  // mostly-empty history: "why is this over" is the badge on the card.
  { key: "closed", label: "Closed", tick: "#a03b3b" },
];

type ColumnDoc = Pick<Estimate, "kind" | "status" | "expires_at">;

/**
 * Which column a document stands in, or null for documents that are not
 * board cards at all: change orders and completion certificates attach
 * to a contract, and counting them here would count one job twice --
 * the same double the estimates funnel keeps out of its Contracts card.
 * The status is the effective one, so a lapsed expiry files a Sent
 * contract under Closed without anything sweeping the table on a timer.
 */
export function boardColumnFor(e: ColumnDoc): BoardColumnKey | null {
  if (!isSellableKind(e.kind)) return null;
  const status = effectiveEstimateStatus(e);
  if (status === "Draft") return "draft";
  if (status === "Sent") return "sent";
  if (status === "Viewed") return "viewed";
  if (status === "Signed") return "signed";
  return "closed";
}

/** A column head's money. Voided contracts are excluded -- cancelled
 *  work is not money (the funnel's Voided card learned this first). */
export function columnTotalCents(
  docs: Pick<Estimate, "status" | "expires_at" | "total_cents">[]
): number {
  return docs
    .filter((e) => effectiveEstimateStatus(e) !== "Void")
    .reduce((sum, e) => sum + (e.total_cents || 0), 0);
}

const DAY_MS = 86_400_000;

type ExpiryDoc = Pick<Estimate, "status" | "expires_at">;

/**
 * Whole days until a document's price lapses, or null when there is no
 * countdown to show: no expiry date, or a document that isn't awaiting a
 * signature (a draft's expiry is a setting, and a signed contract never
 * expires). 0 means it expires today. Never negative -- a lapsed date
 * has already moved the document to Closed via the effective status.
 */
export function daysUntilExpiry(e: ExpiryDoc, now: Date = new Date()): number | null {
  const status = effectiveEstimateStatus(e, now);
  if (status !== "Sent" && status !== "Viewed") return null;
  if (!e.expires_at) return null;
  // The document lives to the end of its expiry day, same instant
  // estimateExpired measures against.
  const end = new Date(`${e.expires_at}T23:59:59`).getTime();
  return Math.floor((end - now.getTime()) / DAY_MS);
}

export const EXPIRING_SOON_DAYS = 7;

export function isExpiringSoon(e: ExpiryDoc, now: Date = new Date()): boolean {
  const days = daysUntilExpiry(e, now);
  return days !== null && days <= EXPIRING_SOON_DAYS;
}

type SignedDoc = Pick<Estimate, "status" | "expires_at" | "signed_at">;

/** Signed this calendar month -- the month the review asks about, not a
 *  rolling 30 days (the Projects page's NewMonth chip counts the same way). */
export function signedThisMonth(e: SignedDoc, now: Date = new Date()): boolean {
  if (effectiveEstimateStatus(e, now) !== "Signed" || !e.signed_at) return false;
  const d = new Date(e.signed_at);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

/** Two weeks of silence -- the same line past which a pipeline lead
 *  reads as stale. */
export const NO_REPLY_DAYS = 14;

type NoReplyDoc = Pick<Estimate, "status" | "expires_at" | "sent_at" | "viewed_at">;

/**
 * How long a Sent contract has sat unopened, once that silence is worth
 * flagging -- NO_REPLY_DAYS or more. Null otherwise: a viewed document
 * is a different conversation (the customer is reading, not ignoring),
 * and an expired one is over, with nobody owed a reply on it.
 */
export function noReplyDays(e: NoReplyDoc, now: Date = new Date()): number | null {
  if (effectiveEstimateStatus(e, now) !== "Sent" || e.viewed_at || !e.sent_at) return null;
  const days = Math.floor((now.getTime() - new Date(e.sent_at).getTime()) / DAY_MS);
  return days >= NO_REPLY_DAYS ? days : null;
}

type SignSpeedDoc = Pick<Estimate, "sent_at" | "signed_at">;

/**
 * Mean days from sent to signed, over contracts signed in the last
 * `windowDays`. Null when nothing qualifies -- a dash on the card beats
 * a made-up zero. Contracts never sent (signed on paper straight from
 * draft) have no interval to measure and drop out.
 */
export function avgDaysToSign(
  docs: SignSpeedDoc[],
  now: Date = new Date(),
  windowDays = 90
): number | null {
  const cutoff = now.getTime() - windowDays * DAY_MS;
  const intervals = docs
    .filter((e) => e.signed_at && e.sent_at && new Date(e.signed_at).getTime() >= cutoff)
    .map((e) => (new Date(e.signed_at!).getTime() - new Date(e.sent_at!).getTime()) / DAY_MS)
    .filter((days) => days >= 0);
  if (intervals.length === 0) return null;
  return intervals.reduce((a, b) => a + b, 0) / intervals.length;
}

/** Which stat card is scoping the board, if any. avgDays has no scope:
 *  it is a speed, not a set of rows, so its card doesn't filter. */
export type BoardScope = "awaiting" | "signedMonth" | "expiring";

type ScopeDoc = ColumnDoc & Pick<Estimate, "signed_at">;

export function matchesScope(e: ScopeDoc, scope: BoardScope | null, now: Date = new Date()): boolean {
  if (!scope) return true;
  if (scope === "awaiting") {
    const col = boardColumnFor(e);
    return col === "sent" || col === "viewed";
  }
  if (scope === "signedMonth") return signedThisMonth(e, now);
  return isExpiringSoon(e, now);
}

type StatsDoc = ColumnDoc & Pick<Estimate, "total_cents" | "sent_at" | "signed_at">;

export type BoardCardStats = {
  awaiting: { count: number; totalCents: number };
  signedMonth: { count: number; totalCents: number };
  expiring: { count: number; totalCents: number };
  avgDays: number | null;
};

/**
 * What the four stat cards show. Fed the FILTERED list, so the cards
 * always answer for the same slice as the board under them -- an
 * unfiltered card above a filtered board gets quoted as the filtered
 * number (the estimates funnel learned this first).
 */
export function boardCardStats(docs: StatsDoc[], now: Date = new Date()): BoardCardStats {
  const board = docs.filter((e) => boardColumnFor(e) !== null);
  const tally = (rows: StatsDoc[]) => ({
    count: rows.length,
    totalCents: rows.reduce((sum, e) => sum + (e.total_cents || 0), 0),
  });
  return {
    awaiting: tally(board.filter((e) => matchesScope(e, "awaiting", now))),
    signedMonth: tally(board.filter((e) => signedThisMonth(e, now))),
    expiring: tally(board.filter((e) => isExpiringSoon(e, now))),
    avgDays: avgDaysToSign(board, now),
  };
}

export type SearchableCard = {
  docNumber: string;
  customer: string;
  title: string;
  address: string | null;
  repName: string | null;
  totalCents: number;
};

/**
 * The quick search: free text over what the card shows, and amounts by
 * digits -- "$18,900", "18900" and "18,900" all normalize to a digit
 * string matched against the cents integer's own digits. A bare digit
 * or two over-matches (almost every contract has a "1" somewhere), so
 * amount matching only kicks in past that. Same rule as Projects.
 */
export function matchesBoardSearch(card: SearchableCard, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  const haystack = [card.docNumber, card.customer, card.title, card.address, card.repName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (haystack.includes(q)) return true;
  const qDigits = q.replace(/[^0-9]/g, "");
  return qDigits.length >= 2 && String(Math.abs(card.totalCents)).includes(qDigits);
}

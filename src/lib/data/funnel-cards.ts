import {
  estimateExpired,
  isSellableKind,
  type Estimate,
  type EstimateStatus,
} from "./types.ts";
import { isPendingChangeOrder } from "./pending-change-orders.ts";
import type { FunnelCardKey } from "./funnel-order.ts";

/** The slice of an estimate the funnel cards read. */
export type FunnelCardDoc = Pick<Estimate, "kind" | "status" | "expires_at" | "total_cents">;

/**
 * Which statuses each funnel card spans. Keyed to the canonical card
 * list so a card added there cannot be forgotten here -- the compiler
 * objects. Attached spans every status because a change order matters
 * most while it is unsigned, and splitting them across the other cards
 * would bury the ones that need chasing among contracts that don't.
 * co_pending's real membership comes from isPendingChangeOrder; its
 * entry here is the statuses that rule can admit.
 */
export const FUNNEL_CARD_STATUSES: Record<FunnelCardKey, EstimateStatus[]> = {
  drafts: ["Draft"],
  sent: ["Sent", "Viewed"],
  signed: ["Signed"],
  declined: ["Declined", "Expired"],
  void: ["Void"],
  changes: ["Draft", "Sent", "Viewed", "Signed", "Declined", "Expired", "Void"],
  co_pending: ["Draft", "Sent", "Viewed"],
};

/**
 * The status the funnel believes: the expiry date over the stored one.
 * Nothing sweeps the table on a timer, and a stale "awaiting signature"
 * count is worse than none.
 */
export function effectiveEstimateStatus(
  e: Pick<Estimate, "status" | "expires_at">,
  /** The clock to judge expiry by. Callers that already take a `now`
   *  pass it through, so a countdown and its status agree on the day. */
  now: Date = new Date()
): EstimateStatus {
  return estimateExpired(e, now) ? "Expired" : e.status;
}

/**
 * One card or another, never both. Each card counts only its own kind,
 * so a change order cannot be tallied as a contract; completion
 * certificates are attachments to a contract too. Invoices (a permit
 * fee billed back) sit on no card: they are money owed, not a sale or
 * an amendment to one, and live on Payments and Money to Collect.
 */
export function inFunnelBucket(
  e: Pick<Estimate, "kind" | "status" | "expires_at">,
  key: FunnelCardKey,
  /** The clock to judge expiry by: noon of the company's today on the
   *  staff screens and in the AI chat (DECISIONS #193). */
  now: Date = new Date()
): boolean {
  if (e.kind === "invoice") return false;
  return key === "co_pending"
    ? isPendingChangeOrder(e, now)
    : (key === "changes" ? !isSellableKind(e.kind) : isSellableKind(e.kind)) &&
        FUNNEL_CARD_STATUSES[key].includes(effectiveEstimateStatus(e, now));
}

/**
 * Whether a document passes the salesperson filter. An empty filter is
 * no filter; with reps ticked, a document passes when anyone on it is
 * ticked -- its salesperson, second salesperson or closer
 * (estimate-seats.ts), so a closer finds the jobs they closed for
 * somebody else. A document with nobody on it is nobody's number and
 * drops out.
 */
export function matchesRepFilter(
  peopleIds: readonly string[],
  repFilter: ReadonlySet<string>
): boolean {
  return repFilter.size === 0 || peopleIds.some((id) => repFilter.has(id));
}

/**
 * The ids the salesperson dropdown offers: everyone on a document on
 * the current card (closers and second salespeople included), plus
 * whoever is already ticked. The selection follows the reader across
 * cards, so a ticked rep with nothing on this card must stay listed --
 * dropped from the list, the filter would still be applied with no
 * visible tick to undo it.
 */
export function repOptionIds(
  cardRepIds: (string | null)[],
  ticked: ReadonlySet<string>
): string[] {
  return [...new Set([...cardRepIds.filter((id): id is string => !!id), ...ticked])];
}

/**
 * What one funnel card shows: how many documents and how much money.
 *
 * Takes the salesperson filter because the cards must answer for the
 * same slice as the table under them: with a rep ticked, "Contracts
 * $770,599" reading the whole company's number looks exactly like that
 * rep's -- and somebody quotes it as theirs.
 */
export function funnelCardStats<T extends FunnelCardDoc>(
  docs: T[],
  key: FunnelCardKey,
  repFilter: ReadonlySet<string>,
  peopleOf: (doc: T) => readonly string[],
  /** The clock to judge expiry by, as inFunnelBucket. */
  now: Date = new Date()
): { count: number; totalCents: number } {
  const rows = docs.filter((e) => matchesRepFilter(peopleOf(e), repFilter) && inFunnelBucket(e, key, now));
  return {
    count: rows.length,
    totalCents: rows
      // Cancelled work is not money. Without this the Voided card would
      // report the value of everything that was called off as though it
      // were a pipeline worth chasing.
      .filter((e) => effectiveEstimateStatus(e, now) !== "Void")
      // Signed ones only for Attached's total. A draft is a proposal,
      // and adding it here would report money nobody has agreed to as
      // though the job had grown.
      .filter((e) => key !== "changes" || effectiveEstimateStatus(e, now) === "Signed")
      .reduce((sum, e) => sum + (e.total_cents || 0), 0),
  };
}

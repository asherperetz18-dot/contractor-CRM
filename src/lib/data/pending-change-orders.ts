import { estimateExpired, type Estimate } from "./types.ts";

/**
 * Whether a document belongs on the funnel's Change Orders card: a
 * change order that is unsigned and still alive, so extra work someone
 * has priced but nobody has agreed to pay for yet.
 *
 * Attached already holds every change order across every status; this is
 * the subset that needs chasing. Signed ones are money (counted in
 * Attached's total), and declined, expired or voided ones are over --
 * neither belongs on a card someone works through. Completion
 * certificates are not change orders and carry no money at all.
 */
export function isPendingChangeOrder(
  e: Pick<Estimate, "kind" | "status" | "expires_at">
): boolean {
  if (e.kind !== "change_order") return false;
  // The expiry date over the stored status, same as the other cards:
  // nothing sweeps statuses on a timer, and a lapsed offer is not pending.
  if (estimateExpired(e)) return false;
  return e.status === "Draft" || e.status === "Sent" || e.status === "Viewed";
}

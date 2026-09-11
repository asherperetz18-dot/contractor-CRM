import type { EstimatePayment, PortalPayment } from "./types.ts";

/** A signed change order's own billing, summed from its portal payments. */
export type ChangeOrderBilling = {
  doc_number: string;
  /** Settled on the change order's own schedule. */
  paid_cents: number;
  /** Still clearing there (a pending ACH transfer). */
  pending_cents: number;
};

export type ChangeOrderRollup = {
  docNumber: string;
  paidCents: number;
  pendingCents: number;
  amountCents: number;
  state: "paid" | "partial" | "clearing";
};

/**
 * What a change order's own billing says about its mirror phase on the
 * parent contract.
 *
 * A signed change order is one row on the parent's schedule, but its
 * money is usually collected on the change order's own schedule, phase by
 * phase -- and those payments settle the change order's rows, not the
 * mirror. Without this, a half-paid change order reads "Not billed" on
 * the contract that owns it.
 *
 * The link is the mirror row's name, which signing sets to the change
 * order's doc number on a schedule that is already locked -- nothing can
 * rename it afterwards (see docs/DECISIONS.md #015).
 *
 * Null means "behave as a plain phase": no matching change order, nothing
 * collected there yet, or money already recorded directly on the mirror
 * row. The last one matters -- billing a change order in one payment from
 * the parent is a live flow, and that record must keep winning. A credit
 * change order (zero or negative) never rolls up; there is nothing to
 * collect.
 */
export function changeOrderRollupForPhase(
  phase: Pick<EstimatePayment, "id" | "name" | "amount_cents">,
  directPayments: Pick<PortalPayment, "estimate_payment_id" | "status">[],
  orders: ChangeOrderBilling[]
): ChangeOrderRollup | null {
  if (phase.amount_cents <= 0) return null;

  const direct = directPayments.some(
    (p) =>
      p.estimate_payment_id === phase.id &&
      (p.status === "succeeded" || p.status === "pending")
  );
  if (direct) return null;

  const order = orders.find((o) => o.doc_number === phase.name.trim());
  if (!order) return null;

  const paidCents = Math.max(0, order.paid_cents);
  const pendingCents = Math.max(0, order.pending_cents);
  if (paidCents <= 0 && pendingCents <= 0) return null;

  return {
    docNumber: order.doc_number,
    paidCents,
    pendingCents,
    amountCents: phase.amount_cents,
    state: paidCents >= phase.amount_cents ? "paid" : paidCents > 0 ? "partial" : "clearing",
  };
}

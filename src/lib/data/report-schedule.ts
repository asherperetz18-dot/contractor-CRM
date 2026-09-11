import { changeOrderRollupForPhase, type ChangeOrderBilling } from "./change-order-rollup.ts";
import { paidTotalCents, type EstimatePayment, type PortalPayment } from "./types.ts";

/**
 * The status the project report prints beside one contract phase.
 *
 * A signed change order lives twice: as one mirror row on the contract's
 * schedule and as its own document with its own phases -- and its money
 * can legitimately land on either side. The report shows the contract's
 * schedule only, so a mirror row must read through the change order's own
 * billing (via changeOrderRollupForPhase, the same rule the estimate
 * page's schedule uses) or a paid change order prints as "Not yet billed".
 */
export type ReportPhaseStatus =
  | { kind: "paid"; via?: string }
  | { kind: "partial"; paidCents: number; via?: string }
  | { kind: "clearing"; pendingCents: number; via: string }
  | { kind: "billed"; requestedAt: string }
  | { kind: "unbilled" };

export function reportPhaseStatus(
  phase: Pick<EstimatePayment, "id" | "name" | "amount_cents" | "requested_at">,
  payments: Pick<PortalPayment, "estimate_payment_id" | "status" | "amount_cents">[],
  orders: ChangeOrderBilling[]
): ReportPhaseStatus {
  const direct = paidTotalCents(payments.filter((p) => p.estimate_payment_id === phase.id));
  if (phase.amount_cents > 0 && direct >= phase.amount_cents) return { kind: "paid" };
  if (direct > 0) return { kind: "partial", paidCents: direct };

  const rollup = changeOrderRollupForPhase(phase, payments, orders);
  if (rollup) {
    if (rollup.state === "paid") return { kind: "paid", via: rollup.docNumber };
    if (rollup.state === "partial")
      return { kind: "partial", paidCents: rollup.paidCents, via: rollup.docNumber };
    return { kind: "clearing", pendingCents: rollup.pendingCents, via: rollup.docNumber };
  }

  if (phase.requested_at) return { kind: "billed", requestedAt: phase.requested_at };
  return { kind: "unbilled" };
}

/** Each change order's own collections, keyed by doc number for the
 *  mirror-row match. Failed payments are not money either way. */
export function changeOrderBillingFromPayments(
  orders: { id: string; doc_number: string }[],
  payments: Pick<PortalPayment, "estimate_id" | "status" | "amount_cents">[]
): ChangeOrderBilling[] {
  return orders.map((o) => {
    const own = payments.filter((p) => p.estimate_id === o.id);
    return {
      doc_number: o.doc_number,
      paid_cents: paidTotalCents(own),
      pending_cents: own
        .filter((p) => p.status === "pending")
        .reduce((sum, p) => sum + (p.amount_cents || 0), 0),
    };
  });
}

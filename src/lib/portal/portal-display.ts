/**
 * What the customer portal's chips and buttons say, and in what colour.
 *
 * Colour is meaning here, never decoration (the semantic-chips rule):
 * blue is the state of the paperwork, green is money that came in, amber
 * is something still waiting on the customer, slate is closed.
 */

import {
  isUnfinishedCheckout,
  phaseOwedCents,
  phaseState,
  type EstimatePayment,
  type PortalPayment,
} from "../data/types.ts";

export type PortalTone = "blue" | "green" | "amber" | "slate";

export type PortalChip = { label: string; tone: PortalTone };

export function estimateStatusChip(status: string): PortalChip {
  if (status === "Signed") return { label: "Signed", tone: "blue" };
  if (status === "Declined") return { label: "Declined", tone: "slate" };
  return { label: "Awaiting your signature", tone: "amber" };
}

/** Money still owed wins: it is the one thing the customer has to act on.
 *  Owed means the deposit and every billed-but-unpaid progress phase --
 *  a paid deposit must not read as "all paid" while completion is due. */
export function estimateMoneyChip(e: {
  depositPaid: boolean;
  amountDueCents: number;
  phaseDueCents?: number;
}): PortalChip | null {
  const phaseDue = e.phaseDueCents ?? 0;
  const owed = e.amountDueCents + phaseDue;
  if (owed > 0) {
    const due = (owed / 100).toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
    });
    return { label: phaseDue > 0 ? `${due} due` : `${due} deposit due`, tone: "amber" };
  }
  if (e.depositPaid) return { label: "Deposit paid", tone: "green" };
  return null;
}

/**
 * What the customer still owes on an estimate's billed progress phases --
 * the same per-phase rule the estimate page's Pay buttons follow: only
 * billed phases, less what has settled, and nothing for a phase whose
 * money is already paid or clearing. A checkout opened and abandoned is
 * not clearing money (isUnfinishedCheckout).
 */
export function billedPhaseDueCents(
  phases: Pick<EstimatePayment, "id" | "amount_cents" | "requested_at" | "due_date">[],
  payments: Pick<
    PortalPayment,
    "estimate_payment_id" | "status" | "amount_cents" | "stripe_session_id" | "stripe_payment_intent_id"
  >[],
  today = new Date()
): number {
  return phases.reduce((sum, phase) => {
    const on = payments.filter(
      (p) => p.estimate_payment_id === phase.id && !isUnfinishedCheckout(p)
    );
    const state = phaseState(phase, on, today);
    if (state === "paid" || state === "clearing") return sum;
    return sum + phaseOwedCents(phase, on);
  }, 0);
}

/** An invoice (a permit fee billed back): what's still due, or paid. */
export function invoiceMoneyChip(e: { totalCents: number; paidCents: number }): PortalChip {
  const owed = Math.max(0, e.totalCents - e.paidCents);
  if (owed === 0) return { label: "Paid", tone: "green" };
  const due = (owed / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  return { label: `${due} due`, tone: "amber" };
}

/** `step` is the zero-based index of the current step. */
export function journeyProgress(step: number, total: number) {
  return {
    label: `Step ${step + 1} of ${total}`,
    percent: Math.round(((step + 1) / total) * 100),
  };
}

// Each network in its own brand colour, so the customer finds the one
// they use without reading. Keys are the labels portal/home/page.tsx builds.
const SOCIAL_CLASS: Record<string, string> = {
  Facebook: "portal-social-facebook",
  Instagram: "portal-social-instagram",
  LinkedIn: "portal-social-linkedin",
  YouTube: "portal-social-youtube",
  TikTok: "portal-social-tiktok",
  Yelp: "portal-social-yelp",
  "Google Reviews": "portal-social-google",
};

export function socialLinkClass(label: string): string {
  const brand = SOCIAL_CLASS[label];
  return brand ? `portal-social-link ${brand}` : "portal-social-link";
}

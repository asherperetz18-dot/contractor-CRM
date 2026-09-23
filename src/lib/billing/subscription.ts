/**
 * What a company's AI Build Pro subscription means for its access.
 *
 * Pure on purpose: the webhook, the app layout and the lock screen all
 * decide from these, and migration 0175 carries the same status list for
 * row-level security (subscription.test.ts fails if the two drift).
 */

/**
 * Stripe subscription statuses that lock a company out.
 *
 * past_due is deliberately absent: it means Stripe is still retrying the
 * card, and the company gets a warning instead. Stripe moves it on to
 * canceled or unpaid when the retries run out (Dashboard: Billing →
 * Subscriptions and emails → Manage failed payments).
 */
export const LOCKED_STATUSES = ["canceled", "unpaid", "incomplete_expired", "paused"] as const;

/** The platform webhook events that re-sync a customer's subscription. */
export const BILLING_EVENTS = [
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_failed",
];

/**
 * Null means the company has no subscription on record -- made before
 * self-serve signup, or through a manual invite -- and is never locked.
 */
export function isBillingLocked(status: string | null | undefined): boolean {
  return !!status && (LOCKED_STATUSES as readonly string[]).includes(status);
}

/** The warning shown across the app while Stripe retries a failed payment. */
export function billingBanner(status: string | null | undefined): string | null {
  if (status === "past_due") {
    return "Your last AI Build Pro payment didn't go through. Update your card to keep access.";
  }
  return null;
}

export type SubscriptionLike = { id: string; status: string; created: number };

/**
 * The subscription that speaks for a customer.
 *
 * Renewing after a cancellation leaves the old subscription on the
 * customer beside the new one, so "the latest event" is not the answer:
 * a working subscription always wins, newest first, and only when none
 * works does the newest dead one report the company as lapsed.
 */
export function pickSubscription<T extends SubscriptionLike>(subs: T[]): T | null {
  const newestFirst = [...subs].sort((a, b) => b.created - a.created);
  return newestFirst.find((s) => !isBillingLocked(s.status)) ?? newestFirst[0] ?? null;
}

/** The Stripe customer a billing event belongs to, or null if it isn't one. */
export function customerIdFromEvent(event: { type: string; data: { object: object } }): string | null {
  if (!BILLING_EVENTS.includes(event.type)) return null;
  // Subscriptions and invoices both carry their customer, as an id or,
  // when expanded, as the object itself.
  const { customer } = event.data.object as { customer?: string | { id: string } | null };
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

/**
 * The free trial (DECISIONS #129): the first 30 days of a self-serve
 * signup cost nothing and ask for no card, as the marketing site
 * promises ("First 30 days free", "no card up front").
 *
 * Stripe runs the trial itself. Checkout starts a trialing subscription
 * without collecting a card; if none has been added by the end, Stripe
 * cancels it, and a cancelled subscription locks the company exactly as
 * it always has (0175). Nothing here keeps a clock of its own.
 *
 * Pure, so the rules are tested apart from Stripe and the database.
 */
import { billingBanner } from "./subscription.ts";

export const TRIAL_DAYS = 30;

/**
 * What Checkout needs to sell the plan as a trial. A one-off price can't
 * carry a trial, so it is sold exactly as before.
 */
export function trialCheckoutOptions(mode: "subscription" | "payment") {
  if (mode !== "subscription") return {};
  return {
    payment_method_collection: "if_required" as const,
    subscription_data: {
      trial_period_days: TRIAL_DAYS,
      trial_settings: { end_behavior: { missing_payment_method: "cancel" as const } },
    },
  };
}

/** Whole days left, rounded up; null when there's no end date to count to. */
export function trialDaysLeft(trialEndsAt: string | null | undefined, now: number): number | null {
  if (!trialEndsAt) return null;
  const end = Date.parse(trialEndsAt);
  if (Number.isNaN(end)) return null;
  return Math.max(0, Math.ceil((end - now) / 86_400_000));
}

export type TrialBilling = {
  status: string | null;
  /** When the trial ends or ended (migration 0198); null before it has run. */
  trialEndsAt: string | null;
  /** Whether Stripe has a card to charge when the trial ends; null before 0198. */
  cardOnFile: boolean | null;
};

export type BillingNotice = { text: string; link: "subscribe" | "update" };

/**
 * The line across the top of every page: a failed payment, as before, or
 * a trial counting down with no card yet. Once a card is on file the
 * trial needs nothing from anyone, so it says nothing.
 */
export function billingNotice(billing: TrialBilling | null, now: number): BillingNotice | null {
  const failed = billingBanner(billing?.status);
  if (failed) return { text: failed, link: "update" };
  if (billing?.status !== "trialing" || billing.cardOnFile) return null;

  const left = trialDaysLeft(billing.trialEndsAt, now);
  if (left === null) {
    return { text: "You're on a free trial. Add a card to keep using AI Build Pro when it ends.", link: "subscribe" };
  }
  const when = left === 0 ? "today" : left === 1 ? "tomorrow" : `in ${left} days`;
  return {
    text: `Your free trial ends ${when}. Add a card to keep using AI Build Pro after that.`,
    link: "subscribe",
  };
}

/**
 * Why a locked company is locked, for the lock screen's wording. A trial
 * that ran out with no card on file reads as a trial ending; anything
 * else -- including a trial that became a paid plan and was cancelled
 * later -- is a subscription ending.
 */
export function lockReason(billing: TrialBilling | null): "trial_ended" | "subscription_ended" {
  if (billing?.status === "canceled" && billing.trialEndsAt && billing.cardOnFile === false) {
    return "trial_ended";
  }
  return "subscription_ended";
}

/** The extra time a platform admin can give a company on a free trial. */
export const TRIAL_EXTENSIONS = [7, 14, 30] as const;

export function isTrialExtension(days: number): days is (typeof TRIAL_EXTENSIONS)[number] {
  return (TRIAL_EXTENSIONS as readonly number[]).includes(days);
}

/**
 * The trial's new end, in Stripe's unix seconds: `days` past its current
 * end -- or past now, if that end has already gone by -- so an extension
 * always adds the full time it says.
 */
export function extendedTrialEnd(currentEnd: string | null, now: number, days: number): number {
  const end = currentEnd ? Date.parse(currentEnd) : NaN;
  const from = Number.isNaN(end) ? now : Math.max(end, now);
  return Math.floor((from + days * 86_400_000) / 1000);
}

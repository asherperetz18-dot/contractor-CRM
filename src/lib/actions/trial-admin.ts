"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/data/profile";
import { isPlatformAdmin } from "@/lib/data/types";
import { getStripeEnv, stripeClient } from "@/lib/stripe-env";
import { readCompanyBilling, syncCustomerBilling } from "@/lib/billing/company-billing";
import { extendedTrialEnd, isTrialExtension } from "@/lib/billing/trial";
import { logInfo } from "@/lib/observability/logger";

/**
 * Gives a company on a free trial more time (DECISIONS #130), from the
 * Platform Admin Companies page. Stripe holds the trial, so Stripe's
 * subscription is what changes; the sync then brings the new end date
 * back, and the banner and the Companies page follow.
 *
 * Platform admins only, checked here and not just on the page: a server
 * action is a real endpoint. The company comes from the admin's click,
 * not their current company -- which is why company_billing is read with
 * the service-role client only after that check.
 */
export async function extendTrial(
  companyId: string,
  days: number
): Promise<{ error?: string; trialEndsAt?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isPlatformAdmin(profile)) return { error: "Only a Platform Admin can do this." };
  if (!isTrialExtension(days)) return { error: "Choose 7, 14 or 30 days." };

  const env = getStripeEnv();
  if (!env) return { error: "Billing isn't switched on for this deployment." };
  const billing = await readCompanyBilling(companyId);
  if (!billing?.subscriptionId || billing.status !== "trialing") {
    return { error: "Only a company on a free trial can have it extended." };
  }

  const stripe = stripeClient(env);
  try {
    // Asked fresh, not taken from our copy: the trial's end in Stripe is
    // the one being moved.
    const sub = await stripe.subscriptions.retrieve(billing.subscriptionId);
    if (sub.status !== "trialing") return { error: "This company's trial has already ended." };
    const currentEnd = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null;
    const trialEnd = extendedTrialEnd(currentEnd, new Date().getTime(), days);
    await stripe.subscriptions.update(sub.id, { trial_end: trialEnd, proration_behavior: "none" });

    await syncCustomerBilling(stripe, billing.customerId);
    logInfo({ event: "billing.trial_extended", companyId, actorId: profile.id, days });
    revalidatePath("/platform-admin/companies");
    return { trialEndsAt: new Date(trialEnd * 1000).toISOString() };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't extend the trial." };
  }
}

"use server";

import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole } from "@/lib/data/types";
import { getStripeEnv, stripeClient } from "@/lib/stripe-env";
import { signupConfig } from "@/lib/signup/provision";
import { portalBaseUrl } from "@/lib/portal/session";
import { readCompanyBilling, syncCustomerBilling } from "@/lib/billing/company-billing";
import { isBillingLocked } from "@/lib/billing/subscription";

/**
 * The AI Build Pro subscription controls: Stripe's Customer Portal for
 * the card and invoices, a fresh Checkout to come back after cancelling,
 * and a re-check for when a payment has gone through but the webhook
 * hasn't arrived yet. Office/Admin only -- the people who pay the bill.
 *
 * The company is always the caller's current one, never an id from the
 * browser, because company_billing is read with the service-role client.
 */

type UrlResult = { url?: string; error?: string };

async function billingForCaller() {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Sign in first." } as const;
  if (!isAdminRole(profile)) {
    return { error: "Only an Office or Admin user can manage the subscription." } as const;
  }
  const env = getStripeEnv();
  if (!env) return { error: "Billing isn't switched on for this deployment." } as const;
  const billing = await readCompanyBilling(profile.company_id);
  if (!billing) return { error: "This company isn't on an AI Build Pro subscription." } as const;
  return { billing, stripe: stripeClient(env) } as const;
}

/** Stripe's Customer Portal: update the card, see invoices, cancel. */
export async function openBillingPortal(): Promise<UrlResult> {
  const found = await billingForCaller();
  if ("error" in found) return { error: found.error };
  try {
    const session = await found.stripe.billingPortal.sessions.create({
      customer: found.billing.customerId,
      return_url: `${portalBaseUrl()}/settings/billing`,
    });
    return { url: session.url };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't open billing." };
  }
}

/**
 * A new subscription on the same Stripe customer, for a company whose old
 * one has ended. The Customer Portal can't bring back a canceled
 * subscription, so coming back is a fresh Checkout; the webhook's sync
 * then picks the working subscription over the dead one.
 */
export async function renewSubscription(): Promise<UrlResult> {
  const found = await billingForCaller();
  if ("error" in found) return { error: found.error };
  const config = signupConfig();
  if (!config) return { error: "Billing isn't switched on for this deployment." };
  const base = portalBaseUrl();
  try {
    const session = await found.stripe.checkout.sessions.create({
      mode: "subscription",
      customer: found.billing.customerId,
      line_items: [{ price: config.priceId, quantity: 1 }],
      // Not "crm_signup": this must not provision a second company.
      metadata: { kind: "crm_renewal" },
      success_url: `${base}/billing-locked?renewed=1`,
      cancel_url: `${base}/billing-locked`,
    });
    if (!session.url) return { error: "Couldn't start checkout. Try again." };
    return { url: session.url };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't start checkout." };
  }
}

/**
 * Asks Stripe directly instead of waiting for the webhook. Open to every
 * member, not just admins: whoever is staring at the lock screen after
 * the bill was paid should be able to get back in.
 */
export async function recheckBilling(): Promise<{ locked: boolean; error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { locked: true, error: "Sign in first." };
  const env = getStripeEnv();
  const billing = await readCompanyBilling(profile.company_id);
  if (!env || !billing) return { locked: false };
  const synced = await syncCustomerBilling(stripeClient(env), billing.customerId);
  if (!synced.ok) return { locked: true, error: synced.error };
  const fresh = await readCompanyBilling(profile.company_id);
  return { locked: isBillingLocked(fresh?.status) };
}

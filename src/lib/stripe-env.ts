import "server-only";
import Stripe from "stripe";

export type StripeEnv = {
  secretKey: string;
  webhookSecret: string | null;
};

/**
 * Reads Stripe credentials, or null when they are not configured.
 *
 * Mirrors getTwilioEnv: every caller checks for null and degrades to
 * "payments aren't switched on yet" rather than throwing, so the portal
 * keeps working perfectly well before an account exists.
 */
export function getStripeEnv(): StripeEnv | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;
  return {
    secretKey,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? null,
  };
}

export function stripeClient(env: StripeEnv): Stripe {
  return new Stripe(env.secretKey);
}

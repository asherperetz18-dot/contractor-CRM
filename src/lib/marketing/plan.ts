import "server-only";
import { stripeClient } from "@/lib/stripe-env";
import { signupConfig } from "@/lib/signup/provision";
import { formatPlanPrice } from "@/lib/marketing/plan-price";

/**
 * The self-serve plan's price as the front page prints it, read off the
 * same Stripe price checkout charges (SIGNUP_PRICE_ID). Null when signup
 * isn't configured or Stripe can't be reached -- the page then shows the
 * plan without a number rather than failing to render.
 */
export async function loadPlanPrice(): Promise<{ amount: string; per: string } | null> {
  const config = signupConfig();
  if (!config) return null;
  try {
    const price = await stripeClient(config.env).prices.retrieve(config.priceId);
    return formatPlanPrice(price);
  } catch {
    return null;
  }
}

import "server-only";
import { stripeClient } from "@/lib/stripe-env";
import { signupConfig } from "@/lib/signup/provision";
import { TRIAL_DAYS } from "@/lib/billing/trial";

// The pending lookup is cached, not just its answer -- SIGNUP_PRICE_ID is
// one env var, constant for the process, so there is only ever one key.
// Caching the resolved value alone still let concurrent clicks on a cold
// instance each start their own Stripe call before the first returned;
// caching the promise means every caller in that window shares the one
// request already in flight.
let checkoutMode: Promise<"subscription" | "payment"> | undefined;

export function checkoutModeFor(
  stripe: ReturnType<typeof stripeClient>,
  priceId: string
): Promise<"subscription" | "payment"> {
  checkoutMode ??= stripe.prices
    .retrieve(priceId)
    .then((price) => (price.recurring ? "subscription" : "payment"))
    .catch((err) => {
      // A failed lookup must not be cached, or every signup attempt for
      // the rest of the process's life fails the same way.
      checkoutMode = undefined;
      throw err;
    });
  return checkoutMode;
}

/**
 * How many free days a signup starts with: the trial for a monthly plan,
 * none for a one-off price. Null when signup isn't configured or Stripe
 * can't be asked right now -- the Get Started page then makes no promise.
 */
export async function signupTrialDays(): Promise<number | null> {
  const config = signupConfig();
  if (!config) return null;
  try {
    const mode = await checkoutModeFor(stripeClient(config.env), config.priceId);
    return mode === "subscription" ? TRIAL_DAYS : null;
  } catch {
    return null;
  }
}

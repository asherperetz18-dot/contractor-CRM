import { NextRequest } from "next/server";
import { getStripeEnv } from "@/lib/stripe-env";
import { handleStripeWebhook } from "@/lib/stripe/handle-webhook";

// Stripe signs the exact bytes it sent. Next's parsed body would not
// match, so the raw text is read and passed through untouched.
export const dynamic = "force-dynamic";

/**
 * The platform endpoint, verified against the deployment's own Stripe
 * secret. Companies that have connected their own account use
 * /api/stripe/webhook/<company id> instead, which is signed by their
 * secret rather than this one.
 */
export async function POST(req: NextRequest) {
  return handleStripeWebhook(req, getStripeEnv());
}

import { NextRequest, NextResponse } from "next/server";
import { getStripeForCompany } from "@/lib/stripe-company";
import { handleStripeWebhook } from "@/lib/stripe/handle-webhook";
import { resolveCorrelationId } from "@/lib/observability/context";
import { runObserved } from "@/lib/observability/observe";

export const dynamic = "force-dynamic";

/**
 * One endpoint per company, because each contractor brings their own
 * Stripe account and signs with their own secret.
 *
 * The company has to be known before the body can be parsed -- the whole
 * point of signature verification is not trusting the payload until it
 * checks out -- so it travels in the URL rather than being read from the
 * event. That is not a secret and does not need to be: the signature is
 * what proves the request came from Stripe, and a wrong or invented id
 * simply fails to verify.
 */
async function handlePost(
  req: NextRequest,
  { params }: { params: Promise<{ companyId: string }> }
) {
  const { companyId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) {
    return NextResponse.json({ error: "bad company" }, { status: 400 });
  }

  const env = await getStripeForCompany(companyId);
  return handleStripeWebhook(req, env, companyId);
}

// Observability rollout (TECH_DEBT -> DECISIONS #031): timing, correlation
// id, and Sentry capture for every run, runObserved directly, since withRouteObservability cannot pass
// the dynamic segment through -- otherwise same shape as the dialer path.
export function POST(
  req: NextRequest,
  ctx: { params: Promise<{ companyId: string }> }
) {
  return runObserved({
    name: "api.stripe.webhook.company",
    correlationId: resolveCorrelationId(req.headers.get("x-correlation-id")),
    fn: () => handlePost(req, ctx),
  });
}

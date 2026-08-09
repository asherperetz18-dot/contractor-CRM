import { NextRequest, NextResponse } from "next/server";
import { getStripeForCompany } from "@/lib/stripe-company";
import { handleStripeWebhook } from "@/lib/stripe/handle-webhook";

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
export async function POST(
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

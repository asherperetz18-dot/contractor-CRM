import "server-only";
import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripeClient, type StripeEnv } from "@/lib/stripe-env";
import { resolvePaymentMethod } from "@/lib/stripe-method";
import { provisionSignup } from "@/lib/signup/provision";

/**
 * Applies a verified Stripe event to the payment record.
 *
 * Shared by the platform endpoint and the per-company one. Each
 * contractor brings their own Stripe account and therefore signs with
 * their own secret, so which secret to verify against has to be known
 * before the body can be trusted -- the per-company route carries the
 * company in its URL for exactly that reason.
 *
 * companyId, when given, also scopes every write. Session ids are
 * globally unique so a collision is not realistic, but one company's
 * webhook should not be able to reach another company's rows even in
 * principle.
 */
export async function handleStripeWebhook(
  req: NextRequest,
  env: StripeEnv | null,
  companyId?: string
): Promise<NextResponse> {
  if (!env?.webhookSecret) {
    // 200 rather than an error: without a secret this endpoint cannot
    // verify anything, and a failure would make Stripe retry an event it
    // can never deliver.
    return NextResponse.json({ ok: true, skipped: "not configured" });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "unsigned" }, { status: 400 });

  const raw = await req.text();
  const stripe = stripeClient(env);
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, signature, env.webhookSecret);
  } catch {
    // An unverifiable event is rejected outright. This endpoint moves
    // money into the record, so anyone who could POST to it would
    // otherwise be able to mark an invoice paid.
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }

  const admin = createAdminClient();

  // A CRM signup, not a contractor collecting from their own customer.
  // Only the platform endpoint can carry one -- a company's own Stripe
  // account never sells this -- so companyId being absent is part of the
  // test rather than an accident. Handled before the portal_payments
  // paths below because it touches none of the same rows.
  if (
    !companyId &&
    (event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded")
  ) {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.kind === "crm_signup") {
      // Both events fire for the same bank debit -- once on checkout,
      // once when it settles -- and Stripe retries on any non-2xx.
      // provisionSignup is written to be called repeatedly: the unique
      // stripe_session_id column means one invite and one email.
      const result = await provisionSignup(session.id);

      // A failure that another attempt could fix -- the mail provider
      // was down, the database refused a write -- is answered with a 500
      // so Stripe retries it. Someone has paid and is waiting for this
      // email; swallowing the error behind a 200 is how they end up with
      // a charge and no account.
      if (!result.ok && result.retryable) {
        return NextResponse.json({ error: result.error ?? "provisioning failed" }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }
  }

  const applyToSession = async (sessionId: string, patch: Record<string, unknown>) => {
    let query = admin.from("portal_payments").update(patch).eq("stripe_session_id", sessionId);
    if (companyId) query = query.eq("company_id", companyId);
    await query;
  };

  const now = () => new Date().toISOString();

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    // Only mark paid when Stripe says the money is actually there. ACH
    // completes checkout while the transfer is still in flight, so
    // payment_status is the field that matters, not session completion.
    const settled = session.payment_status === "paid";
    await applyToSession(session.id, {
      status: settled ? "succeeded" : "pending",
      method: await resolvePaymentMethod(stripe, session),
      stripe_payment_intent_id:
        typeof session.payment_intent === "string" ? session.payment_intent : null,
      paid_at: settled ? now() : null,
      updated_at: now(),
    });
  }

  if (event.type === "checkout.session.async_payment_succeeded") {
    // ACH clearing a few business days later.
    const session = event.data.object as Stripe.Checkout.Session;
    await applyToSession(session.id, {
      status: "succeeded",
      method: await resolvePaymentMethod(stripe, session),
      paid_at: now(),
      updated_at: now(),
    });
  }

  if (event.type === "checkout.session.async_payment_failed") {
    const session = event.data.object as Stripe.Checkout.Session;
    await applyToSession(session.id, {
      status: "failed",
      failure_reason: "Bank transfer failed",
      updated_at: now(),
    });
  }

  if (event.type === "checkout.session.expired") {
    const session = event.data.object as Stripe.Checkout.Session;
    await applyToSession(session.id, { status: "cancelled", updated_at: now() });
  }

  // Always 200 once verified. Stripe retries on anything else, and a
  // duplicate delivery re-runs these updates -- they are written to be
  // idempotent (same row, same values) precisely because of that.
  return NextResponse.json({ ok: true });
}

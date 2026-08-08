import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripeEnv, stripeClient } from "@/lib/stripe-env";

// Stripe signs the exact bytes it sent. Next's parsed body would not
// match, so the raw text is read and passed through untouched.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const env = getStripeEnv();
  if (!env?.webhookSecret) {
    // 200 rather than an error: without a secret this endpoint cannot
    // verify anything, and returning a failure would make Stripe retry
    // an event it can never deliver.
    return NextResponse.json({ ok: true, skipped: "not configured" });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "unsigned" }, { status: 400 });

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripeClient(env).webhooks.constructEvent(raw, signature, env.webhookSecret);
  } catch {
    // An unverifiable event is rejected outright. This endpoint moves
    // money into the record, so anyone who can POST to it could otherwise
    // mark an invoice paid.
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }

  const admin = createAdminClient();

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    // Only mark paid when Stripe says the money is actually there. ACH
    // completes checkout while the transfer is still in flight, so
    // payment_status is the field that matters, not session completion.
    const settled = session.payment_status === "paid";

    await admin
      .from("portal_payments")
      .update({
        status: settled ? "succeeded" : "pending",
        method: session.payment_method_types?.[0] ?? null,
        stripe_payment_intent_id:
          typeof session.payment_intent === "string" ? session.payment_intent : null,
        paid_at: settled ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("stripe_session_id", session.id);
  }

  if (event.type === "checkout.session.async_payment_succeeded") {
    // ACH clearing a few days later.
    const session = event.data.object as Stripe.Checkout.Session;
    await admin
      .from("portal_payments")
      .update({
        status: "succeeded",
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("stripe_session_id", session.id);
  }

  if (event.type === "checkout.session.async_payment_failed") {
    const session = event.data.object as Stripe.Checkout.Session;
    await admin
      .from("portal_payments")
      .update({
        status: "failed",
        failure_reason: "Bank transfer failed",
        updated_at: new Date().toISOString(),
      })
      .eq("stripe_session_id", session.id);
  }

  if (event.type === "checkout.session.expired") {
    const session = event.data.object as Stripe.Checkout.Session;
    await admin
      .from("portal_payments")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("stripe_session_id", session.id);
  }

  // Always 200 once verified. Stripe retries on anything else, and a
  // duplicate delivery would re-run these updates -- they are written to
  // be idempotent (same row, same values) precisely because of that.
  return NextResponse.json({ ok: true });
}

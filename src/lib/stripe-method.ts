import "server-only";
import type Stripe from "stripe";

/**
 * The payment method actually used, rather than the ones on offer.
 *
 * session.payment_method_types is the list Checkout *displayed* -- with
 * dynamic payment methods that is card, klarna, link, cashapp and so on,
 * in Stripe's own ordering. Reading [0] from it and calling that "the
 * method" records whatever happened to be listed first: a live $1.00
 * deposit paid by card was filed as "klarna" purely because Klarna sorted
 * ahead of it.
 *
 * The truth is on the charge. Falls back to the offered list only when a
 * single method was available, where first-and-only is unambiguous.
 */
export async function resolvePaymentMethod(
  stripe: Stripe,
  session: Stripe.Checkout.Session
): Promise<string | null> {
  const pi = session.payment_intent;
  const intentId = typeof pi === "string" ? pi : (pi?.id ?? null);

  if (intentId) {
    try {
      const intent = await stripe.paymentIntents.retrieve(intentId, {
        expand: ["latest_charge"],
      });
      const charge = intent.latest_charge;
      if (charge && typeof charge !== "string") {
        const type = charge.payment_method_details?.type;
        if (type) return type;
      }
    } catch {
      // A method we cannot confirm is better left unknown than guessed.
    }
  }

  const offered = session.payment_method_types ?? [];
  return offered.length === 1 ? offered[0] : null;
}

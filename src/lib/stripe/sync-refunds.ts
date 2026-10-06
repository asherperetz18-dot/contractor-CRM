import "server-only";
import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Records the refunds Stripe holds for one payment (DECISIONS #155): a
 * refund made in the Stripe dashboard shows up in the CRM by itself.
 *
 * Asks Stripe for every refund of the payment and writes each one the
 * CRM doesn't have yet (record_refund, 0210: never more than the payment,
 * once per Stripe refund id), or moves one it has on (settle_refund: a
 * failed one takes back its credit). Whether the customer still owes what
 * was refunded is left undecided -- nobody was asked -- and decided in
 * the CRM after. Safe to run any number of times for the same payment.
 *
 * `ok: false` means "try again later" (the webhook answers 500 so Stripe
 * delivers it again). A refund the database refuses for good -- more
 * than is left, because the same money was also recorded by hand -- is
 * not that: retrying can't help, so it is reported in `refused` and the
 * rest go on.
 */

type Admin = ReturnType<typeof createAdminClient>;

export type RefundSync = {
  ok: boolean;
  error?: string;
  /** Refunds written for the first time. */
  recorded: number;
  /** Refunds the database refused for good, in words for the office. */
  refused: string[];
};

function refundStatus(status: string | null): "pending" | "succeeded" | "failed" | "cancelled" {
  if (status === "succeeded") return "succeeded";
  if (status === "canceled") return "cancelled";
  if (status === "failed") return "failed";
  return "pending";
}

function refundReason(reason: string | null): string {
  return `Refunded in Stripe${reason ? ` (${reason.replace(/_/g, " ")})` : ""}`;
}

/** A refusal retrying can't change: a check the refund fails, or a row gone. */
function refusedForGood(code: string | undefined): boolean {
  return code === "23514" || code === "P0002";
}

/** The database hasn't had 0210 yet: no refund column or function. Not
 *  worth Stripe retrying for days -- Sync payments from Stripe records
 *  them once it has. */
function before0210(code: string | undefined): boolean {
  return code === "42703" || code === "PGRST202" || code === "PGRST204";
}

const NEEDS_0210 =
  "Refunds made in Stripe can't be recorded until the 0210 database update has run. Run it, then use Sync payments from Stripe.";

const dollars = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export async function syncStripeRefunds(
  admin: Admin,
  stripe: Stripe,
  paymentIntentId: string,
  companyId?: string,
  opts: { lookUpCheckout?: boolean } = {}
): Promise<RefundSync> {
  const retry = (error: string): RefundSync => ({ ok: false, error, recorded: 0, refused: [] });

  // The payment the intent paid, in this company when the endpoint says which.
  let query = admin
    .from("portal_payments")
    .select("id, company_id, method, status")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .gt("amount_cents", 0);
  if (companyId) query = query.eq("company_id", companyId);
  const { data: originals, error: readError } = await query.returns<
    { id: string; company_id: string; method: string | null; status: string }[]
  >();
  if (readError) return retry(readError.message);
  const original = originals?.[0];

  if (!original) {
    // Not linked to its intent yet? The checkout's own event writes the
    // intent, and may not have arrived. If the intent's checkout is one
    // of ours, wait for it (Stripe delivers this again) rather than
    // dropping the refund for good.
    if (opts.lookUpCheckout === false) return { ok: true, recorded: 0, refused: [] };
    const sessions = await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 });
    const sessionId = sessions.data[0]?.id;
    if (!sessionId) return { ok: true, recorded: 0, refused: [] };
    let ours = admin.from("portal_payments").select("id").eq("stripe_session_id", sessionId).gt("amount_cents", 0);
    if (companyId) ours = ours.eq("company_id", companyId);
    const { data: found, error: oursError } = await ours.limit(1).returns<{ id: string }[]>();
    if (oursError) return retry(oursError.message);
    // A subscription, or another business's: nothing to do.
    if (!found?.length) return { ok: true, recorded: 0, refused: [] };
    return retry("The payment isn't linked to Stripe yet; try again.");
  }
  // Money the CRM doesn't have as arrived yet: its own event is on the
  // way. Wait for it, as above.
  if (original.status !== "succeeded") return retry("The payment isn't recorded as paid yet; try again.");

  let recorded = 0;
  const refused: string[] = [];
  let failure: string | undefined;
  for await (const r of stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 })) {
    const status = refundStatus(r.status);
    const { data: existing, error: existingError } = await admin
      .from("portal_payments")
      .select("id, status")
      .eq("stripe_refund_id", r.id)
      .eq("company_id", original.company_id)
      .maybeSingle<{ id: string; status: string }>();
    if (existingError) {
      if (before0210(existingError.code)) return { ok: true, recorded, refused: [NEEDS_0210] };
      failure ??= existingError.message;
      continue;
    }
    if (existing) {
      if (existing.status !== status) {
        // With its credit in the same step when it failed (0210).
        const { error } = await admin.rpc("settle_refund", {
          p_company: original.company_id,
          p_refund: existing.id,
          p_status: status,
        });
        if (error) failure ??= error.message;
      }
      continue;
    }
    // A refund that failed before we ever saw it never moved money.
    if (status === "failed" || status === "cancelled") continue;
    const { error } = await admin.rpc("record_refund", {
      p_company: original.company_id,
      p_payment: original.id,
      p_amount: r.amount,
      p_reason: refundReason(r.reason),
      p_by: null,
      p_still_owed: null,
      p_method: original.method,
      p_refunded_at: new Date(r.created * 1000).toISOString(),
      p_stripe_refund_id: r.id,
      p_status: status,
    });
    if (!error) {
      recorded += 1;
    } else if (error.code === "23505") {
      // Two deliveries at once: the other one recorded it.
    } else if (before0210(error.code)) {
      return { ok: true, recorded, refused: [NEEDS_0210] };
    } else if (refusedForGood(error.code)) {
      refused.push(
        `A ${dollars(r.amount)} refund made in Stripe wasn't recorded: ${error.message} If the same money was also recorded by hand, remove that one, then use Sync payments from Stripe.`
      );
    } else {
      failure ??= error.message;
    }
  }
  if (refused.length) console.warn("[stripe refunds] not recorded:", refused.join(" | "));
  return failure ? { ok: false, error: failure, recorded, refused } : { ok: true, recorded, refused };
}

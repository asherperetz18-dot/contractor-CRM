import "server-only";
import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Records the refunds Stripe holds for one payment (DECISIONS #155): a
 * refund made in the Stripe dashboard shows up in the CRM by itself.
 *
 * Asks Stripe for every refund of the payment and writes each one the
 * CRM doesn't have yet (record_refund, 0210: never more than the payment,
 * once per Stripe refund id), or moves one it has from pending to
 * succeeded or failed. Whether the customer still owes what was refunded
 * is left undecided -- nobody was asked -- and decided in the CRM after.
 * Safe to run any number of times for the same payment.
 */

type Admin = ReturnType<typeof createAdminClient>;

function refundStatus(status: string | null): "pending" | "succeeded" | "failed" | "cancelled" {
  if (status === "succeeded") return "succeeded";
  if (status === "canceled") return "cancelled";
  if (status === "failed") return "failed";
  return "pending";
}

function refundReason(reason: string | null): string {
  return `Refunded in Stripe${reason ? ` (${reason.replace(/_/g, " ")})` : ""}`;
}

export async function syncStripeRefunds(
  admin: Admin,
  stripe: Stripe,
  paymentIntentId: string,
  companyId?: string
): Promise<{ ok: boolean; error?: string }> {
  // The payment the intent paid, in this company when the endpoint says which.
  let query = admin
    .from("portal_payments")
    .select("id, company_id, method")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .gt("amount_cents", 0);
  if (companyId) query = query.eq("company_id", companyId);
  const { data: originals } = await query.returns<{ id: string; company_id: string; method: string | null }[]>();
  const original = originals?.[0];
  // Not one of ours (a subscription, or another account's): nothing to do.
  if (!original) return { ok: true };

  const list = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 });
  for (const r of list.data) {
    const status = refundStatus(r.status);
    const { data: existing } = await admin
      .from("portal_payments")
      .select("id, status")
      .eq("stripe_refund_id", r.id)
      .eq("company_id", original.company_id)
      .maybeSingle<{ id: string; status: string }>();
    if (existing) {
      if (existing.status !== status) {
        await admin
          .from("portal_payments")
          .update({
            status,
            paid_at: status === "succeeded" ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
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
    // Two deliveries at once: the other one recorded it.
    if (error && error.code !== "23505") return { ok: false, error: error.message };
  }
  return { ok: true };
}

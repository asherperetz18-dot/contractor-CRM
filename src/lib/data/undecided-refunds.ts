import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Refunds made in Stripe that have gone through and that nobody has yet
 * said are still owed (0210, DECISIONS #155). Until the office answers,
 * what the customer sees leaves them out (`withoutUndecidedRefunds`):
 * counted, the bill would read owed again, with a Pay button, for money
 * just given back -- and if it were paid, the "No, credit it" most
 * refunds get would find nothing left to credit.
 *
 * Its own read, so a database without 0210 just has none.
 */

const IN_CHUNK = 150;

export async function undecidedRefundIds(
  db: SupabaseClient,
  column: "estimate_id" | "estimate_payment_id" | "lead_id",
  values: string[]
): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let i = 0; i < values.length; i += IN_CHUNK) {
    const { data, error } = await db
      .from("portal_payments")
      .select("id")
      .in(column, values.slice(i, i + IN_CHUNK))
      .not("refund_of", "is", null)
      .is("refund_still_owed", null)
      .eq("status", "succeeded")
      .returns<{ id: string }[]>();
    if (error) return new Set();
    for (const r of data ?? []) ids.add(r.id);
  }
  return ids;
}

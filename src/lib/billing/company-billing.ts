import "server-only";
import { revalidateTag, unstable_cache } from "next/cache";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { pickSubscription } from "@/lib/billing/subscription";

/**
 * A company's AI Build Pros subscription, as kept in company_billing (0175).
 *
 * Read and written through the service-role client: the table has no
 * write policies at all, so a company's own Admin cannot mark a lapsed
 * subscription paid. `companyId` must therefore always be one RLS has
 * already placed the caller in -- in practice `profile.company_id`.
 */

export type CompanyBilling = {
  customerId: string;
  subscriptionId: string | null;
  status: string | null;
};

const billingTag = (companyId: string) => `company-billing:${companyId}`;

/** Uncached, for the lock screen and the billing page. Null = not subscribed. */
export async function readCompanyBilling(companyId: string): Promise<CompanyBilling | null> {
  const { data, error } = await createAdminClient()
    .from("company_billing")
    .select("stripe_customer_id, stripe_subscription_id, billing_status")
    .eq("company_id", companyId)
    .maybeSingle();
  // Before 0175 has run the table isn't there, and a company that can't
  // be shown to be lapsed is treated as not lapsed.
  if (error || !data) return null;
  const row = data as {
    stripe_customer_id: string;
    stripe_subscription_id: string | null;
    billing_status: string | null;
  };
  return {
    customerId: row.stripe_customer_id,
    subscriptionId: row.stripe_subscription_id,
    status: row.billing_status,
  };
}

/**
 * Cached per company for the app shell, which asks on every page load.
 * The webhook drops the entry the moment Stripe reports a change; the
 * backstop only matters for a row edited straight in the database.
 */
export function getCompanyBilling(companyId: string): Promise<CompanyBilling | null> {
  return unstable_cache(readCompanyBilling, ["company-billing", companyId], {
    tags: [billingTag(companyId)],
    revalidate: 300,
  })(companyId);
}

export type SyncResult = { ok: true } | { ok: false; error: string };

/**
 * Pulls a customer's subscriptions from Stripe and records the one that
 * speaks for them on their company.
 *
 * Asks Stripe rather than trusting the event it was woken by: Stripe does
 * not promise delivery order, so an old "past_due" arriving after the
 * "active" that replaced it would otherwise lock a paying company out.
 *
 * A customer with no company yet has paid but not finished setting up;
 * registration links them and syncs then, so there is nothing to do.
 */
export async function syncCustomerBilling(
  stripe: Stripe,
  customerId: string
): Promise<SyncResult> {
  const admin = createAdminClient();

  const { data: linked, error: linkedError } = await admin
    .from("company_billing")
    .select("company_id")
    .eq("stripe_customer_id", customerId)
    .limit(1);
  // A missing table (0175 not run) is a failure worth retrying: Stripe
  // keeps trying for three days, and succeeds once the migration lands.
  if (linkedError) return { ok: false, error: linkedError.message };

  let companyId = (linked as { company_id: string }[] | null)?.[0]?.company_id ?? null;
  if (!companyId) {
    const { data: invite } = await admin
      .from("signup_invites")
      .select("company_id")
      .eq("stripe_customer_id", customerId)
      .not("company_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1);
    companyId = (invite as { company_id: string }[] | null)?.[0]?.company_id ?? null;
  }
  if (!companyId) return { ok: true };

  let subs: Stripe.Subscription[];
  try {
    const list = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 20 });
    subs = list.data;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't read subscriptions." };
  }
  const current = pickSubscription(subs);

  const { error } = await admin.from("company_billing").upsert({
    company_id: companyId,
    stripe_customer_id: customerId,
    stripe_subscription_id: current?.id ?? null,
    billing_status: current?.status ?? null,
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: error.message };

  // Expire outright rather than serve stale: a renewal should unlock the
  // very next page load, and a cancellation should lock it.
  revalidateTag(billingTag(companyId), { expire: 0 });
  return { ok: true };
}

import "server-only";
import { revalidateTag, unstable_cache } from "next/cache";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { pickSubscription } from "@/lib/billing/subscription";
import { isMissingSchemaError } from "@/lib/schema-drift";
import { logWarn } from "@/lib/observability/logger";

/**
 * A company's AI Build Pro subscription, as kept in company_billing (0175).
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
  /** When the free trial ends or ended (0198); null before it has run, or with no trial. */
  trialEndsAt: string | null;
  /** Whether Stripe has a card to charge (0198); null before it has run. */
  cardOnFile: boolean | null;
};

const billingTag = (companyId: string) => `company-billing:${companyId}`;

/** Uncached, for the lock screen and the billing page. Null = not subscribed. */
export async function readCompanyBilling(companyId: string): Promise<CompanyBilling | null> {
  // "*", not a named list: the trial columns (0198) may not exist yet,
  // and naming them would fail the read -- and the lock -- until they do.
  const { data, error } = await createAdminClient()
    .from("company_billing")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();
  // Before 0175 has run the table isn't there, and a company that can't
  // be shown to be lapsed is treated as not lapsed.
  if (error || !data) return null;
  const row = data as {
    stripe_customer_id: string;
    stripe_subscription_id: string | null;
    billing_status: string | null;
    trial_ends_at?: string | null;
    card_on_file?: boolean | null;
  };
  return {
    customerId: row.stripe_customer_id,
    subscriptionId: row.stripe_subscription_id,
    status: row.billing_status,
    trialEndsAt: row.trial_ends_at ?? null,
    cardOnFile: row.card_on_file ?? null,
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

  // The trial's end and whether a card is waiting for it (0198), written
  // on their own: until 0198 has run the columns don't exist, and that
  // must not stop the status above from syncing -- a missed cancellation
  // is a company using the CRM unpaid.
  const trial = await trialFields(stripe, customerId, current);
  const { error: trialError } = await admin
    .from("company_billing")
    .update(trial)
    .eq("company_id", companyId);
  if (trialError && !isMissingSchemaError(trialError)) {
    logWarn({ event: "billing.trial_sync_failed", companyId, message: trialError.message });
  }

  // Expire outright rather than serve stale: a renewal should unlock the
  // very next page load, and a cancellation should lock it.
  revalidateTag(billingTag(companyId), { expire: 0 });
  return { ok: true };
}

const paymentMethodId = (pm: string | { id: string } | null | undefined) =>
  !pm ? null : typeof pm === "string" ? pm : pm.id;

/**
 * The trial's end date and whether there is a card to charge, from the
 * subscription and, when it names no card of its own, the customer.
 *
 * A card added in the Customer Portal during a trial lands on the
 * customer, not the subscription. It is copied onto the subscription
 * here, so the trial's "no card: cancel" rule (src/lib/billing/trial.ts)
 * can never miss a card the customer did add. A failed copy is left for
 * the next sync; the card still reads as on file.
 */
async function trialFields(
  stripe: Stripe,
  customerId: string,
  current: Stripe.Subscription | null
): Promise<{ trial_ends_at: string | null; card_on_file: boolean | null }> {
  const trialEndsAt = current?.trial_end ? new Date(current.trial_end * 1000).toISOString() : null;
  if (!current) return { trial_ends_at: null, card_on_file: null };
  if (paymentMethodId(current.default_payment_method)) {
    return { trial_ends_at: trialEndsAt, card_on_file: true };
  }

  let customerCard: string | null = null;
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (!customer.deleted) {
      customerCard =
        paymentMethodId(customer.invoice_settings?.default_payment_method) ??
        paymentMethodId(customer.default_source);
    }
  } catch {
    // Unknown is not "no card": leave it for the next sync to answer.
    return { trial_ends_at: trialEndsAt, card_on_file: null };
  }

  if (customerCard && current.status === "trialing" && customerCard.startsWith("pm_")) {
    try {
      await stripe.subscriptions.update(current.id, { default_payment_method: customerCard });
    } catch {
      // Retried on the next sync.
    }
  }
  return { trial_ends_at: trialEndsAt, card_on_file: Boolean(customerCard) };
}

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/crypto/secrets";
import { getStripeEnv, type StripeEnv } from "@/lib/stripe-env";

export type CompanyStripe = StripeEnv & {
  /** "company" means the contractor's own account; "platform" is the shared fallback. */
  source: "company" | "platform";
};

type StripeColumns = {
  stripe_secret_key_enc: string | null;
  stripe_webhook_secret_enc: string | null;
};

/**
 * The Stripe account a given company takes money into.
 *
 * Each contractor brings their own account, so payments must be created
 * against the credentials belonging to the company that owns the
 * estimate -- otherwise a customer of one business pays another one's
 * Stripe account, which is exactly what happened while this was a single
 * environment variable.
 *
 * Falls back to the platform key when a company has not connected its
 * own, so the original business keeps working unchanged rather than
 * losing payments the moment this shipped. A company with its own key
 * never touches the fallback.
 */
export async function getStripeForCompany(companyId: string): Promise<CompanyStripe | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("company_profile")
    .select("stripe_secret_key_enc, stripe_webhook_secret_enc")
    .eq("company_id", companyId)
    .maybeSingle<StripeColumns>();

  const secretKey = decryptSecret(data?.stripe_secret_key_enc);
  if (secretKey) {
    return {
      secretKey,
      webhookSecret: decryptSecret(data?.stripe_webhook_secret_enc),
      source: "company",
    };
  }

  const platform = getStripeEnv();
  return platform ? { ...platform, source: "platform" } : null;
}

/**
 * Whether this company has connected its own account, regardless of
 * whether the platform fallback exists. Used by the UI to say "your
 * account" versus "using the platform account".
 */
export async function companyHasOwnStripe(companyId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("company_profile")
    .select("stripe_secret_key_enc")
    .eq("company_id", companyId)
    .maybeSingle<{ stripe_secret_key_enc: string | null }>();
  return decryptSecret(data?.stripe_secret_key_enc) !== null;
}

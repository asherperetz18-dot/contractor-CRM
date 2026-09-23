import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/crypto/secrets";
import type { StripeEnv } from "@/lib/stripe-env";

export type CompanyStripe = StripeEnv;

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
 * No fallback to the deployment's STRIPE_SECRET_KEY: that is the AI
 * Build Pros account, which sells the CRM itself. Falling back to it sent
 * the deposits of any company without its own account into ours. A
 * company that hasn't connected one simply has no online payment.
 */
export async function getStripeForCompany(companyId: string): Promise<CompanyStripe | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("company_profile")
    .select("stripe_secret_key_enc, stripe_webhook_secret_enc")
    .eq("company_id", companyId)
    .maybeSingle<StripeColumns>();

  const secretKey = decryptSecret(data?.stripe_secret_key_enc);
  if (!secretKey) return null;
  return { secretKey, webhookSecret: decryptSecret(data?.stripe_webhook_secret_enc) };
}

/**
 * Whether this company has connected its own Stripe account -- the only
 * account its customers can pay into.
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

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/crypto/secrets";
import { getEmailEnv } from "@/lib/email-env";

export type CompanyEmail = {
  apiKey: string;
  from: string;
  source: "company" | "platform";
};

type EmailColumns = {
  email_from: string | null;
  email_from_name: string | null;
  resend_api_key_enc: string | null;
};

/**
 * The email identity a company's customer-facing messages send from.
 *
 * A customer signing with Smart HVAC must see "Smart HVAC" in their inbox,
 * not whichever business happened to be the platform's original tenant --
 * the same problem the Twilio number sender solves for texts and calls.
 *
 * Unlike Twilio, a custom From address does not require a dedicated
 * Resend account: Resend lets one account send from every domain it has
 * verified, so a company can set just its own address while the platform
 * key still does the sending. A company that wants full independence can
 * still bring its own key.
 */
export async function getEmailForCompany(companyId: string): Promise<CompanyEmail | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("company_profile")
    .select("email_from, email_from_name, resend_api_key_enc")
    .eq("company_id", companyId)
    .maybeSingle<EmailColumns>();

  const platform = getEmailEnv();

  if (data?.email_from) {
    const from = data.email_from_name
      ? `${data.email_from_name} <${data.email_from}>`
      : data.email_from;
    const ownKey = decryptSecret(data.resend_api_key_enc);
    if (ownKey) return { apiKey: ownKey, from, source: "company" };
    if (platform) return { apiKey: platform.apiKey, from, source: "company" };
  }

  return platform ? { apiKey: platform.apiKey, from: platform.from, source: "platform" } : null;
}

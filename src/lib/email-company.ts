import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/crypto/secrets";
import { getEmailEnv } from "@/lib/email-env";
import { companyEmailPlan, type CompanyEmailInputs } from "@/lib/email-from";

export type CompanyEmail = {
  apiKey: string;
  from: string;
  source: "company" | "platform";
  /** Where the customer's reply goes; pass it to sendEmail as replyTo. */
  replyTo: string | null;
  /** The company it sends for, so sendEmail can count it (DECISIONS #132). */
  companyId: string;
};

type EmailColumns = CompanyEmailInputs & { resend_api_key_enc: string | null };

/**
 * The email identity a company's customer-facing messages send from.
 *
 * A customer signing with Smart HVAC must see "Smart HVAC" in their inbox,
 * not whichever business happened to be the platform's original tenant --
 * the same problem the Twilio number sender solves for texts and calls.
 *
 * A company's own address needs its own Resend account, where Resend has
 * checked the company controls the domain. Without one, AI Build Pros'
 * shared sender sends under the company's name and the reply goes to the
 * company (companyEmailPlan, DECISIONS #110). The shared key never sends
 * from a company's own address: it has other companies' domains verified.
 */
export async function getEmailForCompany(companyId: string): Promise<CompanyEmail | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("company_profile")
    .select("email_from, email_from_name, name, email, resend_api_key_enc")
    .eq("company_id", companyId)
    .maybeSingle<EmailColumns>();
  const { data: company } = await admin
    .from("companies")
    .select("name")
    .eq("id", companyId)
    .maybeSingle<{ name: string }>();

  const ownKey = decryptSecret(data?.resend_api_key_enc ?? null);
  const platform = getEmailEnv();
  const plan = companyEmailPlan(
    {
      email_from: data?.email_from ?? null,
      email_from_name: data?.email_from_name ?? null,
      name: data?.name ?? null,
      email: data?.email ?? null,
      company_name: company?.name ?? null,
    },
    !!ownKey,
    platform?.from ?? null
  );
  if (!plan) return null;
  if (plan.key === "company" && ownKey) {
    return { apiKey: ownKey, from: plan.from, source: "company", replyTo: plan.replyTo, companyId };
  }
  if (!platform) return null;
  return { apiKey: platform.apiKey, from: plan.from, source: "platform", replyTo: plan.replyTo, companyId };
}

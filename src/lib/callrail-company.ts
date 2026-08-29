import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/crypto/secrets";

export type CompanyCallRail = {
  apiKey: string;
  /** The 9-digit CallRail account id (after /a/ in their dashboard URL). */
  accountId: string;
  /** CallRail's own company resource id (COM...), used to filter calls
   *  and register webhooks -- NOT this CRM's company uuid. */
  callrailCompanyId: string;
  /** Per-company key CallRail signs webhook deliveries with. */
  signingKey: string | null;
};

type Columns = {
  callrail_account_id: string | null;
  callrail_company_id: string | null;
  callrail_api_key_enc: string | null;
  callrail_signing_key_enc: string | null;
};

/**
 * A company's CallRail credentials, decrypted. No platform fallback on
 * purpose: call tracking is always the company's own account -- there is
 * no meaningful shared default the way there is for email or Twilio.
 */
export async function getCallRailForCompany(companyId: string): Promise<CompanyCallRail | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("company_profile")
    .select("callrail_account_id, callrail_company_id, callrail_api_key_enc, callrail_signing_key_enc")
    .eq("company_id", companyId)
    .maybeSingle<Columns>();
  if (!data?.callrail_account_id || !data.callrail_company_id) return null;

  const apiKey = decryptSecret(data.callrail_api_key_enc);
  if (!apiKey) return null;

  return {
    apiKey,
    accountId: data.callrail_account_id,
    callrailCompanyId: data.callrail_company_id,
    signingKey: decryptSecret(data.callrail_signing_key_enc),
  };
}

export const CALLRAIL_API_BASE = "https://api.callrail.com/v3";

export function callrailAuthHeader(apiKey: string): Record<string, string> {
  return { Authorization: `Token token="${apiKey}"` };
}

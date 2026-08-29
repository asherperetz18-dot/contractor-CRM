import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/crypto/secrets";

export type CompanyCallRail = {
  apiKey: string;
  /** The 9-digit CallRail account id (after /a/ in their dashboard URL). */
  accountId: string;
  /** CallRail company resource ids (COM...) whose traffic feeds this CRM
   *  company. One CallRail ACCOUNT routinely tracks several brands --
   *  L.A Home's tracks four -- so this is a list, chosen at connect. */
  callrailCompanyIds: string[];
  /** Webhook signing keys, one per CallRail company. A delivery is
   *  genuine if ANY of them verifies it. */
  signingKeys: string[];
};

type Columns = {
  callrail_account_id: string | null;
  callrail_company_id: string | null;
  callrail_api_key_enc: string | null;
  callrail_signing_key_enc: string | null;
};

/** JSON array in a text column, tolerating the single-value rows the
 *  first version of this integration wrote. */
export function parseStoredList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String).filter(Boolean) : [String(v)];
  } catch {
    return [raw];
  }
}

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
  if (!data?.callrail_account_id) return null;

  const apiKey = decryptSecret(data.callrail_api_key_enc);
  if (!apiKey) return null;

  const callrailCompanyIds = parseStoredList(data.callrail_company_id);
  if (!callrailCompanyIds.length) return null;

  return {
    apiKey,
    accountId: data.callrail_account_id,
    callrailCompanyIds,
    signingKeys: parseStoredList(decryptSecret(data.callrail_signing_key_enc)),
  };
}

export const CALLRAIL_API_BASE = "https://api.callrail.com/v3";

export function callrailAuthHeader(apiKey: string): Record<string, string> {
  return { Authorization: `Token token="${apiKey}"` };
}

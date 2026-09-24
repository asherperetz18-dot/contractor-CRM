import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/crypto/secrets";
import { nsApiBase } from "@/lib/primecall";

export type CompanyPrimeCall = {
  /** https origin of the company's NetSapiens server. */
  server: string;
  /** The company's account ("domain") on that server. */
  domain: string;
  apiKey: string;
  webhookToken: string | null;
  subscriptionId: string | null;
};

type Columns = {
  primecall_server: string | null;
  primecall_domain: string | null;
  primecall_api_key_enc: string | null;
  primecall_webhook_token_enc: string | null;
  primecall_subscription_id: string | null;
};

/** A company's PrimeCall connection, decrypted, or null when there is
 *  none (or migration 0177 hasn't been run -- the select then errors and
 *  reads as "not connected"). Always the company's own account. */
export async function getPrimeCallForCompany(companyId: string): Promise<CompanyPrimeCall | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("company_profile")
    .select(
      "primecall_server, primecall_domain, primecall_api_key_enc, primecall_webhook_token_enc, primecall_subscription_id"
    )
    .eq("company_id", companyId)
    .maybeSingle<Columns>();
  if (!data?.primecall_server || !data.primecall_domain) return null;
  const apiKey = decryptSecret(data.primecall_api_key_enc);
  if (!apiKey) return null;
  return {
    server: data.primecall_server,
    domain: data.primecall_domain,
    apiKey,
    webhookToken: decryptSecret(data.primecall_webhook_token_enc),
    subscriptionId: data.primecall_subscription_id,
  };
}

/** One call to the NetSapiens v2 API. Never throws: a network failure
 *  comes back as a null response for the caller to word. */
export async function nsFetch(
  creds: { server: string; apiKey: string },
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<Response | null> {
  return fetch(`${nsApiBase(creds.server)}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      Accept: "application/json",
      ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
}

export function domainPath(domain: string): string {
  return `/domains/${encodeURIComponent(domain)}`;
}

/** Where a recording's audio can be fetched right now, or null. The
 *  recording may be filed under the caller's leg id or the answering
 *  leg's, so each is asked in turn. */
export async function recordingAccessUrl(
  creds: CompanyPrimeCall,
  callId: string
): Promise<string | null> {
  const res = await nsFetch(creds, `${domainPath(creds.domain)}/recordings/${encodeURIComponent(callId)}`);
  if (!res?.ok) return null;
  const body = (await res.json().catch(() => null)) as unknown;
  const rows = (Array.isArray(body) ? body : body ? [body] : []) as { "file-access-url"?: string }[];
  return rows.find((r) => r["file-access-url"])?.["file-access-url"] ?? null;
}

import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";
import { isMissingSchemaError } from "@/lib/schema-drift";
import { QB_MINOR_VERSION, needsRefresh, qbApiBase, quickbooksCredentials, refreshQuickBooksTokens } from "./oauth";
import { parseQbAccounts, type QbAccount } from "./accounts";

/**
 * A company's QuickBooks connection, on the server only (DECISIONS #172).
 * The login Intuit gave is stored encrypted in quickbooks_connections,
 * which no CRM user can read; this file is the one place that decrypts
 * it, refreshes it before it runs out, and asks QuickBooks for things.
 */

type Admin = ReturnType<typeof createAdminClient>;

/** What the settings page may know about the connection: never the login. */
export type QbConnectionView = {
  connected: boolean;
  realmId: string | null;
  companyName: string | null;
  environment: "sandbox" | "production";
  accounts: QbAccount[];
  accountsReadAt: string | null;
  connectedBy: string | null;
  connectedAt: string | null;
  lastError: string | null;
};

const VIEW_COLUMNS =
  "realm_id, company_name, environment, accounts, accounts_read_at, connected_by, connected_at, disconnected_at, last_error";

export async function readQuickBooksConnection(
  admin: Admin,
  companyId: string
): Promise<{ ready: boolean; connection: QbConnectionView | null }> {
  const { data, error } = await admin
    .from("quickbooks_connections")
    .select(VIEW_COLUMNS)
    .eq("company_id", companyId)
    .maybeSingle<{
      realm_id: string | null;
      company_name: string | null;
      environment: "sandbox" | "production";
      accounts: QbAccount[] | null;
      accounts_read_at: string | null;
      connected_by: string | null;
      connected_at: string | null;
      disconnected_at: string | null;
      last_error: string | null;
    }>();
  if (error) return { ready: !isMissingSchemaError(error), connection: null };
  if (!data) return { ready: true, connection: null };
  return {
    ready: true,
    connection: {
      connected: !!data.realm_id && !data.disconnected_at,
      realmId: data.realm_id,
      companyName: data.company_name,
      environment: data.environment,
      accounts: Array.isArray(data.accounts) ? data.accounts : [],
      accountsReadAt: data.accounts_read_at,
      connectedBy: data.connected_by,
      connectedAt: data.connected_at,
      lastError: data.last_error,
    },
  };
}

export type QbAccess = { realmId: string; accessToken: string; apiBase: string };

/**
 * A working access token for the company's QuickBooks, refreshed and
 * saved first when it's about to run out. A login Intuit no longer
 * accepts is said on the settings page: only connecting again fixes it.
 */
export async function quickBooksAccess(
  admin: Admin,
  companyId: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ access: QbAccess } | { error: string }> {
  const creds = quickbooksCredentials();
  if (!creds) return { error: "QuickBooks isn't set up on the CRM yet." };
  const { data } = await admin
    .from("quickbooks_connections")
    .select("realm_id, environment, access_token_enc, refresh_token_enc, access_expires_at, disconnected_at")
    .eq("company_id", companyId)
    .maybeSingle<{
      realm_id: string | null;
      environment: string;
      access_token_enc: string | null;
      refresh_token_enc: string | null;
      access_expires_at: string | null;
      disconnected_at: string | null;
    }>();
  if (!data?.realm_id || data.disconnected_at) return { error: "Connect QuickBooks first." };
  // Connected while the CRM used Intuit's practice companies, or the
  // other way round: that login is for the other side.
  if (data.environment !== creds.environment) return { error: "QuickBooks needs you to connect again." };
  const apiBase = qbApiBase(creds.environment);

  const now = new Date();
  if (!needsRefresh(data.access_expires_at, now)) {
    const accessToken = decryptSecret(data.access_token_enc);
    if (accessToken) return { access: { realmId: data.realm_id, accessToken, apiBase } };
  }
  const refreshToken = decryptSecret(data.refresh_token_enc);
  if (!refreshToken) return { error: "QuickBooks needs you to connect again." };
  const fresh = await refreshQuickBooksTokens({ fetchImpl, creds, refreshToken, now });
  if ("error" in fresh) {
    if (fresh.reconnect) {
      await admin
        .from("quickbooks_connections")
        .update({ last_error: fresh.error, updated_at: now.toISOString() })
        .eq("company_id", companyId);
    }
    return { error: fresh.error };
  }
  const accessEnc = encryptSecret(fresh.tokens.accessToken);
  const refreshEnc = encryptSecret(fresh.tokens.refreshToken);
  if (!accessEnc || !refreshEnc) return { error: "The CRM's encryption key isn't set, so it can't keep a QuickBooks login." };
  await admin
    .from("quickbooks_connections")
    .update({
      access_token_enc: accessEnc,
      refresh_token_enc: refreshEnc,
      access_expires_at: fresh.tokens.accessExpiresAt,
      refresh_expires_at: fresh.tokens.refreshExpiresAt,
      last_error: null,
      updated_at: now.toISOString(),
    })
    .eq("company_id", companyId);
  return { access: { realmId: data.realm_id, accessToken: fresh.tokens.accessToken, apiBase } };
}

/** A read from the company's QuickBooks. */
async function qbGet(access: QbAccess, path: string, fetchImpl: typeof fetch): Promise<{ json: unknown } | { error: string }> {
  const url = `${access.apiBase}/v3/company/${encodeURIComponent(access.realmId)}/${path}${path.includes("?") ? "&" : "?"}minorversion=${QB_MINOR_VERSION}`;
  try {
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${access.accessToken}`, Accept: "application/json" } });
    if (res.status === 401) return { error: "QuickBooks needs you to connect again." };
    if (!res.ok) return { error: `QuickBooks didn't answer properly (${res.status}). Try again in a minute.` };
    return { json: await res.json() };
  } catch {
    return { error: "QuickBooks couldn't be reached. Try again in a minute." };
  }
}

/** The company's active QuickBooks accounts. */
export async function readQbAccounts(access: QbAccess, fetchImpl: typeof fetch = fetch): Promise<{ accounts: QbAccount[] } | { error: string }> {
  const query = encodeURIComponent("select * from Account where Active = true maxresults 1000");
  const res = await qbGet(access, `query?query=${query}`, fetchImpl);
  return "error" in res ? res : { accounts: parseQbAccounts(res.json) };
}

/** The QuickBooks company's name, or null. */
export async function readQbCompanyName(access: QbAccess, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const res = await qbGet(access, `companyinfo/${encodeURIComponent(access.realmId)}`, fetchImpl);
  if ("error" in res) return null;
  const name = (res.json as { CompanyInfo?: { CompanyName?: unknown } } | null)?.CompanyInfo?.CompanyName;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

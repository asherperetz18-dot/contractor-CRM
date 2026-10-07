/**
 * Signing in to QuickBooks Online (DECISIONS #171). AI Build Pros has one
 * Intuit app; each company signs in with its own QuickBooks login and
 * picks its company, and Intuit hands back tokens for that company only.
 * The CRM never sees the QuickBooks password.
 *
 * Pure, with `fetch` passed in, so the token calls are tested without
 * the network. The tokens themselves are stored encrypted by the caller.
 */

export const QB_AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
export const QB_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
export const QB_REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
/** Read and write the company's books. Step 1 only reads. */
export const QB_SCOPE = "com.intuit.quickbooks.accounting";
/** The API version every request asks for. */
export const QB_MINOR_VERSION = 75;

export type QbEnvironment = "sandbox" | "production";
export type QbCredentials = { clientId: string; clientSecret: string; environment: QbEnvironment };

/** The CRM's Intuit app, from the environment; null until it's set up.
 *  Sandbox (Intuit's practice companies) until it says production. */
export function quickbooksCredentials(env: Record<string, string | undefined> = process.env): QbCredentials | null {
  const clientId = env.QUICKBOOKS_CLIENT_ID?.trim();
  const clientSecret = env.QUICKBOOKS_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, environment: env.QUICKBOOKS_ENVIRONMENT?.trim() === "production" ? "production" : "sandbox" };
}

export function qbApiBase(environment: QbEnvironment): string {
  return environment === "production" ? "https://quickbooks.api.intuit.com" : "https://sandbox-quickbooks.api.intuit.com";
}

export function quickbooksAuthorizeUrl(p: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL(QB_AUTHORIZE_URL);
  url.searchParams.set("client_id", p.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", QB_SCOPE);
  url.searchParams.set("redirect_uri", p.redirectUri);
  url.searchParams.set("state", p.state);
  return url.toString();
}

export type QbTokens = {
  accessToken: string;
  refreshToken: string;
  /** When the access token runs out (about an hour). */
  accessExpiresAt: string;
  /** When the refresh token runs out (about 100 days, renewed on use). */
  refreshExpiresAt: string | null;
};

/** The tokens in Intuit's answer, or null when it isn't one. */
export function parseTokenResponse(json: unknown, now: Date): QbTokens | null {
  const t = json as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
    x_refresh_token_expires_in?: unknown;
  } | null;
  if (!t || typeof t.access_token !== "string" || typeof t.refresh_token !== "string") return null;
  const seconds = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
  const access = seconds(t.expires_in) ?? 3600;
  const refresh = seconds(t.x_refresh_token_expires_in);
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    accessExpiresAt: new Date(now.getTime() + access * 1000).toISOString(),
    refreshExpiresAt: refresh ? new Date(now.getTime() + refresh * 1000).toISOString() : null,
  };
}

const basicAuth = (c: QbCredentials) => `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}`;

async function tokenCall(
  fetchImpl: typeof fetch,
  creds: QbCredentials,
  body: Record<string, string>,
  now: Date
): Promise<{ tokens: QbTokens } | { error: string; reconnect: boolean }> {
  let res: Response;
  try {
    res = await fetchImpl(QB_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: basicAuth(creds),
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body).toString(),
    });
  } catch {
    return { error: "QuickBooks couldn't be reached. Try again in a minute.", reconnect: false };
  }
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) {
    // The login was withdrawn, expired or already used: only signing in
    // again fixes it.
    const reconnect = res.status === 400 && (json?.error === "invalid_grant" || json?.error === "invalid_client");
    return {
      error: reconnect
        ? "QuickBooks needs you to connect again."
        : `QuickBooks didn't answer properly (${res.status}). Try again in a minute.`,
      reconnect,
    };
  }
  const tokens = parseTokenResponse(json, now);
  return tokens ? { tokens } : { error: "QuickBooks didn't send a login back. Try connecting again.", reconnect: true };
}

/** Trades the code from Intuit's sign-in for tokens. */
export function exchangeQuickBooksCode(p: {
  fetchImpl: typeof fetch;
  creds: QbCredentials;
  code: string;
  redirectUri: string;
  now: Date;
}) {
  return tokenCall(p.fetchImpl, p.creds, { grant_type: "authorization_code", code: p.code, redirect_uri: p.redirectUri }, p.now);
}

/** A fresh access token. Intuit may send a new refresh token too; the
 *  caller keeps whichever comes back. */
export function refreshQuickBooksTokens(p: { fetchImpl: typeof fetch; creds: QbCredentials; refreshToken: string; now: Date }) {
  return tokenCall(p.fetchImpl, p.creds, { grant_type: "refresh_token", refresh_token: p.refreshToken }, p.now);
}

/** Withdraws the CRM's access at Intuit. Best effort. */
export async function revokeQuickBooksToken(p: { fetchImpl: typeof fetch; creds: QbCredentials; token: string }): Promise<boolean> {
  try {
    const res = await p.fetchImpl(QB_REVOKE_URL, {
      method: "POST",
      headers: { Authorization: basicAuth(p.creds), Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ token: p.token }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Refresh within five minutes of running out, so a call never starts
 *  with a token about to die. */
export function needsRefresh(accessExpiresAt: string | null | undefined, now: Date): boolean {
  if (!accessExpiresAt) return true;
  return new Date(accessExpiresAt).getTime() - now.getTime() < 5 * 60 * 1000;
}

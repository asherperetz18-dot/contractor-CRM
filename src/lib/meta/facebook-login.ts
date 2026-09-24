import crypto from "node:crypto";

/**
 * The pure half of "Connect with Facebook" on Settings -> Facebook Lead
 * Ads: which app the deployment signs in with, the sign-in URL, the
 * Pages a sign-in offers, and which secret a lead webhook must be
 * signed with. The Graph calls live in `graph.ts`; see DECISIONS #080.
 */

export const GRAPH_VERSION = "v21.0";

/**
 * pages_show_list + business_management list the Pages the person runs,
 * including ones owned by a Business Manager; pages_manage_metadata
 * subscribes the Page to the CRM's webhook; leads_retrieval,
 * pages_read_engagement and pages_manage_ads read each lead's answers.
 */
export const META_LOGIN_SCOPES = [
  "pages_show_list",
  "business_management",
  "pages_manage_metadata",
  "pages_read_engagement",
  "pages_manage_ads",
  "leads_retrieval",
];

export type MetaLoginCredentials = { appId: string; appSecret: string; configId: string | null };

/** The CRM's own Meta app, from the deployment's environment; null until both are set. */
export function metaLoginCredentials(
  env: Record<string, string | undefined> = process.env
): MetaLoginCredentials | null {
  const appId = env.META_APP_ID;
  const appSecret = env.META_APP_SECRET;
  if (!appId || !appSecret) return null;
  return { appId, appSecret, configId: env.META_LOGIN_CONFIG_ID || null };
}

/**
 * A "Facebook Login for Business" configuration, when the app has one,
 * carries its own permission list, and Meta wants config_id instead of
 * scope for it.
 */
export function metaAuthorizeUrl(opts: {
  appId: string;
  configId: string | null;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", opts.appId);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("state", opts.state);
  url.searchParams.set("response_type", "code");
  if (opts.configId) url.searchParams.set("config_id", opts.configId);
  else url.searchParams.set("scope", META_LOGIN_SCOPES.join(","));
  return url.toString();
}

export type MetaPage = { id: string; name: string; accessToken: string };

/** `GET /me/accounts` -> the Pages that came with a token, by name. */
export function pagesFromAccounts(json: unknown): MetaPage[] {
  const data = (json as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  const pages: MetaPage[] = [];
  for (const row of data as Array<Record<string, unknown>>) {
    if (row?.id == null || !row.access_token) continue;
    const id = String(row.id);
    pages.push({ id, name: row.name ? String(row.name) : `Page ${id}`, accessToken: String(row.access_token) });
  }
  return pages.sort((a, b) => a.name.localeCompare(b.name));
}

/** The sign-in cookie waiting on a Page pick (see PICK_COOKIE in connect.ts). */
export type PendingSignIn = { companyId: string; userToken: string };

export function parsePendingSignIn(raw: string | undefined): PendingSignIn | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { company_id?: string; token?: string };
    return v.company_id && v.token ? { companyId: v.company_id, userToken: v.token } : null;
  } catch {
    return null;
  }
}

/** A read or save that failed because migration 0178's columns aren't there yet. */
export function isMetaMigrationMissing(message: string): boolean {
  return /meta_(page_name|connected_via|connected_at)|schema cache/i.test(message);
}

export type WebhookSignatureCheck = { kind: "verify"; secret: string } | { kind: "skip" } | { kind: "reject" };

/**
 * Meta signs every webhook with the secret of the app the Page is
 * subscribed to. A Page connected with Facebook is subscribed to the
 * CRM's app, so it is checked with the deployment's secret -- and when
 * that is missing the call is refused rather than trusted. A manually
 * set-up Page uses the company's own app: its secret when stored, and
 * no check without one, as it always has.
 */
export function webhookSignatureCheck(
  config: { meta_connected_via: string | null; meta_app_secret: string | null },
  platformAppSecret: string | undefined
): WebhookSignatureCheck {
  if (config.meta_connected_via === "facebook_login") {
    return platformAppSecret ? { kind: "verify", secret: platformAppSecret } : { kind: "reject" };
  }
  return config.meta_app_secret ? { kind: "verify", secret: config.meta_app_secret } : { kind: "skip" };
}

export function verifyMetaSignature(rawBody: string, signatureHeader: string | null, appSecret: string) {
  if (!signatureHeader) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

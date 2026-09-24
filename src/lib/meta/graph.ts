import "server-only";
import { GRAPH_VERSION, pagesFromAccounts, type MetaLoginCredentials, type MetaPage } from "./facebook-login";

/**
 * The Graph API calls behind "Connect with Facebook". Raw fetch, like
 * the Google integrations: five endpoints don't earn an SDK. Each
 * returns null / false on a refusal rather than throwing, so a sign-in
 * that fails lands back on the settings page with a sentence, not a 500.
 */

const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

async function graphJson(url: string, init?: RequestInit): Promise<{ ok: boolean; json: Record<string, unknown> }> {
  try {
    const res = await fetch(url, init);
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, json };
  } catch {
    return { ok: false, json: {} };
  }
}

function graphError(json: Record<string, unknown>): string | null {
  const err = json.error as { message?: string } | undefined;
  return err?.message ?? null;
}

/**
 * The sign-in's code -> a long-lived user token (about 60 days). Page
 * tokens read with a long-lived user token don't expire on a timer,
 * which is why the exchange matters: the Page token is what the webhook
 * keeps using for as long as the Page stays connected.
 */
export async function userTokenFromCode(
  creds: MetaLoginCredentials,
  code: string,
  redirectUri: string
): Promise<string | null> {
  const shortUrl = new URL(`${GRAPH}/oauth/access_token`);
  shortUrl.searchParams.set("client_id", creds.appId);
  shortUrl.searchParams.set("client_secret", creds.appSecret);
  shortUrl.searchParams.set("redirect_uri", redirectUri);
  shortUrl.searchParams.set("code", code);
  const short = await graphJson(shortUrl.toString());
  const shortToken = short.ok ? (short.json.access_token as string | undefined) : undefined;
  if (!shortToken) return null;

  const longUrl = new URL(`${GRAPH}/oauth/access_token`);
  longUrl.searchParams.set("grant_type", "fb_exchange_token");
  longUrl.searchParams.set("client_id", creds.appId);
  longUrl.searchParams.set("client_secret", creds.appSecret);
  longUrl.searchParams.set("fb_exchange_token", shortToken);
  const long = await graphJson(longUrl.toString());
  return (long.ok ? (long.json.access_token as string | undefined) : undefined) ?? shortToken;
}

/** The Pages the signed-in person manages, each with its own token. Null when Facebook refuses. */
export async function listPages(userToken: string): Promise<MetaPage[] | null> {
  const url = new URL(`${GRAPH}/me/accounts`);
  url.searchParams.set("fields", "id,name,access_token");
  url.searchParams.set("limit", "100");
  url.searchParams.set("access_token", userToken);
  const { ok, json } = await graphJson(url.toString());
  return ok ? pagesFromAccounts(json) : null;
}

/** Points the Page's new-lead events at the CRM's app, which is subscribed to /api/meta/leadgen. */
export async function subscribePageToLeads(page: MetaPage): Promise<string | null> {
  const url = new URL(`${GRAPH}/${page.id}/subscribed_apps`);
  url.searchParams.set("subscribed_fields", "leadgen");
  url.searchParams.set("access_token", page.accessToken);
  const { ok, json } = await graphJson(url.toString(), { method: "POST" });
  if (ok && json.success !== false) return null;
  return graphError(json) ?? "Facebook refused to send this Page's leads to the CRM.";
}

/** Best effort: a Page whose token already died has nothing left to unsubscribe. */
export async function unsubscribePage(pageId: string, pageToken: string): Promise<void> {
  const url = new URL(`${GRAPH}/${pageId}/subscribed_apps`);
  url.searchParams.set("access_token", pageToken);
  await graphJson(url.toString(), { method: "DELETE" });
}

export type PageHealth = { ok: true } | { ok: false; problem: string };

/**
 * Is the stored Page token still accepted, and (for a Facebook-connected
 * Page) is the Page still sending its leads to the CRM's app? The one
 * failure mode a pasted token never showed: leads that stop without a
 * word. A manually set-up Page (no appId) only has its token checked --
 * its token may not carry the permission to list subscriptions.
 */
export async function checkPageHealth(
  pageId: string,
  pageToken: string,
  appId: string | null
): Promise<PageHealth> {
  const url = new URL(appId ? `${GRAPH}/${pageId}/subscribed_apps` : `${GRAPH}/${pageId}`);
  if (!appId) url.searchParams.set("fields", "id");
  url.searchParams.set("access_token", pageToken);
  const { ok, json } = await graphJson(url.toString());
  if (!ok) {
    return {
      ok: false,
      problem: `Facebook no longer accepts this connection${graphError(json) ? ` (${graphError(json)})` : ""}. New leads won't arrive until it's reconnected.`,
    };
  }
  if (!appId) return { ok: true };
  const apps = (json.data as Array<{ id?: string; subscribed_fields?: string[] }> | undefined) ?? [];
  const ours = apps.find((a) => String(a.id) === appId);
  if (!ours || !(ours.subscribed_fields ?? []).includes("leadgen")) {
    return {
      ok: false,
      problem: "This Page is no longer sending its leads to the CRM. Reconnect to switch them back on.",
    };
  }
  return { ok: true };
}

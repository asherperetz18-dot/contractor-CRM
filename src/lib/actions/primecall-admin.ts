"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { getCompanyMembers } from "@/lib/data/company";
import { isAdminRole } from "@/lib/data/types";
import { decryptSecret, encryptionAvailable, encryptSecret } from "@/lib/crypto/secrets";
import { extensionRepMap, normalizeServer } from "@/lib/primecall";
import { domainPath, getPrimeCallForCompany, nsFetch } from "@/lib/primecall-company";
import { syncPrimeCall } from "@/lib/primecall-sync";

const APP_ORIGIN = "https://crm.aibuildpros.com";
const MIGRATION = "supabase/migrations/0177_primecall.sql";

export type PrimeCallStatus = {
  connected: boolean;
  server: string | null;
  domain: string | null;
  connectedAt: string | null;
  /** An event subscription exists, so calls arrive within seconds
   *  rather than on the 15-minute sweep. */
  liveFeed: boolean;
  encryptionReady: boolean;
  /** Migration 0177 hasn't been pasted yet -- named on the page. */
  migrationMissing: boolean;
};

export type PrimeCallExtension = {
  extension: string;
  name: string;
  email: string;
  /** The CRM person calls on this extension are credited to, or null. */
  crmUser: string | null;
};

type NsUser = {
  user?: string;
  "name-first-name"?: string;
  "name-last-name"?: string;
  "email-address"?: string;
};

async function requireAdmin() {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminRole(profile)) return null;
  return profile;
}

export async function getPrimeCallStatus(): Promise<PrimeCallStatus | null> {
  const profile = await requireAdmin();
  if (!profile) return null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("company_profile")
    .select("primecall_server, primecall_domain, primecall_subscription_id, primecall_connected_at")
    .eq("company_id", profile.company_id)
    .maybeSingle<{
      primecall_server: string | null;
      primecall_domain: string | null;
      primecall_subscription_id: string | null;
      primecall_connected_at: string | null;
    }>();

  return {
    connected: !!data?.primecall_server && !!data.primecall_domain,
    server: data?.primecall_server ?? null,
    domain: data?.primecall_domain ?? null,
    connectedAt: data?.primecall_connected_at ?? null,
    liveFeed: !!data?.primecall_subscription_id,
    encryptionReady: encryptionAvailable(),
    migrationMissing: !!error,
  };
}

/**
 * The event subscription that makes PrimeCall post each finished call
 * to our webhook. Returns its id, or null when the account doesn't
 * allow subscriptions -- the 15-minute sweep then carries everything.
 */
async function subscribe(
  creds: { server: string; apiKey: string },
  domain: string,
  postUrl: string
): Promise<string | null> {
  const res = await nsFetch(creds, `${domainPath(domain)}/subscriptions`, {
    method: "POST",
    body: { model: "cdr", "post-url": postUrl, domain, user: "*" },
  });
  if (res?.ok) {
    const body = (await res.json().catch(() => null)) as { id?: string } | null;
    if (body?.id) return body.id;
  }
  // 409: this exact subscription already exists (a reconnect) -- find it.
  const list = await nsFetch(creds, `${domainPath(domain)}/subscriptions`);
  if (!list?.ok) return null;
  const subs = (await list.json().catch(() => [])) as { id?: string; model?: string; "post-url"?: string }[];
  if (!Array.isArray(subs)) return null;
  return subs.find((s) => s.model === "cdr" && s["post-url"] === postUrl)?.id ?? null;
}

/**
 * Connects the company's PrimeCall account: checks the key against the
 * domain, subscribes to finished calls, stores everything encrypted.
 */
export async function connectPrimeCall(input: {
  server: string;
  domain: string;
  apiKey: string;
}): Promise<{ error?: string; liveFeed?: boolean }> {
  const profile = await requireAdmin();
  if (!profile) return { error: "Admins only." };
  if (!encryptionAvailable()) {
    return { error: "APP_ENCRYPTION_KEY is not configured, so keys can't be stored safely." };
  }

  const server = normalizeServer(input.server);
  if (!server) return { error: "Enter PrimeCall's server address, like portal.primecall.com." };
  const domain = input.domain.trim();
  if (!domain) return { error: "Enter your PrimeCall domain." };
  const apiKey = input.apiKey.trim();
  if (!apiKey) return { error: "Paste the PrimeCall API key." };

  const creds = { server, apiKey };
  const check = await nsFetch(creds, `${domainPath(domain)}/users?limit=1`);
  if (!check) return { error: `Couldn't reach ${server}. Check the server address.` };
  if (check.status === 401 || check.status === 403) {
    return { error: "PrimeCall rejected the API key for that domain." };
  }
  if (check.status === 404) return { error: `PrimeCall has no domain "${domain}".` };
  if (!check.ok) return { error: `PrimeCall answered ${check.status}.` };

  // Keep the webhook secret across reconnects, so the subscription
  // PrimeCall already has keeps pointing at a URL that works.
  const admin = createAdminClient();
  const { data: row, error: readError } = await admin
    .from("company_profile")
    .select("primecall_webhook_token_enc")
    .eq("company_id", profile.company_id)
    .maybeSingle<{ primecall_webhook_token_enc: string | null }>();
  if (readError) return { error: `Run ${MIGRATION} in the Supabase SQL editor first.` };
  const token = decryptSecret(row?.primecall_webhook_token_enc ?? null) || randomBytes(24).toString("hex");

  const postUrl = `${APP_ORIGIN}/api/primecall/webhook?c=${profile.company_id}&t=${token}`;
  const subscriptionId = await subscribe(creds, domain, postUrl);

  const { error } = await admin
    .from("company_profile")
    .update({
      primecall_server: server,
      primecall_domain: domain,
      primecall_api_key_enc: encryptSecret(apiKey),
      primecall_webhook_token_enc: encryptSecret(token),
      primecall_subscription_id: subscriptionId,
      primecall_connected_at: new Date().toISOString(),
    })
    .eq("company_id", profile.company_id);
  if (error) return { error: error.message };

  revalidatePath("/settings/primecall");
  return { liveFeed: !!subscriptionId };
}

/** PrimeCall's extensions and who in the CRM each one is credited to. */
export async function listPrimeCallExtensions(): Promise<{ error?: string; extensions?: PrimeCallExtension[] }> {
  const profile = await requireAdmin();
  if (!profile) return { error: "Admins only." };
  const creds = await getPrimeCallForCompany(profile.company_id);
  if (!creds) return { error: "PrimeCall is not connected." };

  const res = await nsFetch(creds, `${domainPath(creds.domain)}/users?limit=1000`);
  if (!res?.ok) return { error: "Couldn't load extensions from PrimeCall." };
  const users = (await res.json().catch(() => [])) as NsUser[];
  if (!Array.isArray(users)) return { extensions: [] };

  const members = await getCompanyMembers(profile.company_id);
  const reps = extensionRepMap(users, members);
  const nameById = new Map(members.map((m) => [m.id, m.name || m.email || "Unnamed"]));
  return {
    extensions: users
      .filter((u) => u.user)
      .map((u) => ({
        extension: String(u.user),
        name: [u["name-first-name"], u["name-last-name"]].filter(Boolean).join(" "),
        email: u["email-address"] ?? "",
        crmUser: nameById.get(reps.get(String(u.user)) ?? "") ?? null,
      }))
      .sort((a, b) => a.extension.localeCompare(b.extension, undefined, { numeric: true })),
  };
}

/** The "pull the last 24 hours now" button. */
export async function runPrimeCallSync(): Promise<{ error?: string; processed?: number; created?: number }> {
  const profile = await requireAdmin();
  if (!profile) return { error: "Admins only." };
  const result = await syncPrimeCall(profile.company_id, 24 * 60);
  if (result.error) return { error: result.error };
  revalidatePath("/call-reports");
  return { processed: result.processed, created: result.created };
}

export async function disconnectPrimeCall(): Promise<{ error?: string }> {
  const profile = await requireAdmin();
  if (!profile) return { error: "Admins only." };

  // Best effort: a subscription left behind only posts to a URL that
  // now answers 401.
  const creds = await getPrimeCallForCompany(profile.company_id);
  if (creds?.subscriptionId) {
    await nsFetch(creds, `${domainPath(creds.domain)}/subscriptions/${encodeURIComponent(creds.subscriptionId)}`, {
      method: "DELETE",
    });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("company_profile")
    .update({
      primecall_server: null,
      primecall_domain: null,
      primecall_api_key_enc: null,
      primecall_webhook_token_enc: null,
      primecall_subscription_id: null,
      primecall_connected_at: null,
    })
    .eq("company_id", profile.company_id);
  if (error) return { error: error.message };

  revalidatePath("/settings/primecall");
  return {};
}

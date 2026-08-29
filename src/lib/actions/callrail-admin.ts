"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole } from "@/lib/data/types";
import { decryptSecret, encryptionAvailable, encryptSecret } from "@/lib/crypto/secrets";
import { CALLRAIL_API_BASE, callrailAuthHeader, parseStoredList } from "@/lib/callrail-company";
import { backfillCallRail } from "@/lib/callrail-sync";

const APP_ORIGIN = "https://crm.aibuildpros.com";

export type CallRailStatus = {
  connected: boolean;
  accountId: string | null;
  /** The CallRail companies feeding this CRM company. */
  companyNames: string[];
  connectedAt: string | null;
  encryptionReady: boolean;
};

export type CallRailCompanyOption = { id: string; name: string };

async function requireAdmin() {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminRole(profile)) return null;
  return profile;
}

async function storedCreds(companyId: string): Promise<{ apiKey: string; accountId: string } | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("company_profile")
    .select("callrail_account_id, callrail_api_key_enc")
    .eq("company_id", companyId)
    .maybeSingle<{ callrail_account_id: string | null; callrail_api_key_enc: string | null }>();
  const apiKey = decryptSecret(data?.callrail_api_key_enc ?? null);
  if (!apiKey || !data?.callrail_account_id) return null;
  return { apiKey, accountId: data.callrail_account_id };
}

export async function getCallRailStatus(): Promise<CallRailStatus | null> {
  const profile = await requireAdmin();
  if (!profile) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("company_profile")
    .select("callrail_account_id, callrail_company_id, callrail_company_name, callrail_connected_at")
    .eq("company_id", profile.company_id)
    .maybeSingle<{
      callrail_account_id: string | null;
      callrail_company_id: string | null;
      callrail_company_name: string | null;
      callrail_connected_at: string | null;
    }>();

  return {
    connected: !!data?.callrail_account_id && parseStoredList(data?.callrail_company_id ?? null).length > 0,
    accountId: data?.callrail_account_id ?? null,
    companyNames: parseStoredList(data?.callrail_company_name ?? null),
    connectedAt: data?.callrail_connected_at ?? null,
    encryptionReady: encryptionAvailable(),
  };
}

/**
 * The companies inside a CallRail account, so the admin can choose
 * which ones feed this CRM. One CallRail account routinely tracks
 * several brands, and guessing (the first version took companies[0])
 * connected L.A Home's CRM to a sibling brand's phone traffic.
 *
 * With no key passed, the stored one is used -- so an already-connected
 * company can re-open the picker without re-pasting anything.
 */
export async function listCallRailCompanies(input?: {
  apiKey?: string;
  accountId?: string;
}): Promise<{ error?: string; accountId?: string; companies?: CallRailCompanyOption[] }> {
  const profile = await requireAdmin();
  if (!profile) return { error: "Admins only." };

  let apiKey = input?.apiKey?.trim() || "";
  let accountId = (input?.accountId ?? "").trim().replace(/\D/g, "");
  if (!apiKey) {
    const stored = await storedCreds(profile.company_id);
    if (!stored) return { error: "Paste the CallRail API key." };
    apiKey = stored.apiKey;
    accountId = accountId || stored.accountId;
  }
  if (!accountId) {
    return { error: "Enter the account id — the 9-digit number after /a/ in your CallRail dashboard URL." };
  }

  const res = await fetch(
    `${CALLRAIL_API_BASE}/a/${encodeURIComponent(accountId)}/companies.json?status=active&per_page=250`,
    { headers: callrailAuthHeader(apiKey) }
  ).catch(() => null);
  if (!res) return { error: "Couldn't reach CallRail. Try again." };
  if (res.status === 401 || res.status === 403) {
    return { error: "CallRail rejected the API key. Check the key and the account id." };
  }
  if (!res.ok) return { error: `CallRail answered ${res.status}. Check the account id.` };
  const body = (await res.json()) as { companies?: { id: string; name?: string }[] };
  const companies = (body.companies ?? []).map((c) => ({ id: c.id, name: c.name ?? c.id }));
  if (!companies.length) return { error: "No active companies found in that CallRail account." };
  return { accountId, companies };
}

/**
 * Registers (or updates) the webhook integration on ONE CallRail
 * company and returns its signing key.
 */
async function registerWebhooks(
  apiKey: string,
  accountId: string,
  crCompanyId: string,
  crmCompanyId: string
): Promise<string | null> {
  const hook = (kind: string) =>
    `${APP_ORIGIN}/api/callrail/webhook?c=${crmCompanyId}&kind=${kind}`;
  const config = {
    post_call_webhook: [hook("call")],
    form_captured_webhook: [hook("form")],
    sms_received_webhook: [hook("sms")],
  };

  const createRes = await fetch(
    `${CALLRAIL_API_BASE}/a/${encodeURIComponent(accountId)}/integrations.json`,
    {
      method: "POST",
      headers: { ...callrailAuthHeader(apiKey), "Content-Type": "application/json" },
      body: JSON.stringify({ type: "Webhooks", company_id: crCompanyId, config }),
    }
  ).catch(() => null);
  if (createRes?.ok) {
    const created = (await createRes.json()) as { signing_key?: string };
    if (created.signing_key) return created.signing_key;
  }

  // Probably already integrated -- find it, update its URLs, read its key.
  const listRes = await fetch(
    `${CALLRAIL_API_BASE}/a/${encodeURIComponent(accountId)}/integrations.json?company_id=${encodeURIComponent(crCompanyId)}&fields=signing_key`,
    { headers: callrailAuthHeader(apiKey) }
  ).catch(() => null);
  if (!listRes?.ok) return null;
  const list = (await listRes.json()) as {
    integrations?: { id: string | number; type?: string; signing_key?: string }[];
  };
  const existing = list.integrations?.find((i) => i.type === "Webhooks");
  if (!existing?.signing_key) return null;
  await fetch(
    `${CALLRAIL_API_BASE}/a/${encodeURIComponent(accountId)}/integrations/${existing.id}.json`,
    {
      method: "PUT",
      headers: { ...callrailAuthHeader(apiKey), "Content-Type": "application/json" },
      body: JSON.stringify({ config }),
    }
  ).catch(() => null);
  return existing.signing_key;
}

/**
 * Connects the chosen CallRail companies: webhooks registered on each,
 * every signing key stored, calls flowing. With no key passed, the
 * stored one is reused (changing the selection after connecting).
 */
export async function saveCompanyCallRail(input: {
  apiKey?: string;
  accountId: string;
  companies: CallRailCompanyOption[];
}): Promise<{ error?: string; ok?: boolean }> {
  const profile = await requireAdmin();
  if (!profile) return { error: "Admins only." };
  if (!encryptionAvailable()) {
    return { error: "APP_ENCRYPTION_KEY is not configured, so keys can't be stored safely." };
  }

  let apiKey = input.apiKey?.trim() || "";
  const accountId = input.accountId.trim().replace(/\D/g, "");
  if (!apiKey) {
    const stored = await storedCreds(profile.company_id);
    if (!stored) return { error: "Paste the CallRail API key." };
    apiKey = stored.apiKey;
  }
  if (!accountId) return { error: "Missing account id." };
  const chosen = input.companies.filter((c) => c.id);
  if (!chosen.length) return { error: "Pick at least one CallRail company." };

  const signingKeys: string[] = [];
  const connectedNames: string[] = [];
  for (const c of chosen) {
    const key = await registerWebhooks(apiKey, accountId, c.id, profile.company_id);
    if (!key) {
      return {
        error: `Couldn't set up the webhook for "${c.name}". Check that the API key allows writes, then try again.`,
      };
    }
    signingKeys.push(key);
    connectedNames.push(c.name);
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("company_profile")
    .update({
      callrail_account_id: accountId,
      callrail_company_id: JSON.stringify(chosen.map((c) => c.id)),
      callrail_company_name: JSON.stringify(connectedNames),
      callrail_api_key_enc: encryptSecret(apiKey),
      callrail_signing_key_enc: encryptSecret(JSON.stringify(signingKeys)),
      callrail_connected_at: new Date().toISOString(),
    })
    .eq("company_id", profile.company_id);
  if (error) return { error: error.message };

  revalidatePath("/settings/callrail");
  return { ok: true };
}

export async function disconnectCallRail(): Promise<{ error?: string }> {
  const profile = await requireAdmin();
  if (!profile) return { error: "Admins only." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("company_profile")
    .update({
      callrail_account_id: null,
      callrail_company_id: null,
      callrail_company_name: null,
      callrail_api_key_enc: null,
      callrail_signing_key_enc: null,
      callrail_connected_at: null,
    })
    .eq("company_id", profile.company_id);
  if (error) return { error: error.message };

  revalidatePath("/settings/callrail");
  return {};
}

/** The "pull recent calls now" button. */
export async function runCallRailBackfill(): Promise<{
  error?: string;
  processed?: number;
  created?: number;
}> {
  const profile = await requireAdmin();
  if (!profile) return { error: "Admins only." };
  const result = await backfillCallRail(profile.company_id, 3);
  if (result.error) return { error: result.error };
  revalidatePath("/call-reports");
  return { processed: result.processed, created: result.created };
}

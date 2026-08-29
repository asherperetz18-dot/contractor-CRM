"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole } from "@/lib/data/types";
import { encryptionAvailable, encryptSecret } from "@/lib/crypto/secrets";
import { CALLRAIL_API_BASE, callrailAuthHeader } from "@/lib/callrail-company";
import { backfillCallRail } from "@/lib/callrail-sync";

const APP_ORIGIN = "https://crm.aibuildpros.com";

export type CallRailStatus = {
  connected: boolean;
  accountId: string | null;
  callrailCompanyName: string | null;
  connectedAt: string | null;
  encryptionReady: boolean;
};

async function requireAdmin() {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminRole(profile)) return null;
  return profile;
}

export async function getCallRailStatus(): Promise<CallRailStatus | null> {
  const profile = await requireAdmin();
  if (!profile) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("company_profile")
    .select("callrail_account_id, callrail_company_id, callrail_connected_at, callrail_company_name")
    .eq("company_id", profile.company_id)
    .maybeSingle<{
      callrail_account_id: string | null;
      callrail_company_id: string | null;
      callrail_connected_at: string | null;
      callrail_company_name?: string | null;
    }>();

  return {
    connected: !!data?.callrail_account_id && !!data?.callrail_company_id,
    accountId: data?.callrail_account_id ?? null,
    callrailCompanyName: data?.callrail_company_name ?? null,
    connectedAt: data?.callrail_connected_at ?? null,
    encryptionReady: encryptionAvailable(),
  };
}

/**
 * Connects a company's CallRail account, end to end in one save:
 * verifies the key against their API, finds the CallRail company,
 * registers the webhooks pointing back at this CRM, and stores the
 * signing key those webhooks are verified with. The admin pastes two
 * values and calls land in Call Reports -- no CallRail-side setup.
 */
export async function saveCompanyCallRail(input: {
  apiKey: string;
  accountId: string;
}): Promise<{ error?: string; ok?: boolean; companyName?: string }> {
  const profile = await requireAdmin();
  if (!profile) return { error: "Admins only." };
  if (!encryptionAvailable()) {
    return { error: "APP_ENCRYPTION_KEY is not configured, so keys can't be stored safely." };
  }

  const apiKey = input.apiKey.trim();
  const accountId = input.accountId.trim().replace(/\D/g, "");
  if (!apiKey) return { error: "Paste the CallRail API key." };
  if (!accountId) {
    return { error: "Enter the account id — the 9-digit number after /a/ in your CallRail dashboard URL." };
  }

  // 1. Prove the key works and find the CallRail company to track.
  const compRes = await fetch(
    `${CALLRAIL_API_BASE}/a/${encodeURIComponent(accountId)}/companies.json?status=active`,
    { headers: callrailAuthHeader(apiKey) }
  ).catch(() => null);
  if (!compRes) return { error: "Couldn't reach CallRail. Try again." };
  if (compRes.status === 401 || compRes.status === 403) {
    return { error: "CallRail rejected the API key. Check the key and the account id." };
  }
  if (!compRes.ok) return { error: `CallRail answered ${compRes.status}. Check the account id.` };
  const compBody = (await compRes.json()) as {
    companies?: { id: string; name?: string }[];
  };
  const company = compBody.companies?.[0];
  if (!company?.id) return { error: "No active company found in that CallRail account." };

  // 2. Register (or update) the webhook integration so calls, forms and
  // texts flow here. One Webhooks integration exists per CallRail
  // company, so an existing one is updated rather than duplicated.
  const hook = (kind: string) =>
    `${APP_ORIGIN}/api/callrail/webhook?c=${profile.company_id}&kind=${kind}`;
  const config = {
    post_call_webhook: [hook("call")],
    form_captured_webhook: [hook("form")],
    sms_received_webhook: [hook("sms")],
  };

  let signingKey: string | null = null;
  const createRes = await fetch(
    `${CALLRAIL_API_BASE}/a/${encodeURIComponent(accountId)}/integrations.json`,
    {
      method: "POST",
      headers: { ...callrailAuthHeader(apiKey), "Content-Type": "application/json" },
      body: JSON.stringify({ type: "Webhooks", company_id: company.id, config }),
    }
  ).catch(() => null);

  if (createRes?.ok) {
    const created = (await createRes.json()) as { signing_key?: string };
    signingKey = created.signing_key ?? null;
  } else {
    // Probably already integrated -- find it, update its URLs, read its key.
    const listRes = await fetch(
      `${CALLRAIL_API_BASE}/a/${encodeURIComponent(accountId)}/integrations.json?company_id=${encodeURIComponent(company.id)}&fields=signing_key`,
      { headers: callrailAuthHeader(apiKey) }
    ).catch(() => null);
    if (listRes?.ok) {
      const list = (await listRes.json()) as {
        integrations?: { id: string | number; type?: string; signing_key?: string }[];
      };
      const existing = list.integrations?.find((i) => i.type === "Webhooks");
      if (existing) {
        signingKey = existing.signing_key ?? null;
        await fetch(
          `${CALLRAIL_API_BASE}/a/${encodeURIComponent(accountId)}/integrations/${existing.id}.json`,
          {
            method: "PUT",
            headers: { ...callrailAuthHeader(apiKey), "Content-Type": "application/json" },
            body: JSON.stringify({ config }),
          }
        ).catch(() => null);
      }
    }
  }
  if (!signingKey) {
    return {
      error:
        "Connected to CallRail but couldn't set up the webhook. Check that the API key has manager access, then try again.",
    };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("company_profile")
    .update({
      callrail_account_id: accountId,
      callrail_company_id: company.id,
      callrail_company_name: company.name ?? null,
      callrail_api_key_enc: encryptSecret(apiKey),
      callrail_signing_key_enc: encryptSecret(signingKey),
      callrail_connected_at: new Date().toISOString(),
    })
    .eq("company_id", profile.company_id);
  if (error) return { error: error.message };

  revalidatePath("/settings/callrail");
  return { ok: true, companyName: company.name };
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

"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole } from "@/lib/data/types";
import { encryptionAvailable, encryptSecret } from "@/lib/crypto/secrets";
import { getEmailEnv } from "@/lib/email-env";

export type CompanyEmailStatus = {
  connected: boolean;
  fromAddress: string | null;
  fromName: string | null;
  hasOwnApiKey: boolean;
  connectedAt: string | null;
  encryptionReady: boolean;
  platformFallbackAvailable: boolean;
};

async function requireAdmin() {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminRole(profile)) return null;
  return profile;
}

export async function getCompanyEmailStatus(): Promise<CompanyEmailStatus | null> {
  const profile = await requireAdmin();
  if (!profile) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("company_profile")
    .select("email_from, email_from_name, resend_api_key_enc, email_connected_at")
    .eq("company_id", profile.company_id)
    .maybeSingle<{
      email_from: string | null;
      email_from_name: string | null;
      resend_api_key_enc: string | null;
      email_connected_at: string | null;
    }>();

  return {
    connected: !!data?.email_from,
    fromAddress: data?.email_from ?? null,
    fromName: data?.email_from_name ?? null,
    hasOwnApiKey: !!data?.resend_api_key_enc,
    connectedAt: data?.email_connected_at ?? null,
    encryptionReady: encryptionAvailable(),
    platformFallbackAvailable: !!getEmailEnv(),
  };
}

/**
 * Sets this company's own From address, and optionally its own Resend API
 * key for full independence from the platform's shared sender.
 *
 * The API key is optional -- Resend lets one account send from every
 * domain it has verified, so a company can use just its own address while
 * the platform key still does the sending (the platform operator verifies
 * that company's domain in the shared Resend account).
 */
export async function saveCompanyEmail(input: {
  fromAddress: string;
  fromName: string;
  apiKey?: string;
}): Promise<{ error?: string; ok?: boolean }> {
  const profile = await requireAdmin();
  if (!profile) return { error: "Admins only." };

  const fromAddress = input.fromAddress.trim();
  const fromName = input.fromName.trim();
  const apiKey = input.apiKey?.trim();

  if (!fromAddress || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromAddress)) {
    return { error: "Enter a valid email address." };
  }

  let secretEnc: string | null = null;
  if (apiKey) {
    if (!encryptionAvailable()) {
      return {
        error:
          "Credential encryption isn't configured on the server (APP_ENCRYPTION_KEY), so a Resend API key cannot be stored safely. Leave it blank to use the platform's key.",
      };
    }
    secretEnc = encryptSecret(apiKey);
    if (!secretEnc) return { error: "Could not encrypt the API key. Nothing was saved." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("company_profile")
    .update({
      email_from: fromAddress,
      email_from_name: fromName || null,
      resend_api_key_enc: secretEnc,
      email_connected_at: new Date().toISOString(),
    })
    .eq("company_id", profile.company_id)
    .select("company_id");
  if (error || !data?.length) return { error: error?.message || "Could not save." };

  revalidatePath("/settings");
  return { ok: true };
}

export async function clearCompanyEmail(): Promise<{ error?: string; ok?: boolean }> {
  const profile = await requireAdmin();
  if (!profile) return { error: "Admins only." };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("company_profile")
    .update({
      email_from: null,
      email_from_name: null,
      resend_api_key_enc: null,
      email_connected_at: null,
    })
    .eq("company_id", profile.company_id)
    .select("company_id");
  if (error || !data?.length) return { error: error?.message || "Could not disconnect." };

  revalidatePath("/settings");
  return { ok: true };
}

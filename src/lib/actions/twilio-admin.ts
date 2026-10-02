"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole, isPlatformAdmin, toE164 } from "@/lib/data/types";
import { encryptionAvailable, encryptSecret } from "@/lib/crypto/secrets";
import { portalBaseUrl } from "@/lib/portal/session";
import { getTwilioEnv, getTwilioVoiceEnv } from "@/lib/twilio-env";
import { loadAllCompanyTwilio, sharedTwilio } from "@/lib/twilio-company";
import { adoptSharedBlock, twilioSource, type TwilioSource } from "@/lib/twilio-source";

export type CompanyTwilioStatus = {
  connected: boolean;
  accountSid: string | null;
  phoneNumber: string | null;
  hasVoice: boolean;
  connectedAt: string | null;
  encryptionReady: boolean;
  smsWebhookUrl: string;
  voiceWebhookUrl: string;
  /** Its own account, or none: it can't text or call (lib/twilio-source.ts). */
  source: TwilioSource;
  /** Shown to a platform admin: the shared account can move in here. */
  canAdoptShared: boolean;
};

async function requireAdmin() {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminRole(profile)) return null;
  return profile;
}

export async function getCompanyTwilioStatus(): Promise<CompanyTwilioStatus | null> {
  const profile = await requireAdmin();
  if (!profile) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("company_profile")
    .select(
      "twilio_account_sid, twilio_auth_token_enc, twilio_phone_number, twilio_api_key_sid, twilio_twiml_app_sid, twilio_connected_at"
    )
    .eq("company_id", profile.company_id)
    .maybeSingle<{
      twilio_account_sid: string | null;
      twilio_auth_token_enc: string | null;
      twilio_phone_number: string | null;
      twilio_api_key_sid: string | null;
      twilio_twiml_app_sid: string | null;
      twilio_connected_at: string | null;
    }>();

  const base = portalBaseUrl();
  const connected = !!(data?.twilio_account_sid && data?.twilio_auth_token_enc && data?.twilio_phone_number);
  const source = twilioSource({
    company_id: profile.company_id,
    company_name: null,
    twilio_account_sid: data?.twilio_account_sid ?? null,
    twilio_phone_number: data?.twilio_phone_number ?? null,
    has_token: !!data?.twilio_auth_token_enc,
    has_voice: false,
  });
  const canAdoptShared =
    isPlatformAdmin(profile) &&
    source !== "own" &&
    adoptSharedBlock(profile.company_id, await loadAllCompanyTwilio(), sharedTwilio()) === null;
  return {
    source,
    canAdoptShared,
    connected,
    accountSid: data?.twilio_account_sid ?? null,
    phoneNumber: data?.twilio_phone_number ?? null,
    hasVoice: !!(data?.twilio_api_key_sid && data?.twilio_twiml_app_sid),
    connectedAt: data?.twilio_connected_at ?? null,
    encryptionReady: encryptionAvailable(),
    // Shared paths: inbound requests are routed by the number they came
    // in on, not by the URL, so every company uses the same endpoints.
    smsWebhookUrl: `${base}/api/sms/webhook`,
    voiceWebhookUrl: `${base}/api/voice/inbound`,
  };
}

/**
 * Connects this company's own Twilio account.
 *
 * The auth token and API secret are sealed the same way Stripe keys are;
 * the account SID, number and TwiML app id stay readable because they
 * are identifiers rather than secrets, and an admin needs to see which
 * number the company owns.
 */
export async function saveCompanyTwilio(input: {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
  apiKeySid?: string;
  apiKeySecret?: string;
  twimlAppSid?: string;
}): Promise<{ error?: string; ok?: boolean }> {
  const profile = await requireAdmin();
  if (!profile) return { error: "Admins only." };

  if (!encryptionAvailable()) {
    return {
      error:
        "Credential encryption isn't configured on the server (APP_ENCRYPTION_KEY), so the auth token cannot be stored safely.",
    };
  }

  const accountSid = input.accountSid.trim();
  const authToken = input.authToken.trim();
  const phoneNumber = toE164(input.phoneNumber.trim());

  if (!/^AC[0-9a-f]{32}$/i.test(accountSid)) {
    return { error: "That doesn't look like a Twilio Account SID (it starts with AC)." };
  }
  if (authToken.length < 20) return { error: "That auth token looks too short." };
  if (!phoneNumber) return { error: "Enter the Twilio number in a recognisable format." };

  // Inbound routing keys off the receiving number, so two companies
  // sharing one would make every reply ambiguous. A unique index also
  // enforces this, but a clear message beats a constraint violation.
  const admin = createAdminClient();
  const { data: clash } = await admin
    .from("company_profile")
    .select("company_id")
    .eq("twilio_phone_number", phoneNumber)
    .neq("company_id", profile.company_id)
    .maybeSingle();
  if (clash) return { error: "Another company on this platform already uses that number." };

  // Callbacks say which account they came from, not which company, so
  // two companies on one account could never be told apart. A Twilio
  // subaccount per company keeps them separate under one login.
  const { data: sidClash } = await admin
    .from("company_profile")
    .select("company_id")
    .eq("twilio_account_sid", accountSid)
    .neq("company_id", profile.company_id)
    .limit(1);
  if (sidClash?.length) {
    return {
      error:
        "Another company on this platform already uses this Twilio account. Each company needs its own — in Twilio, open Account → Subaccounts, create one for this company, and connect that one here.",
    };
  }

  const tokenEnc = encryptSecret(authToken);
  if (!tokenEnc) return { error: "Could not encrypt the auth token. Nothing was saved." };

  const apiKeySecret = input.apiKeySecret?.trim();
  const secretEnc = apiKeySecret ? encryptSecret(apiKeySecret) : null;

  const { data, error } = await admin
    .from("company_profile")
    .update({
      twilio_account_sid: accountSid,
      twilio_auth_token_enc: tokenEnc,
      twilio_phone_number: phoneNumber,
      twilio_api_key_sid: input.apiKeySid?.trim() || null,
      twilio_api_key_secret_enc: secretEnc,
      twilio_twiml_app_sid: input.twimlAppSid?.trim() || null,
      twilio_connected_at: new Date().toISOString(),
    })
    .eq("company_id", profile.company_id)
    .select("company_id");
  if (error || !data?.length) return { error: error?.message || "Could not save." };

  revalidatePath("/settings");
  return { ok: true };
}

export async function clearCompanyTwilio(): Promise<{ error?: string; ok?: boolean }> {
  const profile = await requireAdmin();
  if (!profile) return { error: "Admins only." };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("company_profile")
    .update({
      twilio_account_sid: null,
      twilio_auth_token_enc: null,
      twilio_phone_number: null,
      twilio_api_key_sid: null,
      twilio_api_key_secret_enc: null,
      twilio_twiml_app_sid: null,
      twilio_connected_at: null,
    })
    .eq("company_id", profile.company_id)
    .select("company_id");
  if (error || !data?.length) return { error: error?.message || "Could not disconnect." };

  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Moves the server's shared Twilio account (the TWILIO_* settings) into
 * this company's own settings -- run once, by a platform admin, inside
 * the company that account really belongs to (La Home Contractor).
 *
 * After it, that company texts and calls from its own row like any other
 * company, so the shared account can stop being lent to companies
 * without one and the owner loses nothing. The secrets are copied
 * server-side and sealed; they never pass through a browser. Refused
 * when this company already has its own account, or another company
 * already holds the shared account or its number (adoptSharedBlock).
 */
export async function adoptSharedTwilio(): Promise<{ error?: string; ok?: boolean }> {
  const profile = await requireAdmin();
  if (!profile || !isPlatformAdmin(profile)) return { error: "Only a Platform Admin can do this." };
  if (!encryptionAvailable()) {
    return { error: "Credential encryption isn't configured on the server (APP_ENCRYPTION_KEY)." };
  }

  const env = getTwilioEnv();
  const block = adoptSharedBlock(profile.company_id, await loadAllCompanyTwilio(), sharedTwilio());
  if (block || !env) return { error: block ?? "There's no shared Twilio account configured on this server." };

  const tokenEnc = encryptSecret(env.authToken);
  if (!tokenEnc) return { error: "Could not encrypt the auth token. Nothing was saved." };
  // In-app calling moves too when the server has it; otherwise this
  // company stays SMS-only, exactly as the shared account was.
  const voice = getTwilioVoiceEnv();
  const voiceSecretEnc = voice && voice.accountSid === env.accountSid ? encryptSecret(voice.apiKeySecret) : null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("company_profile")
    .update({
      twilio_account_sid: env.accountSid,
      twilio_auth_token_enc: tokenEnc,
      twilio_phone_number: toE164(env.phoneNumber) || env.phoneNumber,
      twilio_api_key_sid: voiceSecretEnc ? voice!.apiKeySid : null,
      twilio_api_key_secret_enc: voiceSecretEnc,
      twilio_twiml_app_sid: voiceSecretEnc ? voice!.twimlAppSid : null,
      twilio_connected_at: new Date().toISOString(),
    })
    .eq("company_id", profile.company_id)
    .select("company_id");
  if (error || !data?.length) return { error: error?.message || "Could not save." };

  revalidatePath("/settings");
  revalidatePath("/platform-admin");
  return { ok: true };
}

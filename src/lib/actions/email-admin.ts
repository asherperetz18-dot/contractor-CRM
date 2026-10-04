"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole } from "@/lib/data/types";
import { decryptSecret, encryptionAvailable, encryptSecret } from "@/lib/crypto/secrets";
import { escapeHtml, getEmailEnv, sendEmail } from "@/lib/email-env";
import { companyEmailPlan } from "@/lib/email-from";

export type CompanyEmailStatus = {
  /** Sending from its own address, through its own Resend account. */
  connected: boolean;
  fromAddress: string | null;
  fromName: string | null;
  hasOwnApiKey: boolean;
  /** An address saved before own accounts were required -- not used now. */
  addressWithoutAccount: boolean;
  /** The From customers see right now. */
  sendsAs: string | null;
  /** Where customers' replies land right now; null means nowhere useful. */
  replyTo: string | null;
  connectedAt: string | null;
  encryptionReady: boolean;
  platformFallbackAvailable: boolean;
};

async function requireAdmin() {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminRole(profile)) return null;
  return profile;
}

type SenderRow = {
  email_from: string | null;
  email_from_name: string | null;
  name: string | null;
  email: string | null;
  resend_api_key_enc: string | null;
  email_connected_at: string | null;
};

export async function getCompanyEmailStatus(): Promise<CompanyEmailStatus | null> {
  const profile = await requireAdmin();
  if (!profile) return null;

  const admin = createAdminClient();
  const [{ data }, { data: company }] = await Promise.all([
    admin
      .from("company_profile")
      .select("email_from, email_from_name, name, email, resend_api_key_enc, email_connected_at")
      .eq("company_id", profile.company_id)
      .maybeSingle<SenderRow>(),
    admin.from("companies").select("name").eq("id", profile.company_id).maybeSingle<{ name: string }>(),
  ]);

  const platform = getEmailEnv();
  const hasOwnApiKey = !!data?.resend_api_key_enc;
  const plan = companyEmailPlan(
    {
      email_from: data?.email_from ?? null,
      email_from_name: data?.email_from_name ?? null,
      name: data?.name ?? null,
      email: data?.email ?? null,
      company_name: company?.name ?? null,
    },
    hasOwnApiKey,
    platform?.from ?? null
  );

  return {
    connected: !!data?.email_from && hasOwnApiKey,
    fromAddress: data?.email_from ?? null,
    fromName: data?.email_from_name ?? null,
    hasOwnApiKey,
    addressWithoutAccount: !!data?.email_from && !hasOwnApiKey,
    sendsAs: plan?.from ?? null,
    replyTo: plan ? (plan.replyTo ?? (plan.key === "company" ? data?.email_from ?? null : null)) : null,
    connectedAt: data?.email_connected_at ?? null,
    encryptionReady: encryptionAvailable(),
    platformFallbackAvailable: !!platform,
  };
}

/**
 * Sets this company's own From address, sent through its own Resend
 * account (DECISIONS #110).
 *
 * Resend sends only from domains verified in the account doing the
 * sending, so the company's own account is the proof it controls the
 * domain. The shared account is never used for a company's own address:
 * it has other companies' domains verified, and lent out it let one
 * company send as another. Before anything is saved, a test email goes
 * to the admin from the new address -- if Resend refuses, nothing changes.
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

  if (!fromAddress || !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(fromAddress)) {
    return { error: "Enter a valid email address." };
  }
  const domain = fromAddress.split("@")[1].toLowerCase();
  if (domain === "resend.dev" || domain.endsWith(".resend.dev")) {
    return {
      error:
        "That's Resend's test address: it only ever reaches the Resend account's owner, never a customer. Use an address on your company's own domain.",
    };
  }

  const admin = createAdminClient();
  const { data: current } = await admin
    .from("company_profile")
    .select("resend_api_key_enc")
    .eq("company_id", profile.company_id)
    .maybeSingle<{ resend_api_key_enc: string | null }>();
  // Saving again without retyping the key keeps the one already stored.
  const storedKey = decryptSecret(current?.resend_api_key_enc ?? null);
  const key = apiKey || storedKey;
  if (!key) {
    return {
      error:
        "Sending from your own address needs your own Resend account: add its API key. Without one, emails go out from AI Build Pros under your company's name, and customers' replies go to your company email.",
    };
  }
  if (apiKey && !encryptionAvailable()) {
    return {
      error:
        "Credential encryption isn't configured on the server (APP_ENCRYPTION_KEY), so a Resend API key cannot be stored safely.",
    };
  }
  if (!profile.email) {
    return { error: "Your login has no email address to send the test email to." };
  }

  // The proof: Resend itself refuses a domain that isn't verified in the
  // account this key belongs to.
  const from = fromName ? `${fromName} <${fromAddress}>` : fromAddress;
  const safeFrom = escapeHtml(from);
  const test = await sendEmail(
    profile.email,
    "Your company email is connected",
    `<p>This is a test from your CRM. Emails to your customers will now come from <strong>${safeFrom}</strong>, and their replies come back to that address.</p><p>Nothing else to do.</p>`,
    `This is a test from your CRM. Emails to your customers will now come from ${from}, and their replies come back to that address.\n\nNothing else to do.`,
    { env: { apiKey: key, from } }
  );
  if (test.error) {
    return {
      error: `Resend wouldn't send from ${fromAddress}: ${test.error} In Resend, open Domains and verify ${domain} in the same account as this API key, then try again. Nothing was saved.`,
    };
  }

  const secretEnc = apiKey ? encryptSecret(apiKey) : current?.resend_api_key_enc ?? null;
  if (!secretEnc) return { error: "Could not encrypt the API key. Nothing was saved." };

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

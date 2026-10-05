"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentCompanyId, getCurrentProfile } from "@/lib/data/profile";
import {
  DEFAULT_DEPOSIT_CAP_CENTS,
  DEFAULT_DEPOSIT_PERCENT_BP,
  isAdminRole,
  toE164,
  type TimeFormat,
} from "@/lib/data/types";
import { depositRuleProblem, parseDepositRule } from "@/lib/deposit-rule";
import { readCompanyWords, storedWords, type CompanyWords, type WordKey } from "@/lib/company-words";
import { readRoleNames, storedRoleNames, type RoleNames } from "@/lib/role-names";
import { normalizeTaxId } from "@/lib/data/tax-id";
import { MAX_TAX_RATE_BP } from "@/lib/data/tax-rate";
import { revalidateCompanyChrome } from "@/lib/data/company-chrome";
import { saveMetaSecrets } from "@/lib/meta/page-secrets";

export type CompanyProfileInput = {
  name: string;
  dba: string;
  address: string;
  email: string;
  phone: string;
  website: string;
  facebook_url: string;
  instagram_url: string;
  call_forward_number: string;
  call_forward_timeout: number;
  new_lead_alert_phones: string;
  new_lead_alert_daily_cap: number;
  license_holder_name: string;
  license_number: string;
  license_state: string;
  license_type: string;
  /** Company tax id (EIN or similar); free text, blank clears it. */
  tax_id: string;
  /** Basis points (950 = 9.50%); the form converts from the percent typed. */
  tax_rate_bp: number;
  timezone: string;
  time_format: TimeFormat;
};

export async function saveCompanyProfile(input: CompanyProfileInput) {
  const companyId = await getCurrentCompanyId();
  if (!companyId) return { error: "Not signed in." };

  // Checked again here, not only on the form: this number lands on every
  // estimate written from now on, and a bad one is a wrong total on a
  // document the customer signs.
  const taxRateBp = Number(input.tax_rate_bp);
  if (!Number.isInteger(taxRateBp) || taxRateBp < 0 || taxRateBp > MAX_TAX_RATE_BP) {
    return { error: "Sales tax rate must be a number between 0 and 100, like 9.5." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("company_profile")
    .update({
      name: input.name || null,
      dba: input.dba || null,
      address: input.address || null,
      email: input.email || null,
      phone: input.phone || null,
      website: input.website || null,
      facebook_url: input.facebook_url || null,
      instagram_url: input.instagram_url || null,
      call_forward_number: input.call_forward_number || null,
      call_forward_timeout: input.call_forward_timeout,
      new_lead_alert_phones: input.new_lead_alert_phones || null,
      new_lead_alert_daily_cap: input.new_lead_alert_daily_cap,
      license_holder_name: input.license_holder_name || null,
      license_number: input.license_number || null,
      license_state: input.license_state || null,
      license_type: input.license_type || null,
      tax_id: normalizeTaxId(input.tax_id),
      tax_rate_bp: taxRateBp,
      timezone: input.timezone,
      time_format: input.time_format,
    })
    .eq("company_id", companyId);

  if (error) return { error: error.message };
  revalidatePath("/settings/company-profile");
  revalidateCompanyChrome(companyId);
  revalidatePath("/", "layout");
  return {};
}

export type SocialLinksInput = {
  facebook_url: string;
  instagram_url: string;
  linkedin_url: string;
  youtube_url: string;
  tiktok_url: string;
  yelp_url: string;
  google_reviews_url: string;
};

/**
 * Saves the social profiles on their own, so the Social Media Links
 * page doesn't have to round-trip the entire company profile to change
 * one URL. Facebook and Instagram are the same columns the Company
 * Profile page edits -- one source of truth, two doors to it.
 */
export async function saveSocialLinks(input: SocialLinksInput) {
  const companyId = await getCurrentCompanyId();
  if (!companyId) return { error: "Not signed in." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("company_profile")
    .update({
      facebook_url: input.facebook_url.trim() || null,
      instagram_url: input.instagram_url.trim() || null,
      linkedin_url: input.linkedin_url.trim() || null,
      youtube_url: input.youtube_url.trim() || null,
      tiktok_url: input.tiktok_url.trim() || null,
      yelp_url: input.yelp_url.trim() || null,
      google_reviews_url: input.google_reviews_url.trim() || null,
    })
    .eq("company_id", companyId);

  if (error) return { error: error.message };
  revalidatePath("/settings/social-media");
  revalidatePath("/settings/company-profile");
  return {};
}

/**
 * The conversation analyzer's settings. Same shape as the AI Estimator's:
 * an enable switch, a whitelisted model, and free-text prompt material.
 */
export async function saveAiAnalysisSettings(input: {
  enabled: boolean;
  model: string;
  positiveSignals: string;
  negativeSignals: string;
  callNotesEnabled: boolean;
}): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can change this." };

  const ALLOWED = ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"];
  const model = ALLOWED.includes(input.model) ? input.model : "claude-opus-5";

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_profile")
    .update({
      ai_analysis_enabled: input.enabled,
      ai_analysis_model: model,
      ai_analysis_positive_signals: input.positiveSignals.trim() || null,
      ai_analysis_negative_signals: input.negativeSignals.trim() || null,
      ai_call_notes_enabled: input.callNotesEnabled,
    })
    .eq("company_id", profile.company_id)
    .select("company_id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "That change couldn't be saved." };

  revalidatePath("/settings/ai-analysis");
  return {};
}

export async function saveAiReceptionistSettings(input: {
  enabled: boolean;
  greeting: string;
  timeoutSeconds: number;
  transferNumber: string;
}): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can change this." };

  const timeoutSeconds = Number(input.timeoutSeconds);
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 5 || timeoutSeconds > 60) {
    return { error: "Pickup time must be a whole number of seconds between 5 and 60." };
  }
  const transferTrimmed = input.transferNumber.trim();
  const transferNumber = transferTrimmed ? toE164(transferTrimmed) : "";
  if (transferTrimmed && !transferNumber) {
    return { error: "The transfer number doesn't look like a phone number — check the digits." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_profile")
    .update({
      ai_receptionist_enabled: input.enabled,
      ai_receptionist_greeting: input.greeting.trim().slice(0, 400) || null,
      call_forward_timeout: timeoutSeconds,
    })
    .eq("company_id", profile.company_id)
    .select("company_id");
  if (error) {
    // The columns arrive with migration 0160; saving before it has run
    // is the one predictable failure, so it gets plain words instead of
    // a Postgres message.
    if (/ai_receptionist/i.test(error.message)) {
      return {
        error:
          "Run supabase/migrations/0160_ai_receptionist.sql in the Supabase SQL editor first, then save again.",
      };
    }
    return { error: error.message };
  }
  if (!data?.length) return { error: "That change couldn't be saved." };

  // The transfer column is its own update on purpose: it arrives with
  // 0161, and a company that has run only 0160 should still be able to
  // save everything above without this column failing the whole write.
  const { error: transferError } = await supabase
    .from("company_profile")
    .update({ ai_receptionist_transfer_number: transferNumber || null })
    .eq("company_id", profile.company_id);
  if (transferError) {
    // Blank means "transfers off", which a missing column already is —
    // only a number the owner actually typed is worth an error.
    if (transferNumber) {
      if (/ai_receptionist_transfer_number/i.test(transferError.message)) {
        return {
          error:
            "Run supabase/migrations/0161_receptionist_transfer.sql in the Supabase SQL editor first, then save again — everything else on this page was saved.",
        };
      }
      return { error: transferError.message };
    }
  }

  revalidatePath("/settings/ai-receptionist");
  revalidatePath("/settings/company-profile");
  return {};
}

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

export async function uploadLogo(formData: FormData) {
  const companyId = await getCurrentCompanyId();
  if (!companyId) return { error: "Not signed in." };

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "No file provided." };
  if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
    return { error: "Please choose an image file (PNG, JPEG, WebP, or SVG)." };
  }
  if (file.size > MAX_LOGO_BYTES) {
    return { error: "Image is too large — please use one under 2MB." };
  }

  const admin = createAdminClient();
  const ext = file.name.split(".").pop() || "png";
  const path = `company/logo-${Date.now()}.${ext}`;

  const { error: uploadError } = await admin.storage
    .from("logos")
    .upload(path, file, { contentType: file.type, upsert: true });
  if (uploadError) return { error: uploadError.message };

  const {
    data: { publicUrl },
  } = admin.storage.from("logos").getPublicUrl(path);

  const supabase = await createClient();
  const { error } = await supabase
    .from("company_profile")
    .update({ logo_url: publicUrl })
    .eq("company_id", companyId);
  if (error) return { error: error.message };

  revalidateCompanyChrome(companyId);
  revalidatePath("/", "layout");
  return { url: publicUrl };
}

export async function removeLogo() {
  const companyId = await getCurrentCompanyId();
  if (!companyId) return { error: "Not signed in." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("company_profile")
    .update({ logo_url: null })
    .eq("company_id", companyId);
  if (error) return { error: error.message };

  revalidateCompanyChrome(companyId);
  revalidatePath("/", "layout");
  return {};
}

export async function regenerateWebhookSecret() {
  const companyId = await getCurrentCompanyId();
  if (!companyId) return { error: "Not signed in." };

  const supabase = await createClient();
  const secret = crypto.randomBytes(24).toString("hex");
  const { error } = await supabase
    .from("company_profile")
    .update({ webhook_secret: secret })
    .eq("company_id", companyId);
  if (error) return { error: error.message };
  revalidatePath("/settings/incoming-webhooks");
  return { secret };
}

export async function saveFollowUpSettings(input: {
  enabled: boolean;
  graceMinutes: number;
  lookbackHours: number;
}) {
  const companyId = await getCurrentCompanyId();
  if (!companyId) return { error: "Not signed in." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("company_profile")
    .update({
      no_show_followup_enabled: input.enabled,
      no_show_grace_minutes: Math.max(0, Math.round(input.graceMinutes)) || 60,
      no_show_lookback_hours: Math.max(1, Math.round(input.lookbackHours)) || 168,
    })
    .eq("company_id", companyId);
  if (error) return { error: error.message };
  revalidatePath("/settings/appointment-notifications");
  return {};
}

export async function saveRepInfoTemplate(body: string) {
  const companyId = await getCurrentCompanyId();
  if (!companyId) return { error: "Not signed in." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("company_profile")
    .update({ rep_appointment_info_template: body.trim() || null })
    .eq("company_id", companyId);
  if (error) return { error: error.message };
  revalidatePath("/settings/appointment-notifications");
  revalidatePath("/calendar");
  return {};
}

export async function saveCallScript(body: string) {
  const companyId = await getCurrentCompanyId();
  if (!companyId) return { error: "Not signed in." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("company_profile")
    .update({ call_script: body || null })
    .eq("company_id", companyId);
  if (error) return { error: error.message };
  revalidatePath("/settings/call-scripts");
  revalidatePath("/dial-queue");
  return {};
}

/** The deposit rule as Settings → Contracts shows it (DECISIONS #117). */
export type DepositRuleSettings = {
  percentBp: number;
  capCents: number;
  /** The company's licence state: California keeps its legal limit. */
  licenseState: string | null;
};

export async function getDepositRule(): Promise<DepositRuleSettings | null> {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminRole(profile)) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("company_profile")
    .select("deposit_percent_bp, deposit_cap_cents, license_state")
    .eq("company_id", profile.company_id)
    .maybeSingle<{ deposit_percent_bp: number | null; deposit_cap_cents: number | null; license_state: string | null }>();
  return {
    percentBp: data?.deposit_percent_bp ?? DEFAULT_DEPOSIT_PERCENT_BP,
    capCents: data?.deposit_cap_cents ?? DEFAULT_DEPOSIT_CAP_CENTS,
    licenseState: data?.license_state ?? null,
  };
}

/**
 * The deposit each new estimate asks for at signing. Estimates already
 * created keep the rule they were made with.
 */
export async function saveDepositRule(input: { percent: string; cap: string }): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can change this." };

  const parsed = parseDepositRule(input.percent, input.cap);
  if ("error" in parsed) return { error: parsed.error };

  const supabase = await createClient();
  const { data: company } = await supabase
    .from("company_profile")
    .select("license_state")
    .eq("company_id", profile.company_id)
    .maybeSingle<{ license_state: string | null }>();
  const problem = depositRuleProblem(parsed.rule, company?.license_state);
  if (problem) return { error: problem };

  const { data, error } = await supabase
    .from("company_profile")
    .update({ deposit_percent_bp: parsed.rule.percentBp, deposit_cap_cents: parsed.rule.capCents })
    .eq("company_id", profile.company_id)
    .select("company_id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "That change couldn't be saved." };

  revalidatePath("/settings/contracts");
  return {};
}

export type CompanyWordsSettings = {
  words: CompanyWords;
  /** For the page's example message. */
  companyName: string;
  /** False until migration 0196 has run: the page says so, and saving waits. */
  ready: boolean;
};

export async function getCompanyWordsSettings(): Promise<CompanyWordsSettings | null> {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminRole(profile)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_profile")
    .select("wording")
    .eq("company_id", profile.company_id)
    .maybeSingle<{ wording: unknown }>();
  const { data: named } = await supabase
    .from("company_profile")
    .select("name")
    .eq("company_id", profile.company_id)
    .maybeSingle<{ name: string | null }>();
  return {
    words: readCompanyWords(error ? null : data?.wording),
    companyName: named?.name || "Your company",
    ready: !error,
  };
}

/**
 * The company's own words (DECISIONS #121). Only words that differ from
 * the standard ones are stored; sending the standard word clears it.
 */
export async function saveCompanyWords(
  input: Partial<Record<WordKey, { one: string; many: string }>>
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can change this." };

  const parsed = storedWords(input);
  if ("error" in parsed) return { error: parsed.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_profile")
    .update({ wording: parsed.words })
    .eq("company_id", profile.company_id)
    .select("company_id");
  if (error) {
    if (/wording/.test(error.message)) {
      return { error: "Company words need a database update first: run 0196_company_wording.sql in Supabase." };
    }
    return { error: error.message };
  }
  if (!data?.length) return { error: "That change couldn't be saved." };

  // The menus read the words through the cached chrome (DECISIONS #125).
  revalidateCompanyChrome(profile.company_id);
  revalidatePath("/settings/company-words");
  return {};
}

export type RoleNamesSettings = {
  names: RoleNames;
  /** False until migration 0202 has run: the page says so, and saving waits. */
  ready: boolean;
};

export async function getRoleNamesSettings(): Promise<RoleNamesSettings | null> {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminRole(profile)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_profile")
    .select("role_names")
    .eq("company_id", profile.company_id)
    .maybeSingle<{ role_names: unknown }>();
  return { names: readRoleNames(error ? null : data?.role_names), ready: !error };
}

/**
 * What the company calls its team roles (DECISIONS #137). Display only:
 * every permission still uses the role itself. Only names that differ
 * from the standard ones are stored; a blank name clears it.
 */
export async function saveRoleNames(input: Partial<Record<string, string>>): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can change this." };

  const parsed = storedRoleNames(input);
  if ("error" in parsed) return { error: parsed.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_profile")
    .update({ role_names: parsed.names })
    .eq("company_id", profile.company_id)
    .select("company_id");
  if (error) {
    if (/role_names/.test(error.message)) {
      return { error: "Role names need a database update first: run 0202_company_role_names.sql in Supabase." };
    }
    return { error: error.message };
  }
  if (!data?.length) return { error: "That change couldn't be saved." };

  // Every screen that prints a role reads the names through the cached chrome.
  revalidateCompanyChrome(profile.company_id);
  revalidatePath("/settings/role-names");
  return {};
}

export type MetaConfigInput = {
  meta_page_id: string;
  meta_verify_token: string;
  /** A new Page token or app secret; blank keeps the saved one. */
  newPageToken: string;
  newAppSecret: string;
};

/**
 * The advanced Facebook setup (the company's own Meta app). Admin-only,
 * and the Page token and app secret are stored encrypted, never in plain
 * text where every member of the company could read them (DECISIONS #114).
 */
export async function saveMetaConfig(input: MetaConfigInput): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can change the Facebook setup." };

  const pageToken = input.newPageToken.trim();
  const appSecret = input.newAppSecret.trim();
  const { error } = await saveMetaSecrets(
    profile.company_id,
    { pageAccessToken: pageToken || undefined, appSecret: appSecret || undefined },
    { meta_page_id: input.meta_page_id.trim() || null, meta_verify_token: input.meta_verify_token.trim() || null }
  );
  if (error) {
    return {
      error: /company_profile_meta_page_id_key|duplicate key/i.test(error)
        ? "That Page is already connected to another company in the CRM. A Page can send its leads to one company only."
        : error,
    };
  }
  revalidatePath("/settings/facebook-lead-ads");
  return {};
}

/**
 * AI estimator configuration. Admin-gated, and the .select() row check
 * makes an RLS-blocked write surface as an error instead of a silent
 * success that changed nothing.
 */
export async function saveAiEstimatorSettings(input: {
  enabled: boolean;
  model: string;
  instructions: string | null;
  rateCard: string | null;
}): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can change this." };

  // The model is chosen from a fixed list in the UI; re-checked here so a
  // crafted request can't point the generator at an arbitrary string.
  const ALLOWED = ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"];
  const model = ALLOWED.includes(input.model) ? input.model : "claude-opus-5";

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_profile")
    .update({
      ai_estimator_enabled: input.enabled,
      ai_estimator_model: model,
      ai_estimator_instructions: input.instructions,
      ai_estimator_rate_card: input.rateCard,
    })
    .eq("company_id", profile.company_id)
    .select("company_id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "That change couldn't be saved." };

  revalidatePath("/settings/ai-estimator");
  return {};
}

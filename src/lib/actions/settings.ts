"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentCompanyId } from "@/lib/data/profile";
import type { TimeFormat } from "@/lib/data/types";

export type CompanyProfileInput = {
  name: string;
  address: string;
  email: string;
  phone: string;
  website: string;
  facebook_url: string;
  instagram_url: string;
  license_holder_name: string;
  license_number: string;
  license_state: string;
  license_type: string;
  timezone: string;
  time_format: TimeFormat;
};

export async function saveCompanyProfile(input: CompanyProfileInput) {
  const companyId = await getCurrentCompanyId();
  if (!companyId) return { error: "Not signed in." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("company_profile")
    .update({
      name: input.name || null,
      address: input.address || null,
      email: input.email || null,
      phone: input.phone || null,
      website: input.website || null,
      facebook_url: input.facebook_url || null,
      instagram_url: input.instagram_url || null,
      license_holder_name: input.license_holder_name || null,
      license_number: input.license_number || null,
      license_state: input.license_state || null,
      license_type: input.license_type || null,
      timezone: input.timezone,
      time_format: input.time_format,
    })
    .eq("company_id", companyId);

  if (error) return { error: error.message };
  revalidatePath("/settings/company-profile");
  revalidatePath("/", "layout");
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

export type MetaConfigInput = {
  meta_page_id: string;
  meta_page_access_token: string;
  meta_verify_token: string;
  meta_app_secret: string;
};

export async function saveMetaConfig(input: MetaConfigInput) {
  const companyId = await getCurrentCompanyId();
  if (!companyId) return { error: "Not signed in." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("company_profile")
    .update({
      meta_page_id: input.meta_page_id || null,
      meta_page_access_token: input.meta_page_access_token || null,
      meta_verify_token: input.meta_verify_token || null,
      meta_app_secret: input.meta_app_secret || null,
    })
    .eq("company_id", companyId);
  if (error) return { error: error.message };
  revalidatePath("/settings/facebook-lead-ads");
  return {};
}

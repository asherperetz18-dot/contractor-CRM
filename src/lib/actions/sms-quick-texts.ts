"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole } from "@/lib/data/types";
import type { SmsQuickText, SmsQuickTextKey } from "@/lib/data/types";

export async function getQuickTextOptions(): Promise<{
  companyName: string;
  quickTexts: SmsQuickText[];
  repInfoTemplate: string | null;
  website: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
}> {
  const profile = await getCurrentProfile();
  if (!profile) {
    return {
      companyName: "",
      quickTexts: [],
      repInfoTemplate: null,
      website: null,
      facebookUrl: null,
      instagramUrl: null,
    };
  }

  const supabase = await createClient();
  const [{ data: company }, { data: texts }] = await Promise.all([
    supabase
      .from("company_profile")
      .select("name, rep_appointment_info_template, website, facebook_url, instagram_url")
      .eq("company_id", profile.company_id)
      .single(),
    supabase.from("sms_quick_texts").select("*").eq("company_id", profile.company_id),
  ]);
  const companyRow = company as {
    name: string | null;
    rep_appointment_info_template: string | null;
    website: string | null;
    facebook_url: string | null;
    instagram_url: string | null;
  } | null;
  return {
    companyName: companyRow?.name ?? "",
    quickTexts: (texts as SmsQuickText[]) ?? [],
    repInfoTemplate: companyRow?.rep_appointment_info_template ?? null,
    website: companyRow?.website ?? null,
    facebookUrl: companyRow?.facebook_url ?? null,
    instagramUrl: companyRow?.instagram_url ?? null,
  };
}

export async function saveQuickText(
  key: SmsQuickTextKey,
  body: string
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can edit SMS quick-texts." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("sms_quick_texts")
    .update({ body: body.trim() || null })
    .eq("key", key)
    .eq("company_id", profile.company_id);
  if (error) return { error: error.message };

  revalidatePath("/settings/appointment-notifications");
  revalidatePath("/calendar");
  return {};
}

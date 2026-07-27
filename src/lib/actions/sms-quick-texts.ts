"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { SmsQuickText, SmsQuickTextKey } from "@/lib/data/types";

async function requireOfficeOrAdmin(): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { data: profile } = await supabase
    .from("profiles")
    .select("roles")
    .eq("id", user.id)
    .single();
  const roles = (profile as { roles: string[] } | null)?.roles ?? [];
  if (!roles.includes("Office") && !roles.includes("Admin")) {
    return { error: "Only Office or Admin users can edit SMS quick-texts." };
  }
  return {};
}

export async function getQuickTextOptions(): Promise<{
  companyName: string;
  quickTexts: SmsQuickText[];
}> {
  const supabase = await createClient();
  const [{ data: company }, { data: texts }] = await Promise.all([
    supabase.from("company_profile").select("name").eq("id", 1).single(),
    supabase.from("sms_quick_texts").select("*"),
  ]);
  return {
    companyName: (company as { name: string | null } | null)?.name ?? "",
    quickTexts: (texts as SmsQuickText[]) ?? [],
  };
}

export async function saveQuickText(
  key: SmsQuickTextKey,
  body: string
): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if (guard.error) return guard;

  const supabase = await createClient();
  const { error } = await supabase
    .from("sms_quick_texts")
    .update({ body: body.trim() || null })
    .eq("key", key);
  if (error) return { error: error.message };

  revalidatePath("/settings/appointment-notifications");
  revalidatePath("/calendar");
  return {};
}

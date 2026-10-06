"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole } from "@/lib/data/types";
import { isMissingSchemaError } from "@/lib/schema-drift";
import { financingSettingsError } from "@/lib/financing";

/**
 * The company's customer financing (DECISIONS #161): the lender it uses
 * and the application link that lender gave it. Office or Admin set it,
 * like the rest of the company's settings.
 */

const NEEDS_0214 = "Financing needs a database update first: run 0214_customer_financing.sql in Supabase.";

export type FinancingSettings = { provider: string; url: string; ready: boolean };

export async function getFinancingSettings(): Promise<FinancingSettings | null> {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminRole(profile)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_profile")
    .select("financing_provider, financing_url")
    .eq("company_id", profile.company_id)
    .maybeSingle<{ financing_provider: string | null; financing_url: string | null }>();
  return {
    provider: data?.financing_provider ?? "",
    url: data?.financing_url ?? "",
    ready: !error,
  };
}

export async function saveFinancingSettings(input: { provider: string; url: string }): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can change this." };
  const why = financingSettingsError(input);
  if (why) return { error: why };
  const provider = input.provider.trim();
  const url = input.url.trim();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_profile")
    .update({ financing_provider: provider || null, financing_url: url || null })
    .eq("company_id", profile.company_id)
    .select("company_id");
  if (error) return { error: isMissingSchemaError(error) ? NEEDS_0214 : error.message };
  if (!data?.length) return { error: "That change couldn't be saved." };

  revalidatePath("/settings/customer-financing");
  return {};
}

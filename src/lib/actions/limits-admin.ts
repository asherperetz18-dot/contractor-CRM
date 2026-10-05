"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/data/profile";
import { isPlatformAdmin } from "@/lib/data/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingSchemaError } from "@/lib/schema-drift";
import { logInfo } from "@/lib/observability/logger";
import { dropCompanyLimitsCache } from "@/lib/usage/company-limits";
import { parseLimitInput } from "@/lib/usage/limits";

/**
 * Sets a company's monthly limits (DECISIONS #133) from Platform Admin ›
 * Companies. Blank means no limit. Platform admins only, checked here and
 * not just on the page: a server action is a real endpoint. The company
 * comes from the admin's click, which is why company_limits is written
 * with the service-role client only after that check.
 */
export async function setCompanyLimits(
  companyId: string,
  input: { ai: string; sms: string; email: string }
): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isPlatformAdmin(profile)) return { error: "Only a Platform Admin can do this." };

  const ai = parseLimitInput(input.ai);
  const sms = parseLimitInput(input.sms);
  const email = parseLimitInput(input.email);
  for (const [label, parsed] of [["AI answers", ai], ["Texts", sms], ["Emails", email]] as const) {
    if (parsed.error) return { error: `${label}: ${parsed.error}` };
  }

  const { error } = await createAdminClient().from("company_limits").upsert({
    company_id: companyId,
    ai_requests_per_month: ai.value ?? null,
    sms_per_month: sms.value ?? null,
    emails_per_month: email.value ?? null,
    updated_at: new Date().toISOString(),
    updated_by: profile.id,
  });
  if (error) {
    return {
      error: isMissingSchemaError(error)
        ? "Limits need their database step first: run supabase/migrations/0200_company_limits.sql."
        : error.message,
    };
  }

  dropCompanyLimitsCache(companyId);
  logInfo({
    event: "usage.limits_set",
    companyId,
    actorId: profile.id,
    ai: ai.value ?? null,
    sms: sms.value ?? null,
    email: email.value ?? null,
  });
  revalidatePath("/platform-admin/companies");
  return {};
}

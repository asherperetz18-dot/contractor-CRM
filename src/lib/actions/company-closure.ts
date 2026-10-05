"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/data/profile";
import { isPlatformAdmin } from "@/lib/data/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingSchemaError } from "@/lib/schema-drift";
import { logInfo } from "@/lib/observability/logger";
import { dropCompanyClosureCache } from "@/lib/billing/company-closure";

/**
 * Closing and reopening a company (DECISIONS #135), from Platform Admin ›
 * Companies. Closed means locked like a lapsed subscription; nothing is
 * deleted and reopening puts everything back. Platform admins only,
 * checked here and not just on the page: a server action is a real
 * endpoint. Both are logged with who did it.
 */

async function requirePlatformAdmin() {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." } as const;
  if (!isPlatformAdmin(profile)) return { error: "Only a Platform Admin can do this." } as const;
  return { profile } as const;
}

const NOT_READY = "Closing needs its database step first: run supabase/migrations/0201_company_closures.sql.";

export async function closeCompany(companyId: string, reason: string): Promise<{ error?: string }> {
  const guard = await requirePlatformAdmin();
  if ("error" in guard) return { error: guard.error };

  const { error } = await createAdminClient()
    .from("company_closures")
    .upsert({
      company_id: companyId,
      closed_at: new Date().toISOString(),
      closed_by: guard.profile.id,
      reason: reason.trim().slice(0, 500) || null,
    });
  if (error) return { error: isMissingSchemaError(error) ? NOT_READY : error.message };

  dropCompanyClosureCache(companyId);
  logInfo({ event: "company.closed", companyId, actorId: guard.profile.id });
  revalidatePath("/platform-admin/companies");
  return {};
}

export async function reopenCompany(companyId: string): Promise<{ error?: string }> {
  const guard = await requirePlatformAdmin();
  if ("error" in guard) return { error: guard.error };

  const { error } = await createAdminClient().from("company_closures").delete().eq("company_id", companyId);
  if (error) return { error: isMissingSchemaError(error) ? NOT_READY : error.message };

  dropCompanyClosureCache(companyId);
  logInfo({ event: "company.reopened", companyId, actorId: guard.profile.id });
  revalidatePath("/platform-admin/companies");
  return {};
}

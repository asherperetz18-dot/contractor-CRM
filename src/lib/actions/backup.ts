"use server";

import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole, isPlatformAdmin } from "@/lib/data/types";
import { buildBackup } from "@/lib/backup";
import { createAdminClient } from "@/lib/supabase/admin";
import { logInfo } from "@/lib/observability/logger";

/**
 * On-demand export for the Admin Settings download button.
 *
 * Admin-gated on the server as well as the page, since a server action is
 * reachable directly, not only through the UI that renders it. It exports
 * the caller's current company only, without saved keys or tokens -- an
 * Office or Admin runs their own company, not the platform (DECISIONS
 * #099). The full export is the nightly job's.
 */
export async function downloadBackup(): Promise<{ error?: string; json?: string; rows?: number }> {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminRole(profile)) {
    return { error: "You don't have permission to export data." };
  }

  const backup = await buildBackup({ companyId: profile.company_id });
  const failed = Object.keys(backup.skipped);
  if (failed.length) {
    return {
      error: `Couldn't read: ${failed.join(", ")}. Nothing was downloaded — a partial backup would be worse than none.`,
    };
  }

  return { json: JSON.stringify(backup), rows: backup.totalRows };
}

/**
 * Any one company's export, for a platform admin on the Companies page
 * (DECISIONS #134) -- the same file a company's own Admin downloads from
 * Settings › Backup, without saved keys or tokens, for whichever company
 * the admin chose. Platform admins only, checked here: a server action is
 * a real endpoint. Each export is logged with who took it.
 */
export async function exportCompanyData(
  companyId: string
): Promise<{ error?: string; json?: string; rows?: number; companyName?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isPlatformAdmin(profile)) return { error: "Only a Platform Admin can export another company." };

  const { data: company } = await createAdminClient()
    .from("companies")
    .select("id, name")
    .eq("id", companyId)
    .maybeSingle<{ id: string; name: string }>();
  if (!company) return { error: "That company doesn't exist." };

  const backup = await buildBackup({ companyId: company.id });
  const failed = Object.keys(backup.skipped);
  if (failed.length) {
    return {
      error: `Couldn't read: ${failed.join(", ")}. Nothing was downloaded — a partial export would be worse than none.`,
    };
  }

  logInfo({ event: "backup.company_exported", companyId: company.id, actorId: profile.id, rows: backup.totalRows });
  return { json: JSON.stringify(backup), rows: backup.totalRows, companyName: company.name };
}

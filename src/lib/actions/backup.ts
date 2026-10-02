"use server";

import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole } from "@/lib/data/types";
import { buildBackup } from "@/lib/backup";

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

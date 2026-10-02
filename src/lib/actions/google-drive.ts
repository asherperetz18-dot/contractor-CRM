"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentCompanyId, getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole } from "@/lib/data/types";
import { getValidAccessToken } from "@/lib/google-drive-api";


async function requireOfficeOrAdmin(): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!isAdminRole(profile)) return { error: "Only Office or Admin users can manage cloud storage." };
  return {};
}

export async function getGoogleDriveStatus(): Promise<{
  connected: boolean;
  email?: string;
  /** The row exists but Google refuses the token -- reconnect needed. */
  expired?: boolean;
}> {
  const companyId = await getCurrentCompanyId();
  if (!companyId) return { connected: false };

  const admin = createAdminClient();
  const { data } = await admin
    .from("google_drive_connection")
    .select("connected_email")
    .eq("company_id", companyId)
    .maybeSingle();
  const row = data as { connected_email: string | null } | null;
  if (!row?.connected_email) return { connected: false };

  // "Connected" is a claim about NOW, not about a row that was written
  // once. Google expires refresh tokens (seven days flat while the
  // OAuth app sits in Testing mode), and this page kept showing a green
  // badge for weeks after every upload had quietly stopped reaching
  // Drive. Prove the token still refreshes before saying so.
  const live = await getValidAccessToken(companyId);
  if (!live) return { connected: true, email: row.connected_email, expired: true };
  return { connected: true, email: row.connected_email };
}

export async function disconnectGoogleDrive(): Promise<{ error?: string }> {
  const guard = await requireOfficeOrAdmin();
  if (guard.error) return guard;

  const companyId = await getCurrentCompanyId();
  if (!companyId) return { error: "Not signed in." };

  const admin = createAdminClient();
  await admin.from("google_drive_connection").delete().eq("company_id", companyId);

  revalidatePath("/settings/cloud-storage");
  return {};
}

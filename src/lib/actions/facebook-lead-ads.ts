"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole } from "@/lib/data/types";
import { isMetaMigrationMissing, metaLoginCredentials, parsePendingSignIn } from "@/lib/meta/facebook-login";
import { checkPageHealth, listPages, unsubscribePage, type PageHealth } from "@/lib/meta/graph";
import { MIGRATION_MISSING_MESSAGE, PICK_COOKIE, connectPageForCompany, pendingPagesFor } from "@/lib/meta/connect";

/**
 * Settings -> Facebook Lead Ads: which Page is connected, whether
 * Facebook still honours the connection, and the picker a sign-in with
 * several Pages lands on. Page tokens never leave the server.
 */

export type FacebookConnection = {
  pageId: string;
  pageName: string | null;
  via: "facebook_login" | "manual";
  connectedAt: string | null;
  health: PageHealth;
};

export type FacebookLeadAdsStatus = {
  /** The CRM's Meta app id and secret are set on the deployment. */
  configured: boolean;
  /** Migration 0178 has not been run: the new columns are missing. */
  migrationMissing: boolean;
  connection: FacebookConnection | null;
  /** A sign-in with several Pages, waiting for the person to pick one. */
  pickable: { id: string; name: string }[] | null;
};

type ProfileRow = {
  meta_page_id: string | null;
  meta_page_access_token: string | null;
  meta_page_name?: string | null;
  meta_connected_via?: string | null;
  meta_connected_at?: string | null;
};

export async function getFacebookLeadAdsStatus(): Promise<FacebookLeadAdsStatus | null> {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminRole(profile)) return null;
  const creds = metaLoginCredentials();

  const admin = createAdminClient();
  let migrationMissing = false;
  let row: ProfileRow | null = null;
  const full = await admin
    .from("company_profile")
    .select("meta_page_id, meta_page_access_token, meta_page_name, meta_connected_via, meta_connected_at")
    .eq("company_id", profile.company_id)
    .maybeSingle();
  if (full.error && isMetaMigrationMissing(full.error.message)) {
    migrationMissing = true;
    const legacy = await admin
      .from("company_profile")
      .select("meta_page_id, meta_page_access_token")
      .eq("company_id", profile.company_id)
      .maybeSingle();
    row = legacy.data as ProfileRow | null;
  } else {
    row = full.data as ProfileRow | null;
  }

  let connection: FacebookConnection | null = null;
  if (row?.meta_page_id && row.meta_page_access_token) {
    const via = row.meta_connected_via === "facebook_login" ? "facebook_login" : "manual";
    connection = {
      pageId: row.meta_page_id,
      pageName: row.meta_page_name ?? null,
      via,
      connectedAt: row.meta_connected_at ?? null,
      health: await checkPageHealth(
        row.meta_page_id,
        row.meta_page_access_token,
        via === "facebook_login" ? (creds?.appId ?? null) : null
      ),
    };
  }

  const pending = await pendingPagesFor(profile.company_id);
  return {
    configured: Boolean(creds),
    migrationMissing,
    connection,
    pickable: pending ? pending.map((p) => ({ id: p.id, name: p.name })) : null,
  };
}

/** Finishes a sign-in that offered several Pages. */
export async function connectFacebookPage(pageId: string): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminRole(profile)) return { error: "Only Office or Admin users can connect Facebook." };

  const store = await cookies();
  const pending = parsePendingSignIn(store.get(PICK_COOKIE)?.value);
  if (!pending || pending.companyId !== profile.company_id) {
    return { error: "The Facebook sign-in timed out — press Connect with Facebook again." };
  }
  const pages = await listPages(pending.userToken);
  const page = pages?.find((p) => p.id === pageId);
  if (!page) return { error: "That Page isn't available on this sign-in any more — connect again." };

  const error = await connectPageForCompany(profile.company_id, page);
  if (error) return { error };
  store.delete(PICK_COOKIE);
  revalidatePath("/settings/facebook-lead-ads");
  return {};
}

/** Drops a sign-in waiting on a pick without connecting anything. */
export async function cancelFacebookPagePick(): Promise<void> {
  (await cookies()).delete(PICK_COOKIE);
  revalidatePath("/settings/facebook-lead-ads");
}

/**
 * Stops the Page's leads reaching the CRM: Facebook is told to stop
 * sending them (best effort) and the Page and its token are forgotten.
 * Leads already imported stay.
 */
export async function disconnectFacebookPage(): Promise<{ error?: string }> {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminRole(profile)) return { error: "Only Office or Admin users can disconnect Facebook." };

  const admin = createAdminClient();
  const { data } = await admin
    .from("company_profile")
    .select("meta_page_id, meta_page_access_token")
    .eq("company_id", profile.company_id)
    .maybeSingle();
  const row = data as ProfileRow | null;
  if (row?.meta_page_id && row.meta_page_access_token) {
    await unsubscribePage(row.meta_page_id, row.meta_page_access_token);
  }

  const { error } = await admin
    .from("company_profile")
    .update({
      meta_page_id: null,
      meta_page_access_token: null,
      meta_page_name: null,
      meta_connected_via: null,
      meta_connected_at: null,
    })
    .eq("company_id", profile.company_id);
  if (error) return { error: isMetaMigrationMissing(error.message) ? MIGRATION_MISSING_MESSAGE : error.message };
  revalidatePath("/settings/facebook-lead-ads");
  return {};
}

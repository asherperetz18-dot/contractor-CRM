import "server-only";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMetaMigrationMissing, parsePendingSignIn, type MetaPage } from "./facebook-login";
import { listPages, subscribePageToLeads, unsubscribePage } from "./graph";
import { loadMetaSecrets, saveMetaSecrets } from "./page-secrets";

/**
 * Saving a Page picked through "Connect with Facebook". Shared by the
 * sign-in callback (one Page: connected straight away) and the picker's
 * action (several Pages: the person chooses). Not a server action -- it
 * takes a company id on trust, so only code that has already checked
 * the caller may reach it.
 */

/**
 * Between the sign-in and the pick, the person's Facebook token waits in
 * an httpOnly cookie for ten minutes rather than in the database: it can
 * list every Page they run, and the CRM only ever needs the one Page's
 * token it keeps.
 */
export const PICK_COOKIE = "meta_oauth_pick";
export const PICK_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  maxAge: 600,
  path: "/",
};

/** The Pages a sign-in still waiting on a pick can choose from, for this company only. */
export async function pendingPagesFor(companyId: string): Promise<MetaPage[] | null> {
  const pending = parsePendingSignIn((await cookies()).get(PICK_COOKIE)?.value);
  if (!pending || pending.companyId !== companyId) return null;
  return listPages(pending.userToken);
}

export const MIGRATION_MISSING_MESSAGE =
  "Facebook sign-in isn't set up in the database yet — run migration 0178 and try again.";

export async function connectPageForCompany(companyId: string, page: MetaPage): Promise<string | null> {
  const admin = createAdminClient();

  const { data: taken } = await admin
    .from("company_profile")
    .select("company_id")
    .eq("meta_page_id", page.id)
    .neq("company_id", companyId)
    .limit(1);
  if (taken?.length) {
    return `“${page.name}” is already connected to another company in the CRM. A Page can send its leads to one company only.`;
  }

  const subscribeError = await subscribePageToLeads(page);
  if (subscribeError) return `Facebook wouldn't send “${page.name}”'s leads to the CRM: ${subscribeError}`;

  const { data: before } = await admin
    .from("company_profile")
    .select("meta_page_id, meta_connected_via")
    .eq("company_id", companyId)
    .maybeSingle();
  const old = before as { meta_page_id: string | null; meta_connected_via: string | null } | null;
  const oldToken =
    old?.meta_connected_via === "facebook_login" && old.meta_page_id && old.meta_page_id !== page.id
      ? (await loadMetaSecrets(companyId, admin)).pageAccessToken
      : null;

  // The Page token is stored encrypted (DECISIONS #114).
  const { error } = await saveMetaSecrets(
    companyId,
    { pageAccessToken: page.accessToken },
    {
      meta_page_id: page.id,
      meta_page_name: page.name,
      meta_connected_via: "facebook_login",
      meta_connected_at: new Date().toISOString(),
    },
    admin
  );
  if (error) return isMetaMigrationMissing(error) ? MIGRATION_MISSING_MESSAGE : error;

  // Switching Pages: the old one stops sending leads to the CRM's app.
  if (old?.meta_page_id && oldToken) {
    await unsubscribePage(old.meta_page_id, oldToken);
  }
  return null;
}

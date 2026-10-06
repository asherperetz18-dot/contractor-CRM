import "server-only";
import { unstable_cache, updateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import type { RolePageVisibilityRow, TimeFormat } from "@/lib/data/types";
import { loadCompanyWords } from "@/lib/load-company-words";
import type { CompanyWords } from "@/lib/company-words";
import { STANDARD_ROLE_NAMES, readRoleNames, type RoleNames } from "@/lib/role-names";
import { boughtListKeys } from "@/lib/lead-or-contact";

/**
 * The parts of the app shell that are the same on every page.
 *
 * The company's name, logo, clock format, menu order and the role
 * visibility matrix do not change between one navigation and the next --
 * they change when somebody edits a settings page, which is rarely.
 * They were being read from the database on every single page load, four
 * queries' worth, before the page itself fetched anything. On a settings
 * screen that needs one query of its own that was most of the wait, and
 * it was why every page felt slow rather than just the heavy ones.
 *
 * Cached per company and invalidated by tag when the settings that feed
 * them are saved, so an edit still shows up immediately. `revalidate` is
 * only a backstop for a row changed outside the app, straight in the
 * database.
 *
 * These read through the service-role client because a cached scope
 * cannot touch cookies, which the request-scoped client needs. That
 * bypasses row-level security, so `companyId` must always be a company
 * the caller has already been shown to belong to -- in practice
 * `profile.company_id`, which RLS established. Never pass an id that
 * arrived from the browser.
 */

export type CompanyChrome = {
  name: string | null;
  logo_url: string | null;
  time_format: TimeFormat | null;
  nav_order: string[] | null;
};

const EMPTY_CHROME: CompanyChrome = {
  name: null,
  logo_url: null,
  time_format: null,
  nav_order: null,
};

const chromeTag = (companyId: string) => `company-chrome:${companyId}`;
const visibilityTag = (companyId: string) => `role-visibility:${companyId}`;
const boughtListsTag = (companyId: string) => `bought-lists:${companyId}`;

// Long, because the tags below do the real invalidating.
const BACKSTOP_SECONDS = 300;

export function getCompanyChrome(companyId: string): Promise<CompanyChrome> {
  return unstable_cache(
    async (id: string): Promise<CompanyChrome> => {
      const supabase = createAdminClient();
      // One row, one query. This used to be three: the name and logo for
      // the sidebar, the logo again for the favicon, and nav_order on its
      // own.
      const { data } = await supabase
        .from("company_profile")
        .select("name, logo_url, time_format, nav_order")
        .eq("company_id", id)
        .maybeSingle();
      return (data as CompanyChrome | null) ?? EMPTY_CHROME;
    },
    ["company-chrome", companyId],
    { tags: [chromeTag(companyId)], revalidate: BACKSTOP_SECONDS }
  )(companyId);
}

/**
 * The company's words (DECISIONS #121), for the menus every page draws
 * (#125). Cached with the chrome and dropped with it when the words are
 * saved. Its own query, so a database without 0196 reads the standard
 * words instead of losing the chrome.
 */
export function getCompanyWordsCached(companyId: string): Promise<CompanyWords> {
  return unstable_cache(
    async (id: string): Promise<CompanyWords> => loadCompanyWords(createAdminClient(), id),
    ["company-words", companyId],
    { tags: [chromeTag(companyId)], revalidate: BACKSTOP_SECONDS }
  )(companyId);
}

/**
 * What the company calls its team roles (DECISIONS #138), for the
 * screens that print a role. Cached with the chrome and dropped with it
 * when they are saved. Its own query, so a database without 0202 reads
 * the standard names instead of losing anything else.
 */
export function getRoleNamesCached(companyId: string): Promise<RoleNames> {
  return unstable_cache(
    async (id: string): Promise<RoleNames> => {
      const { data, error } = await createAdminClient()
        .from("company_profile")
        .select("role_names")
        .eq("company_id", id)
        .maybeSingle<{ role_names: unknown }>();
      return error ? STANDARD_ROLE_NAMES : readRoleNames(data?.role_names);
    },
    ["role-names", companyId],
    { tags: [chromeTag(companyId)], revalidate: BACKSTOP_SECONDS }
  )(companyId);
}

/**
 * The company's sources ticked as bought lists, as rule keys (DECISIONS
 * #156): what a query needs to count only real leads -- the bell and the
 * 20-second popup poll among them, which shouldn't pay a round trip for
 * a list that changes a few times a year. Dropped when a source is
 * ticked, added, renamed, merged or removed. Empty before 0165 adds the
 * flag, which is today's "every sourced contact is a lead".
 */
export function getBoughtListKeysCached(companyId: string): Promise<string[]> {
  return unstable_cache(
    async (id: string): Promise<string[]> => {
      const { data, error } = await createAdminClient()
        .from("lead_sources")
        .select("name, bought_list")
        .eq("company_id", id)
        .eq("bought_list", true);
      if (error) return [];
      return boughtListKeys((data ?? []) as { name: string; bought_list: boolean }[]);
    },
    ["bought-lists", companyId],
    { tags: [boughtListsTag(companyId)], revalidate: BACKSTOP_SECONDS }
  )(companyId);
}

export function getRoleVisibility(companyId: string): Promise<RolePageVisibilityRow[]> {
  return unstable_cache(
    async (id: string): Promise<RolePageVisibilityRow[]> => {
      const supabase = createAdminClient();
      const { data } = await supabase
        .from("role_page_visibility")
        .select("id, role, page_key, visible")
        .eq("company_id", id);
      return (data as RolePageVisibilityRow[] | null) ?? [];
    },
    ["role-visibility", companyId],
    { tags: [visibilityTag(companyId)], revalidate: BACKSTOP_SECONDS }
  )(companyId);
}

/**
 * Call after saving anything the sidebar or favicon reads.
 *
 * updateTag rather than revalidateTag: it expires the entry outright, so
 * whoever just saved a logo sees the new one on the very next render.
 * revalidateTag would hand them the old one once more while it refreshed
 * behind their back, which for a settings screen reads as the save
 * having failed. Server Actions only, which is where all the callers are.
 */
export function revalidateCompanyChrome(companyId: string) {
  updateTag(chromeTag(companyId));
}

/** Call after changing the Role Visibility matrix. */
export function revalidateRoleVisibility(companyId: string) {
  updateTag(visibilityTag(companyId));
}

/** Call after changing the lead sources list or a bought-list tick. */
export function revalidateBoughtLists(companyId: string) {
  updateTag(boughtListsTag(companyId));
}

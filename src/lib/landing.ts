import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { canSeePage, pathToPageKey, type RolePageVisibilityRow } from "@/lib/data/types";
import { NAV, filterNavForProfile, type NavEntry } from "@/lib/nav";

function firstVisibleHref(nav: NavEntry[]): string | null {
  for (const entry of nav) {
    if (entry.type === "link") return entry.href;
    const firstItem = entry.items.find((i) => i.href);
    if (firstItem?.href) return firstItem.href;
  }
  return null;
}

/**
 * Where this user's session should land after signing in.
 *
 * The login action used to send everyone to "/" and let the layout
 * bounce roles with a hidden Dashboard to their first visible page.
 * That second redirect, arriving inside a server-action navigation,
 * put the app router into an endless replay -- a Sales rep signed in
 * and got a frozen white tab, reported as "can't get in". Deciding the
 * destination here means restricted roles never transit "/" at all;
 * the layout's own redirect stays as the fallback for direct visits.
 */
export async function postLoginPath(): Promise<string> {
  const profile = await getCurrentProfile();
  if (!profile) return "/";

  const supabase = await createClient();
  const { data } = await supabase
    .from("role_page_visibility")
    .select("id, role, page_key, visible")
    .eq("company_id", profile.company_id);
  const overrides = (data as RolePageVisibilityRow[]) ?? [];

  const dashboardKey = pathToPageKey("/");
  if (!dashboardKey || canSeePage(profile, dashboardKey, overrides)) return "/";
  return firstVisibleHref(filterNavForProfile(NAV, profile, overrides)) ?? "/";
}

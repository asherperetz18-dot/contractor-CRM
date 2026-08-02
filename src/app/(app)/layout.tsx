import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, getCurrentUserCompanies } from "@/lib/data/profile";
import { canEditDispatch, canSeePage, isAdminRole, pathToPageKey, type RolePageVisibilityRow } from "@/lib/data/types";
import { NAV, filterNavForProfile, type NavEntry } from "@/lib/nav";
import { MobileNav } from "./mobile-nav";
import { MobileNavToggle } from "./mobile-nav-toggle";
import { QuickCreateMenu } from "./quick-create-menu";
import { GlobalSearch } from "./global-search";
import { AdminToolsMenu } from "./admin-tools-menu";
import { ActivityTracker } from "./activity-tracker";
import { VoiceDialer } from "./voice-dialer";
import { CompanySwitcher } from "./company-switcher";
import { DuplicateContactsButton } from "./duplicate-contacts-button";
import { AiAssistantButton } from "./ai-assistant-button";
import { TimeFormatProvider } from "@/components/time-format-context";
import type { TimeFormat } from "@/lib/data/types";
import { version } from "../../../package.json";

// Per-company favicon (the browser tab icon), since this app is
// multi-tenant on a single domain -- the root layout can't resolve this
// without a session, so it lives here where profile.company_id is
// already known. getCurrentProfile() is cache()-wrapped, so this is
// deduped with the identical call in AppLayout below.
export async function generateMetadata(): Promise<Metadata> {
  const profile = await getCurrentProfile();
  if (!profile) return {};

  const supabase = await createClient();
  const { data } = await supabase
    .from("company_profile")
    .select("logo_url")
    .eq("company_id", profile.company_id)
    .single();
  const logoUrl = (data as { logo_url: string | null } | null)?.logo_url;

  return logoUrl ? { icons: { icon: logoUrl } } : {};
}

function firstVisibleHref(nav: NavEntry[]): string | null {
  for (const entry of nav) {
    if (entry.type === "link") return entry.href;
    const firstItem = entry.items.find((i) => i.href);
    if (firstItem?.href) return firstItem.href;
  }
  return null;
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  const [{ data: companyProfile }, { data: visibilityRows }, companies] = await Promise.all([
    supabase
      .from("company_profile")
      .select("name, logo_url, time_format")
      .eq("company_id", profile.company_id)
      .single(),
    supabase
      .from("role_page_visibility")
      .select("id, role, page_key, visible")
      .eq("company_id", profile.company_id),
    getCurrentUserCompanies(),
  ]);
  const company = companyProfile as {
    name: string | null;
    logo_url: string | null;
    time_format: TimeFormat | null;
  } | null;
  const logoUrl = company?.logo_url ?? null;
  const companyName = company?.name?.trim();
  const timeFormat: TimeFormat = company?.time_format ?? "12h";
  const overrides = (visibilityRows as RolePageVisibilityRow[]) ?? [];
  const filteredNav = filterNavForProfile(NAV, profile, overrides);

  const pathname = (await headers()).get("x-pathname") ?? "/";
  const pageKey = pathToPageKey(pathname);
  const pageBlocked = !!pageKey && !canSeePage(profile, pageKey, overrides);

  // Dashboard ("/") is where login lands everyone -- if a role has it
  // hidden, send them straight to whatever their nav actually starts
  // with instead of showing a blocked-page message as their first
  // impression after signing in.
  if (pageBlocked && pathname === "/") {
    const fallback = firstVisibleHref(filteredNav);
    if (fallback) redirect(fallback);
  }

  return (
    <TimeFormatProvider value={timeFormat}>
    <div className="app-shell">
      <div className="app-root">
        <div className="global-topbar">
          <div className="global-topbar-left">
            <MobileNavToggle />
            {logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="Company logo" className="topbar-logo-img" />
            )}
            <span className="global-topbar-brand">{companyName || "Contractor CRM"}</span>
            <GlobalSearch />
          </div>
          <div className="global-topbar-right">
            <CompanySwitcher companies={companies} currentCompanyId={profile.company_id} canCreate={isAdminRole(profile)} />
            {canEditDispatch(profile) && <DuplicateContactsButton />}
            <AiAssistantButton />
            <QuickCreateMenu />
            {isAdminRole(profile) && <AdminToolsMenu />}
          </div>
        </div>
        <ActivityTracker />
        <VoiceDialer />

        <div className="app-body">
          <MobileNav
            logoUrl={logoUrl}
            companyName={companyName}
            version={version}
            filteredNav={filteredNav}
            roles={profile.roles}
          />

          <main className="main">
            {pageBlocked ? (
              <div className="empty-state">
                <p className="empty-label">Page not available</p>
                <p className="empty-hint">
                  Your role doesn&apos;t have access to this page. Contact an admin if you
                  think this is a mistake.
                </p>
              </div>
            ) : (
              children
            )}
          </main>
        </div>
      </div>
    </div>
    </TimeFormatProvider>
  );
}

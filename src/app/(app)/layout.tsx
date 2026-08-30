import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getCurrentProfile, getCurrentUserCompanies } from "@/lib/data/profile";
import {
  canEditDispatch,
  canSeePage,
  canViewEstimates,
  isAdminRole,
  isFieldRole,
  isStrictAdmin,
} from "@/lib/data/types";
import { NAV, filterNavForProfile, sortNavEntries, type NavEntry } from "@/lib/nav";
import { MobileNav } from "./mobile-nav";
import { MobileNavToggle } from "./mobile-nav-toggle";
import { QuickCreateMenu } from "./quick-create-menu";
import { GlobalSearch } from "./global-search";
import { AdminToolsMenu } from "./admin-tools-menu";
import { LiveUsersButton } from "./live-users-button";
import { getLiveUsers } from "@/lib/actions/presence";
import { getCompanyChrome, getRoleVisibility } from "@/lib/data/company-chrome";
import { ActivityTracker } from "./activity-tracker";
import { VoiceDialer } from "./voice-dialer";
import { UpdateNotice } from "./update-notice";
import { CompanySwitcher } from "./company-switcher";
import { DialerButton } from "./dialer-button";
import { DuplicateContactsButton } from "./duplicate-contacts-button";
import { InboxAlerts } from "./inbox-alerts";
import { PageGate } from "./page-gate";
import { ScreenShareButton, ScreenShareEngine } from "./screen-share";
import { AiAssistantButton } from "./ai-assistant-button";
import { DailyBriefButton } from "./daily-brief";
import { NotificationBell } from "./notification-bell";
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

  // Same cached read the layout does, so the favicon costs no query of
  // its own -- this used to be a third trip for company_profile.
  const { logo_url: logoUrl } = await getCompanyChrome(profile.company_id);

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

  // Cached per company and invalidated when the matching settings are
  // saved. Both used to be fresh database reads on every navigation --
  // four queries between them -- for values that change when somebody
  // edits a settings page and not otherwise.
  const [company, overrides, companies, liveUsers] = await Promise.all([
    getCompanyChrome(profile.company_id),
    getRoleVisibility(profile.company_id),
    getCurrentUserCompanies(),
    // Seeds the presence badge so the button does not have to ask for
    // itself on mount. Rides along with the reads above rather than
    // costing a round trip of its own, and is skipped entirely for the
    // roles that never see the button.
    isStrictAdmin(profile) ? getLiveUsers() : Promise.resolve(null),
  ]);
  const logoUrl = company.logo_url;
  const companyName = company.name?.trim();
  const timeFormat: TimeFormat = company.time_format ?? "12h";
  const navOrder = company.nav_order;
  const filteredNav = sortNavEntries(filterNavForProfile(NAV, profile, overrides), navOrder);

  // Dashboard ("/") is where login lands everyone -- if a role has it
  // hidden, send them straight to whatever their nav actually starts
  // with instead of showing a blocked-page message as their first
  // impression after signing in. Only this redirect reads the pathname
  // here; the per-page block itself lives in PageGate, which re-decides
  // on every in-app navigation -- a layout renders once, and a decision
  // frozen in it followed people from page to page.
  const pathname = (await headers()).get("x-pathname") ?? "/";
  if (pathname === "/" && !canSeePage(profile, "dashboard", overrides)) {
    const fallback = firstVisibleHref(filteredNav);
    if (fallback) redirect(fallback);
  }

  // The crew's chrome is bare: no search, no topbar tools. A Field
  // user's whole app is the job list, and search reaches leads,
  // documents and money across the company. Same condition as the crew
  // Projects view.
  const crew = isFieldRole(profile) && !canViewEstimates(profile);

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
            {!crew && <GlobalSearch />}
          </div>
          <div className="global-topbar-right">
            {/* Office tools: the dialer, quick create, screen share,
                daily brief and AI assistant all open onto data the
                crew view exists to keep out of reach. */}
            {!crew && (
              <>
                {/* Help lives outside the visibility matrix on purpose --
                    the person who can't find a page needs this the most. */}
                <Link
                  href="/tutorials"
                  className="icon-btn topbar-icon-btn"
                  title="Video tutorials — narrated walkthroughs"
                  aria-label="Video tutorials"
                >
                  ❓
                </Link>
                <ScreenShareButton />
                <DialerButton />
                {canEditDispatch(profile) && <DuplicateContactsButton />}
                {isStrictAdmin(profile) && (
                  <LiveUsersButton initialUsers={liveUsers?.users ?? []} />
                )}
                <DailyBriefButton isAdmin={isAdminRole(profile)} />
                <NotificationBell />
                <AiAssistantButton />
                <QuickCreateMenu />
                {isAdminRole(profile) && <AdminToolsMenu isAdmin={isStrictAdmin(profile)} />}
              </>
            )}
          </div>
        </div>
        <ActivityTracker />
        <VoiceDialer />
        <ScreenShareEngine
          selfId={profile.id}
          selfName={profile.name || profile.email || "A teammate"}
          companyId={profile.company_id}
        />
        {/* The incoming-text watcher: badge, toast + ding, tab-title
            flash. For the people who staff the phones -- Office,
            Dispatch, Admin -- not every role that can merely open the
            inbox: a Sales rep on the road did not ask to be dinged for
            every customer text. The page-visibility check rides along so
            hiding Reply Inbox from a role silences its alerts too. */}
        {(isAdminRole(profile) ||
          profile.roles.includes("Office") ||
          profile.roles.includes("Dispatch")) &&
          canSeePage(profile, "reply-inbox", overrides) && (
            <InboxAlerts companyId={profile.company_id} />
          )}
        {/* `version` here is baked into this render, so it is whatever the
            browser actually loaded -- which is exactly what the banner
            needs to compare against. */}
        <UpdateNotice current={version} />

        <div className="app-body">
          <MobileNav
            logoUrl={logoUrl}
            companyName={companyName}
            version={version}
            filteredNav={filteredNav}
            userName={profile.name || profile.email || ""}
            // Rendered here (a server component) and passed down, so the
            // sidebar doesn't need the company list re-plumbed through it.
            companySwitcher={
              <CompanySwitcher
                companies={companies}
                currentCompanyId={profile.company_id}
                canCreate={isAdminRole(profile)}
              />
            }
          />

          <main className="main">
            <PageGate roles={profile.roles} overrides={overrides}>
              {children}
            </PageGate>
          </main>
        </div>
      </div>
    </div>
    </TimeFormatProvider>
  );
}

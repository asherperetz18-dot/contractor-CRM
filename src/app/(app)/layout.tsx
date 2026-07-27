import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { canSeePage, isAdminRole, pathToPageKey, type RolePageVisibilityRow } from "@/lib/data/types";
import { logout } from "@/lib/actions/auth";
import { NAV, filterNavForProfile } from "@/lib/nav";
import { NavLink } from "./nav-link";
import { NavGroup } from "./nav-group";
import { QuickCreateMenu } from "./quick-create-menu";
import { GlobalSearch } from "./global-search";
import { AdminToolsMenu } from "./admin-tools-menu";
import { ActivityTracker } from "./activity-tracker";
import { VoiceDialer } from "./voice-dialer";
import { TimeFormatProvider } from "@/components/time-format-context";
import type { TimeFormat } from "@/lib/data/types";
import { version } from "../../../package.json";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  const [{ data: companyProfile }, { data: visibilityRows }] = await Promise.all([
    supabase.from("company_profile").select("name, logo_url, time_format").eq("id", 1).single(),
    supabase.from("role_page_visibility").select("id, role, page_key, visible"),
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

  return (
    <TimeFormatProvider value={timeFormat}>
    <div className="app-shell">
      <div className="app-root">
        <div className="global-topbar">
          <div className="global-topbar-left">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="Company logo" className="topbar-logo-img" />
            ) : (
              <span className="global-topbar-brand">
                {companyName || "Contractor CRM"}
              </span>
            )}
            <GlobalSearch />
          </div>
          <div className="global-topbar-right">
            <QuickCreateMenu />
            {isAdminRole(profile) && <AdminToolsMenu />}
          </div>
        </div>
        <ActivityTracker />
        <VoiceDialer />

        <div className="app-body">
          <aside className="sidebar">
            <div className="sidebar-head">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="Company logo" className="sidebar-logo-img" />
              ) : (
                <div className="sidebar-title">{companyName || "Contractor CRM"}</div>
              )}
              <div className="sidebar-sub">v{version}</div>
            </div>
            <nav className="sidebar-nav">
              {filteredNav.map((item) =>
                item.type === "group" ? (
                  <NavGroup key={item.label} group={item} />
                ) : (
                  <NavLink key={item.href} href={item.href}>
                    <span className="nav-icon">{item.icon}</span>
                    {item.label}
                  </NavLink>
                )
              )}
            </nav>
            <div className="sidebar-foot">
              <div className="role-label">Signed in as</div>
              <div className="role-value">
                {profile.roles.length === 0 && (
                  <span className="role-badge">No role assigned</span>
                )}
                {profile.roles.map((role) => (
                  <span
                    key={role}
                    className={
                      "role-badge " +
                      (role === "Office" ? "role-office" : "role-field")
                    }
                  >
                    {role}
                  </span>
                ))}
              </div>
              <form action={logout}>
                <button type="submit" className="sign-out-btn">
                  Sign out
                </button>
              </form>
            </div>
          </aside>

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

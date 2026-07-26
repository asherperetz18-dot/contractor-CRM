import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/profile";
import { isAdminRole } from "@/lib/data/types";
import { logout } from "@/lib/actions/auth";
import { NAV } from "@/lib/nav";
import { NavLink } from "./nav-link";
import { NavGroup } from "./nav-group";
import { QuickCreateMenu } from "./quick-create-menu";
import { GlobalSearch } from "./global-search";
import { AdminToolsMenu } from "./admin-tools-menu";
import { ActivityTracker } from "./activity-tracker";
import { version } from "../../../package.json";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  const { data: companyProfile } = await supabase
    .from("company_profile")
    .select("name, logo_url")
    .eq("id", 1)
    .single();
  const company = companyProfile as { name: string | null; logo_url: string | null } | null;
  const logoUrl = company?.logo_url ?? null;
  const companyName = company?.name?.trim();

  return (
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
              {NAV.map((item) =>
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

          <main className="main">{children}</main>
        </div>
      </div>
    </div>
  );
}

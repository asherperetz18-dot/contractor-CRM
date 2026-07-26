import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/data/profile";
import { logout } from "@/lib/actions/auth";
import { NAV } from "@/lib/nav";
import { NavLink } from "./nav-link";
import { QuickCreateMenu } from "./quick-create-menu";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  return (
    <div className="app-shell">
      <div className="app-root">
        <div className="global-topbar">
          <div className="global-topbar-left">
            <span className="global-topbar-brand">Contractor CRM</span>
            <input className="global-search" placeholder="Search for Anything" />
          </div>
          <div className="global-topbar-right">
            <QuickCreateMenu />
          </div>
        </div>

        <div className="app-body">
          <aside className="sidebar">
            <div className="sidebar-head">
              <div className="sidebar-title">Contractor CRM</div>
              <div className="sidebar-sub">{profile.name ?? profile.email}</div>
            </div>
            <nav className="sidebar-nav">
              {NAV.map((item) => (
                <NavLink key={item.href} href={item.href}>
                  <span className="nav-icon">{item.icon}</span>
                  {item.label}
                </NavLink>
              ))}
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

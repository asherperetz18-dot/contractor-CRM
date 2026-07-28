"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { NavEntry } from "@/lib/nav";
import type { AppRole } from "@/lib/data/types";
import { NavLink } from "./nav-link";
import { NavGroup } from "./nav-group";
import { logout } from "@/lib/actions/auth";

export function MobileNav({
  logoUrl,
  companyName,
  version,
  filteredNav,
  roles,
}: {
  logoUrl: string | null;
  companyName?: string;
  version: string;
  filteredNav: NavEntry[];
  roles: AppRole[];
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [lastPathname, setLastPathname] = useState(pathname);

  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setOpen(false);
  }

  useEffect(() => {
    function handleToggle() {
      setOpen((o) => !o);
    }
    window.addEventListener("crm:mobile-nav-toggle", handleToggle);
    return () => window.removeEventListener("crm:mobile-nav-toggle", handleToggle);
  }, []);

  return (
    <>
      {open && <div className="sidebar-backdrop" onClick={() => setOpen(false)} />}
      <aside className={"sidebar" + (open ? " sidebar-open" : "")}>
        <div className="sidebar-head">
          <button
            type="button"
            className="sidebar-close"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          >
            ✕
          </button>
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
            {roles.length === 0 && <span className="role-badge">No role assigned</span>}
            {roles.map((role) => (
              <span
                key={role}
                className={"role-badge " + (role === "Office" ? "role-office" : "role-field")}
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
    </>
  );
}

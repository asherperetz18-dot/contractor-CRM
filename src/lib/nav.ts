export type NavLinkItem = {
  type: "link";
  href: string;
  label: string;
  icon: string;
};

export type NavGroupItem = {
  type: "group";
  label: string;
  icon: string;
  items: {
    label: string;
    href?: string;
    comingSoon?: boolean;
  }[];
};

export type NavEntry = NavLinkItem | NavGroupItem;

import { canSeePage, isAdminRole, pathToPageKey, type Profile, type RolePageVisibilityRow } from "./data/types";

export function filterNavForProfile(
  nav: NavEntry[],
  profile: Pick<Profile, "roles"> | null,
  overrides: RolePageVisibilityRow[]
): NavEntry[] {
  function allowed(href?: string): boolean {
    if (!href) return true;
    // Not a role-visibility-managed page (e.g. Admin Settings) -- gated
    // by isAdminRole directly instead, since AdminGate blocks the page
    // itself for everyone else anyway.
    if (href === "/settings") return isAdminRole(profile);
    const pageKey = pathToPageKey(href);
    if (!pageKey) return true;
    return canSeePage(profile, pageKey, overrides);
  }

  return nav
    .map((entry): NavEntry | null => {
      if (entry.type === "link") {
        return allowed(entry.href) ? entry : null;
      }
      const items = entry.items.filter((item) => allowed(item.href));
      // Placeholder ("coming soon") items have no href and would otherwise
      // keep an entire group visible even when every real page in it is
      // hidden for this role, so they don't count toward keeping the group.
      const hasRealItem = items.some((item) => !!item.href);
      if (!hasRealItem) return null;
      return { ...entry, items };
    })
    .filter((entry): entry is NavEntry => entry !== null);
}

export const NAV: NavEntry[] = [
  { type: "link", href: "/", label: "Dashboard", icon: "◎" },
  {
    type: "group",
    label: "Dispatch (Leads Mgmt.)",
    icon: "▸",
    items: [
      { label: "Leads Pipeline", href: "/pipeline" },
      { label: "Dispatch Dashboard", comingSoon: true },
      { label: "Reply Inbox", href: "/reply-inbox" },
      { label: "Marketing Analytics", href: "/marketing-analytics" },
      { label: "Contacts", href: "/contacts" },
      { label: "Salespeople", href: "/salespeople" },
      { label: "Appt. Setter Assignments", href: "/appt-setter-assignments" },
    ],
  },
  {
    type: "group",
    label: "Your Sales Center",
    icon: "☎",
    items: [
      { label: "Power Dialer", href: "/dial-queue" },
      { label: "Call Reports", href: "/call-reports" },
      { label: "Text Reports", href: "/text-reports" },
    ],
  },
  { type: "link", href: "/production", label: "Production", icon: "▦" },
  { type: "link", href: "/documents", label: "Estimates & Invoices", icon: "▤" },
  { type: "link", href: "/calendar", label: "Calendar", icon: "📅" },
  { type: "link", href: "/schedule", label: "Schedule", icon: "▧" },
  { type: "link", href: "/contracts", label: "Contracts", icon: "✎" },
  { type: "link", href: "/settings", label: "Admin Settings", icon: "⚙" },
];

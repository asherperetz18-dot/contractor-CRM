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

import {
  canSeePage,
  canViewEstimates,
  isAdminRole,
  pathToPageKey,
  PAGE_REGISTRY,
  TOP_LEVEL_NAV_GROUP,
  type PageKey,
  type Profile,
  type RolePageVisibilityRow,
} from "./data/types";

export function filterNavForProfile(
  nav: NavEntry[],
  profile: Pick<Profile, "roles" | "can_view_estimates"> | null,
  overrides: RolePageVisibilityRow[]
): NavEntry[] {
  function allowed(href?: string): boolean {
    if (!href) return true;
    // Not a role-visibility-managed page (e.g. Admin Settings) -- gated
    // by isAdminRole directly instead, since AdminGate blocks the page
    // itself for everyone else anyway.
    if (href === "/settings") return isAdminRole(profile);
    // Estimates carry a per-person permission on top of role visibility;
    // showing a link that lands on "you don't have access" is worse than
    // showing nothing.
    if (href === "/estimates") return canViewEstimates(profile);
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

// The sidebar is DERIVED from PAGE_REGISTRY -- it is not a second list to
// keep in step. Maintaining both by hand dropped Sales Center's link once
// and mis-grouped Marketing Analytics once; a page added to the registry
// now appears here automatically, and the label, href and grouping shown
// in the sidebar cannot drift from the ones Role Visibility manages.
//
// Only presentation lives below: icons, and the one placeholder that has
// no page behind it yet. A page whose icon is missing still gets a link.

const PAGE_ICONS: Partial<Record<PageKey, string>> = {
  dashboard: "◎",
  "marketing-analytics": "📈",
  production: "▦",
  documents: "📄",
  payments: "💵",
  commissions: "🧾",
  calendar: "📅",
  schedule: "▧",
  contracts: "✎",
};

const GROUP_ICONS: Record<string, string> = {
  "Dispatch (Leads Mgmt.)": "▸",
  "Your Sales Center": "☎",
};

const FALLBACK_ICON = "▪";

// Announced-but-unbuilt items. They have no page key because they have no
// page, so they cannot come from the registry; `after` pins each one to
// its spot rather than leaving it to sort to the end of its group.
const PLACEHOLDERS: { label: string; group: string; after: PageKey }[] = [
  { label: "Dispatch Dashboard", group: "Dispatch (Leads Mgmt.)", after: "pipeline" },
];

function buildNav(): NavEntry[] {
  const entries: NavEntry[] = [];
  let openGroup: NavGroupItem | null = null;

  for (const page of PAGE_REGISTRY) {
    const icon = PAGE_ICONS[page.key] ?? FALLBACK_ICON;

    if (page.group === TOP_LEVEL_NAV_GROUP) {
      openGroup = null;
      entries.push({ type: "link", href: page.href, label: page.label, icon });
      continue;
    }

    if (!openGroup || openGroup.label !== page.group) {
      openGroup = {
        type: "group",
        label: page.group,
        icon: GROUP_ICONS[page.group] ?? FALLBACK_ICON,
        items: [],
      };
      entries.push(openGroup);
    }

    openGroup.items.push({ label: page.label, href: page.href });
    for (const placeholder of PLACEHOLDERS) {
      if (placeholder.group === page.group && placeholder.after === page.key) {
        openGroup.items.push({ label: placeholder.label, comingSoon: true });
      }
    }
  }

  // Admin Settings is deliberately absent from PAGE_REGISTRY: it is not
  // role-visibility managed (AdminGate blocks it outright), so it has no
  // cell in that matrix and has to be appended here.
  entries.push({ type: "link", href: "/settings", label: "Admin Settings", icon: "⚙" });
  return entries;
}

export const NAV: NavEntry[] = buildNav();

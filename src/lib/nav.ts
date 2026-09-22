import {
  navEntryKey,
  sortNavEntries,
  type NavEntry,
  type NavGroupItem,
  type NavLinkItem,

  canSeePage,
  canViewEstimates,
  GROUP_TONES,
  isAdminRole,
  isStrictAdmin,
  pathToPageKey,
  PAGE_REGISTRY,
  TOP_LEVEL_NAV_GROUP,
  type PageKey,
  type Profile,
  type RolePageVisibilityRow,
} from "./data/types";
import {
  canViewFinancials,
  canViewProfitLoss,
  type AccountingAccess,
} from "./data/accounting-access";

export function filterNavForProfile(
  nav: NavEntry[],
  // Intersected rather than Picked: the two accounting flags live on the
  // signed-in Profile (data/profile), deliberately NOT on the platform
  // Profile in data/types -- see the note on AccountingFlags.
  profile: (Pick<Profile, "roles" | "can_view_estimates"> & AccountingAccess) | null,
  overrides: RolePageVisibilityRow[]
): NavEntry[] {
  function allowed(href?: string): boolean {
    if (!href) return true;
    // Not a role-visibility-managed page (e.g. Admin Settings) -- gated
    // by isAdminRole directly instead, since AdminGate blocks the page
    // itself for everyone else anyway.
    if (href === "/settings") return isAdminRole(profile);
    // Approvals is Admin only -- both of its actions (the pending list
    // and the on/off switch) refuse anyone else, so the link shows only
    // to the person who can actually use the page.
    if (href === "/estimate-approvals") return isStrictAdmin(profile);
    // Estimates carry a per-person permission ON TOP of role visibility,
    // not instead of it. Bypassing the matrix here kept the link (and
    // postLoginPath's idea of "first visible page") alive for roles the
    // matrix hides it from -- which landed a Production user on a
    // blocked page the moment they signed in.
    if (href === "/estimates") {
      return canViewEstimates(profile) && canSeePage(profile, "documents", overrides);
    }
    // Same person-level switch as the module it reports on: a viewer
    // who cannot open estimates has no status to read.
    if (href === "/estimate-status") {
      return canViewEstimates(profile) && canSeePage(profile, "estimate-status", overrides);
    }
    // The Accounting pages work the same way: the person-level switch
    // (accounting-access) on TOP of role visibility. The pages enforce
    // it themselves either way -- this only keeps the menu from showing
    // a link that would land on "you don't have access", and keeps
    // postLoginPath from picking a blocked page as someone's landing.
    if (href === "/bills" || href === "/collect" || href === "/payments") {
      if (!profile || !canViewFinancials(profile)) return false;
    }
    if (href === "/profit-loss") {
      if (!profile || !canViewProfitLoss(profile)) return false;
    }
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
      // A group with every page hidden for this role has no reason to show.
      if (items.length === 0) return null;
      return { ...entry, items };
    })
    .filter((entry): entry is NavEntry => entry !== null);
}

// The sidebar is DERIVED from PAGE_REGISTRY -- it is not a second list to
// keep in step. Maintaining both by hand dropped Call Center's link once
// and mis-grouped Marketing Analytics once; a page added to the registry
// now appears here automatically, and the label, href and grouping shown
// in the sidebar cannot drift from the ones Role Visibility manages.
//
// Only presentation lives below: icons. A page whose icon is missing
// still gets a link. Nothing renders in the sidebar without a page
// behind it -- the "Dispatch Dashboard · Soon" placeholder that once did
// was the only row that went nowhere when tapped, and it read as broken.

const PAGE_ICONS: Partial<Record<PageKey, string>> = {
  dashboard: "◎",
  "marketing-analytics": "📈",
  documents: "📄",
  "estimate-status": "⏳",
  calendar: "📅",
  schedule: "▧",
};

const GROUP_ICONS: Record<string, string> = {
  Dispatch: "▸",
  // "\uFE0E" after the phone asks for the plain text glyph, so the group
  // color can tint it -- without it iOS and Windows draw a red emoji
  // phone beside a teal rail.
  "Call Center": "☎\uFE0E",
  Staff: "👥",
  Production: "▦",
  Accounting: "▤",
};

const FALLBACK_ICON = "▪";

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
        tone: GROUP_TONES[page.group],
        items: [],
      };
      entries.push(openGroup);
    }

    openGroup.items.push({ label: page.label, href: page.href });
  }

  // Admin Settings is deliberately absent from PAGE_REGISTRY: it is not
  // role-visibility managed (AdminGate blocks it outright), so it has no
  // cell in that matrix and has to be appended here. Estimate Approvals
  // is the same shape -- Admin only, no Role Visibility cell -- and until
  // this link existed the page was reachable only by typing its URL,
  // which is how the approval switch went unfound.
  entries.push({
    type: "link",
    href: "/estimate-approvals",
    label: "Estimate Approvals",
    icon: "✓",
  });
  entries.push({ type: "link", href: "/settings", label: "Admin Settings", icon: "⚙" });
  return entries;
}

export const NAV: NavEntry[] = buildNav();

export { navEntryKey, sortNavEntries, type NavEntry, type NavGroupItem, type NavLinkItem };

// The phone layout's bottom tab bar and its More sheet (DECISIONS #089):
// which pages get a tab, which tab is lit, and how the rest of the menu
// is laid out behind More. Pure, so it is tested without a browser;
// src/app/(app)/phone-tab-bar.tsx and more-sheet.tsx draw it.

import type { NavEntry, NavTone } from "./data/types.ts";

/** A tab's and a More section's color: the department tones, plus one for
 *  the loose top-level pages and one for scheduling. */
export type MobileTone = NavTone | "home" | "schedule";

export type MobileIconName =
  | "home"
  | "gauge"
  | "chart"
  | "leads"
  | "tasks"
  | "inbox"
  | "contacts"
  | "assign"
  | "refund"
  | "dialer"
  | "calls"
  | "texts"
  | "report"
  | "trophy"
  | "clock"
  | "map"
  | "timesheet"
  | "board"
  | "jobs"
  | "contract"
  | "bill"
  | "collect"
  | "payment"
  | "percent"
  | "ledger"
  | "file"
  | "hourglass"
  | "calendar"
  | "schedule"
  | "settings"
  | "approve"
  | "dot";

export type MobileTab = {
  href: string;
  label: string;
  icon: MobileIconName;
  tone: MobileTone;
};

export const FALLBACK_PAGE_ICON: MobileIconName = "dot";

const PAGE_ICONS: Record<string, MobileIconName> = {
  "/": "home",
  "/dispatch-dashboard": "gauge",
  "/marketing-analytics": "chart",
  "/pipeline": "leads",
  "/tasks": "tasks",
  "/reply-inbox": "inbox",
  "/contacts": "contacts",
  "/appt-setter-assignments": "assign",
  "/lead-refunds": "refund",
  "/dial-queue": "dialer",
  "/call-reports": "calls",
  "/text-reports": "texts",
  "/appointment-reports": "report",
  "/salespeople": "trophy",
  "/time-clock": "clock",
  "/team-map": "map",
  "/timesheets": "timesheet",
  "/production": "board",
  "/projects": "jobs",
  "/contracts": "contract",
  "/bills": "bill",
  "/collect": "collect",
  "/payments": "payment",
  "/commissions": "percent",
  "/sales-commission": "percent",
  "/profit-loss": "ledger",
  "/estimates": "file",
  "/estimate-status": "hourglass",
  "/calendar": "calendar",
  "/schedule": "schedule",
  "/settings": "settings",
  "/estimate-approvals": "approve",
};

export function pageIcon(href: string): MobileIconName {
  return PAGE_ICONS[href] ?? FALLBACK_PAGE_ICON;
}

// Tab candidates, best first. The first four the person can open become
// tabs, so a role that cannot see a page never gets a dead tab and the
// next useful page takes its seat. The crew list leads with their jobs:
// a Field user's whole app is the job list and the clock.
const OFFICE_TABS: MobileTab[] = [
  { href: "/", label: "Home", icon: "home", tone: "home" },
  { href: "/pipeline", label: "Leads", icon: "leads", tone: "dispatch" },
  { href: "/schedule", label: "Schedule", icon: "schedule", tone: "schedule" },
  { href: "/production", label: "Jobs", icon: "board", tone: "production" },
  { href: "/estimates", label: "Estimates", icon: "file", tone: "accounting" },
  { href: "/contacts", label: "Contacts", icon: "contacts", tone: "dispatch" },
  { href: "/calendar", label: "Calendar", icon: "calendar", tone: "calls" },
  { href: "/projects", label: "Projects", icon: "jobs", tone: "production" },
  { href: "/tasks", label: "Tasks", icon: "tasks", tone: "dispatch" },
  { href: "/time-clock", label: "Time", icon: "clock", tone: "staff" },
];
const CREW_TABS: MobileTab[] = [
  // The time clock page is the crew's day: the clock, hours so far and
  // today's schedule (DECISIONS #090), so it is their Today.
  { href: "/time-clock", label: "Today", icon: "clock", tone: "staff" },
  { href: "/projects", label: "Jobs", icon: "jobs", tone: "production" },
  { href: "/schedule", label: "Schedule", icon: "schedule", tone: "schedule" },
  { href: "/calendar", label: "Calendar", icon: "calendar", tone: "calls" },
  { href: "/", label: "Home", icon: "home", tone: "home" },
  { href: "/production", label: "Board", icon: "board", tone: "production" },
];

/** Tabs beside More: at most four, only pages this person can open. */
export function mobileTabs(visibleHrefs: Iterable<string>, crew: boolean): MobileTab[] {
  const visible = new Set(visibleHrefs);
  return (crew ? CREW_TABS : OFFICE_TABS).filter((t) => visible.has(t.href)).slice(0, 4);
}

/** "/" lights only on the dashboard itself; any other tab lights on its
 *  page and the pages under it (a lead, a job), never on a neighbour
 *  that merely starts with the same letters. */
export function isTabActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

/** Every page in the menu, in menu order. */
export function navHrefs(nav: NavEntry[]): string[] {
  return nav.flatMap((e) => (e.type === "link" ? [e.href] : e.items.map((i) => i.href)));
}

export type MoreSection = {
  label: string;
  tone: MobileTone;
  items: { href: string; label: string; icon: MobileIconName }[];
};

/**
 * The menu behind More, as colored sections: the loose top-level pages
 * together first ("Main"), then each department in the order the
 * person's menu has them, wearing the same tone as in the sidebar.
 */
export function moreSections(nav: NavEntry[]): MoreSection[] {
  const main: MoreSection = { label: "Main", tone: "home", items: [] };
  const groups: MoreSection[] = [];
  for (const entry of nav) {
    if (entry.type === "link") {
      main.items.push({ href: entry.href, label: entry.label, icon: pageIcon(entry.href) });
    } else if (entry.items.length > 0) {
      groups.push({
        label: entry.label,
        tone: entry.tone ?? "home",
        items: entry.items.map((i) => ({ href: i.href, label: i.label, icon: pageIcon(i.href) })),
      });
    }
  }
  return main.items.length > 0 ? [main, ...groups] : groups;
}

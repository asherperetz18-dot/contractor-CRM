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

export const NAV: NavEntry[] = [
  { type: "link", href: "/", label: "Dashboard", icon: "◎" },
  {
    type: "group",
    label: "Dispatch (Leads Mgmt.)",
    icon: "▸",
    items: [
      { label: "Leads Pipeline", href: "/pipeline" },
      { label: "Dispatch Dashboard", comingSoon: true },
      { label: "Reply Inbox", comingSoon: true },
      { label: "Marketing Analytics", comingSoon: true },
      { label: "Contacts", comingSoon: true },
      { label: "Salespeople", comingSoon: true },
      { label: "Appt. Setter Assignments", comingSoon: true },
    ],
  },
  { type: "link", href: "/production", label: "Production", icon: "▦" },
  { type: "link", href: "/documents", label: "Estimates & Invoices", icon: "▤" },
  { type: "link", href: "/calendar", label: "Calendar", icon: "📅" },
  { type: "link", href: "/schedule", label: "Schedule", icon: "▧" },
  { type: "link", href: "/contracts", label: "Contracts", icon: "✎" },
  { type: "link", href: "/settings", label: "Admin Settings", icon: "⚙" },
];

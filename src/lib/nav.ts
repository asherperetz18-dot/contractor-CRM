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
    ],
  },
  { type: "link", href: "/production", label: "Production", icon: "▦" },
  { type: "link", href: "/documents", label: "Estimates & Invoices", icon: "▤" },
  { type: "link", href: "/calendar", label: "Calendar", icon: "📅" },
  { type: "link", href: "/schedule", label: "Schedule", icon: "▧" },
  { type: "link", href: "/contracts", label: "Contracts", icon: "✎" },
  { type: "link", href: "/settings", label: "Admin Settings", icon: "⚙" },
];

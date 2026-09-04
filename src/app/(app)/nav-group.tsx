"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import type { NavGroupItem } from "@/lib/nav";
import { NavLink } from "./nav-link";
import { useInboxCount } from "./use-inbox-count";

export function NavGroup({ group }: { group: NavGroupItem }) {
  const pathname = usePathname();
  const containsActive = group.items.some(
    (i) => i.href && pathname.startsWith(i.href)
  );
  const [open, setOpen] = useState(containsActive);

  // Texts waiting on a reply. Shown on the group header too, because
  // the group ships collapsed and a badge nobody can see isn't one.
  const inboxCount = useInboxCount();
  const hasInbox = group.items.some((i) => i.href === "/reply-inbox");

  return (
    <div className="nav-group">
      <div
        className={"nav-item" + (containsActive && !open ? " active" : "")}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="nav-icon">{group.icon}</span>
        {group.label}
        {/* Only while collapsed -- expanded, the sub-item right below
            carries it, and the same number twice reads as two piles. */}
        {hasInbox && inboxCount > 0 && !open && (
          <span className="nav-badge">{inboxCount}</span>
        )}
        <span className="nav-group-chevron">{open ? "▾" : "▸"}</span>
      </div>
      {open && (
        <div className="nav-group-items">
          {/* Same fetch-on-hover link as the top-level entries: an open
              group with five pages in it should not queue five prefetches
              ahead of the one click that is coming. */}
          {group.items.map((item) =>
            item.href ? (
              <NavLink key={item.label} href={item.href} className="nav-subitem">
                {item.label}
                {item.href === "/reply-inbox" && inboxCount > 0 && (
                  <span className="nav-badge">{inboxCount}</span>
                )}
              </NavLink>
            ) : (
              <div key={item.label} className="nav-subitem nav-subitem-disabled">
                {item.label}
                {item.comingSoon && <span className="nav-soon-tag">Soon</span>}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

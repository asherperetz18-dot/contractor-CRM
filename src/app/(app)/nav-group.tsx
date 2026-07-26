"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavGroupItem } from "@/lib/nav";

export function NavGroup({ group }: { group: NavGroupItem }) {
  const pathname = usePathname();
  const containsActive = group.items.some(
    (i) => i.href && pathname.startsWith(i.href)
  );
  const [open, setOpen] = useState(containsActive);

  return (
    <div className="nav-group">
      <div
        className={"nav-item" + (containsActive && !open ? " active" : "")}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="nav-icon">{group.icon}</span>
        {group.label}
        <span className="nav-group-chevron">{open ? "▾" : "▸"}</span>
      </div>
      {open && (
        <div className="nav-group-items">
          {group.items.map((item) =>
            item.href ? (
              <Link
                key={item.label}
                href={item.href}
                className={
                  "nav-subitem" +
                  (pathname.startsWith(item.href) ? " active" : "")
                }
              >
                {item.label}
              </Link>
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

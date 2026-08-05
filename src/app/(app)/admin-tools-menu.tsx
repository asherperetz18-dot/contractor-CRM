"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const ITEMS = [
  { label: "Admin Settings", icon: "⚙", href: "/settings" },
  // Admin role only -- Office users configure the company, they don't
  // get a readout of what each teammate has been doing all day.
  { label: "Team Activity", icon: "📈", href: "/settings/team-activity", adminOnly: true },
];

export function AdminToolsMenu({ isAdmin }: { isAdmin: boolean }) {
  const items = ITEMS.filter((it) => !it.adminOnly || isAdmin);
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <div className="quick-create-wrap">
      <button
        className="icon-btn topbar-icon-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label="Admin Tools"
        title="Admin Tools"
      >
        ⚙
      </button>
      {open && (
        <>
          <div className="quick-create-backdrop" onClick={() => setOpen(false)} />
          <div className="quick-create-menu">
            <div className="qc-group">
              <div className="qc-group-label">ADMIN TOOLS</div>
              {items.map((it) => (
                <div
                  key={it.label}
                  className="qc-item"
                  onClick={() => {
                    setOpen(false);
                    router.push(it.href);
                  }}
                >
                  {it.icon} {it.label}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

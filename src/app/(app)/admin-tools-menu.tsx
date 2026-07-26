"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const ITEMS = [
  { label: "Admin Settings", icon: "⚙", href: "/settings" },
  { label: "Team Activity", icon: "📈", href: "/settings/team-activity" },
];

export function AdminToolsMenu() {
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
              {ITEMS.map((it) => (
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

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const GROUPS = [
  {
    label: "Pipeline",
    items: [
      { label: "New Lead", href: "/pipeline?new=1" },
      { label: "New Appointment", href: "/schedule?new=1" },
    ],
  },
  {
    label: "Production",
    items: [{ label: "New Job", href: "/production?new=1" }],
  },
  {
    label: "Estimates & Invoices",
    items: [
      { label: "New Estimate", href: "/documents?new=1&type=Estimate" },
      { label: "New Invoice", href: "/documents?new=1&type=Invoice" },
    ],
  },
  {
    label: "Contracts",
    items: [{ label: "New Contract", href: "/contracts?new=1" }],
  },
];

export function QuickCreateMenu() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <div className="quick-create-wrap">
      <button
        className="btn-primary quick-create-btn"
        onClick={() => setOpen((o) => !o)}
      >
        + Quick Create
      </button>
      {open && (
        <>
          <div
            className="quick-create-backdrop"
            onClick={() => setOpen(false)}
          />
          <div className="quick-create-menu">
            {GROUPS.map((g) => (
              <div key={g.label} className="qc-group">
                <div className="qc-group-label">{g.label.toUpperCase()}</div>
                {g.items.map((it) => (
                  <div
                    key={it.label}
                    className="qc-item"
                    onClick={() => {
                      setOpen(false);
                      router.push(it.href);
                    }}
                  >
                    {it.label}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

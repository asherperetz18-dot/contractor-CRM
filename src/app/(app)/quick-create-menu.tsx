"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type QuickCreateLabels = {
  appointment: string;
  job: string;
  estimatesGroup: string;
  estimate: string;
  contractsGroup: string;
  contract: string;
};

// In the company's own words (DECISIONS #125): "New Service Call",
// "New Quote". The labels come from lib/staff-words.ts via the layout.
function groupsFor(l: QuickCreateLabels) {
  return [
    {
      label: "Pipeline",
      // A contact is anyone (a bought-list name, a walk-in); a lead must
      // come from a real lead source, so New Lead asks for one
      // (DECISIONS #156).
      items: [
        { label: "New Contact", href: "/pipeline?new=1" },
        { label: "New Lead", href: "/pipeline?new=lead" },
        { label: l.appointment, href: "/schedule?new=1" },
      ],
    },
    {
      label: "Production",
      items: [{ label: l.job, href: "/production?new=1" }],
    },
    {
      label: l.estimatesGroup,
      items: [
        { label: l.estimate, href: "/estimates?new=1" },
        { label: "New Invoice", href: "/estimates?new=invoice" },
      ],
    },
    {
      label: l.contractsGroup,
      items: [{ label: l.contract, href: "/contracts?new=1" }],
    },
  ];
}

export function QuickCreateMenu({ labels }: { labels: QuickCreateLabels }) {
  const GROUPS = groupsFor(labels);
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <div className="quick-create-wrap">
      <button
        className="btn-primary quick-create-btn"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="qc-label-long">+ Quick Create</span>
        <span className="qc-label-short" aria-hidden="true">+</span>
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

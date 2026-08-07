"use client";

import { useState } from "react";
import {
  leadDisplayName,
  mapsUrl,
  money,
  type Lead,
  type LeadWarnings,
} from "@/lib/data/types";

function WarningBadges({ warnings }: { warnings: LeadWarnings | undefined }) {
  if (!warnings) return null;
  return (
    <div className="ur-role-badges">
      {warnings.noAppts && <span className="source-tag">No Appts</span>}
      {warnings.noNotes && <span className="source-tag">No Notes</span>}
      {warnings.noTasks && <span className="source-tag">No Tasks</span>}
      {warnings.staleNotes && <span className="source-tag">Stale Notes</span>}
      {warnings.overdueTaskDays !== null && (
        <span className="stale-tag">
          Task overdue by {warnings.overdueTaskDays}d
        </span>
      )}
    </div>
  );
}

function DigestSection({
  title,
  count,
  hint,
  leads,
  warningsByLead,
  repName,
  onOpenLead,
  defaultOpen,
}: {
  title: string;
  count: number;
  hint: string;
  leads: Lead[];
  warningsByLead: Map<string, LeadWarnings>;
  repName: (id: string | null) => string;
  onOpenLead: (lead: Lead) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);

  return (
    <div className="dash-panel" style={{ marginBottom: 14 }}>
      <div
        className="cp-tz-head"
        style={{ cursor: "pointer" }}
        onClick={() => setOpen((o) => !o)}
      >
        <span>
          {title} <span className="count-pill">{count}</span>
        </span>
        <span className="filter-label">{open ? "▲" : "▼"}</span>
      </div>
      <p className="module-sub" style={{ margin: "4px 0 10px" }}>
        {hint}
      </p>
      {open &&
        (leads.length === 0 ? (
          <p className="empty-hint">Nothing here.</p>
        ) : (
          <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Contact</th>
                <th>Address</th>
                <th>Pipeline Stage</th>
                <th>Warnings</th>
                <th>Assigned Rep</th>
                <th className="right">Value</th>
              </tr>
            </thead>
            <tbody>
              {leads.slice(0, 25).map((l) => (
                <tr key={l.id} onClick={() => onOpenLead(l)}>
                  <td>{leadDisplayName(l)}</td>
                  <td>
                    {l.address ? (
                      <a
                        href={mapsUrl(l.address)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {l.address}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{l.stage}</td>
                  <td>
                    <WarningBadges warnings={warningsByLead.get(l.id)} />
                  </td>
                  <td>{repName(l.assigned_to)}</td>
                  <td className="right mono">{money(l.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        ))}
      {open && leads.length > 25 && (
        <p className="hint-note">Showing 25 of {leads.length}.</p>
      )}
    </div>
  );
}

export function AttentionDigest({
  followUpsDue,
  coldLeads,
  warningsByLead,
  repName,
  onOpenLead,
}: {
  followUpsDue: Lead[];
  coldLeads: Lead[];
  warningsByLead: Map<string, LeadWarnings>;
  repName: (id: string | null) => string;
  onOpenLead: (lead: Lead) => void;
}) {
  return (
    <div style={{ marginBottom: 4 }}>
      <DigestSection
        title="Follow-ups Due"
        count={followUpsDue.length}
        hint="Leads with a task overdue or due today"
        leads={followUpsDue}
        warningsByLead={warningsByLead}
        repName={repName}
        onOpenLead={onOpenLead}
      />
      <DigestSection
        title="Cold Leads"
        count={coldLeads.length}
        hint="No appointments on record · stale notes or expired tasks"
        leads={coldLeads}
        warningsByLead={warningsByLead}
        repName={repName}
        onOpenLead={onOpenLead}
      />
    </div>
  );
}

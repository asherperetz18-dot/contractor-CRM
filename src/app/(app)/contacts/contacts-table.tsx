"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  STAGE_COLOR,
  leadDisplayName,
  money,
  type Lead,
  type Profile,
} from "@/lib/data/types";
import { LeadForm } from "../pipeline/lead-form";

export function ContactsTable({
  leads,
  reps,
  canWrite,
}: {
  leads: Lead[];
  reps: Profile[];
  canWrite: boolean;
}) {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Lead | null>(null);

  const totalContacts = leads.length;
  const withOpenLeads = leads.filter((l) => !["Won", "Lost", "DNC"].includes(l.stage)).length;
  const noSetterAssigned = leads.filter((l) => !l.assigned_to).length;

  function repName(id: string | null) {
    if (!id) return "Unassigned";
    return reps.find((r) => r.id === id)?.name || "Unassigned";
  }

  const q = search.trim().toLowerCase();
  const filtered = q
    ? leads.filter((l) =>
        `${leadDisplayName(l)} ${l.email ?? ""} ${l.phone ?? ""} ${l.address ?? ""}`
          .toLowerCase()
          .includes(q)
      )
    : leads;

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Contacts</h1>
          <p className="module-sub">Every contact across the pipeline</p>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card stat-static">
          <div className="stat-value mono">{totalContacts}</div>
          <div className="stat-label">Total Contacts</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{withOpenLeads}</div>
          <div className="stat-label">With Open Leads</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{noSetterAssigned}</div>
          <div className="stat-label">No Rep Assigned</div>
        </div>
      </div>

      <input
        className="ur-search"
        style={{ marginBottom: 16, maxWidth: 420 }}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search name, email, phone, or address..."
      />

      {filtered.length === 0 ? (
        <div className="empty-state">
          <p className="empty-label">No contacts match</p>
          <p className="empty-hint">Try a different search term.</p>
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Contact</th>
              <th>Address</th>
              <th>Phone</th>
              <th>Source</th>
              <th>Assigned Rep</th>
              <th>Stage</th>
              <th className="right">Value</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((l) => (
              <tr key={l.id} onClick={() => setEditing(l)}>
                <td>
                  <div className="ur-name">{leadDisplayName(l)}</div>
                  {l.email && <div className="ur-add-phone">{l.email}</div>}
                </td>
                <td>{l.address || "—"}</td>
                <td>{l.phone || "—"}</td>
                <td>{l.source || "—"}</td>
                <td>{repName(l.assigned_to)}</td>
                <td>
                  <Badge color={STAGE_COLOR[l.stage] ?? STAGE_COLOR.Other}>
                    {l.stage}
                  </Badge>
                </td>
                <td className="right mono">{money(l.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && (
        <LeadForm
          lead={editing}
          reps={reps}
          readOnly={!canWrite}
          onCancel={() => setEditing(null)}
          onSaved={() => setEditing(null)}
          onDeleted={() => setEditing(null)}
        />
      )}
    </div>
  );
}

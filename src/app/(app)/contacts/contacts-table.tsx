"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  leadDisplayName,
  mapsUrl,
  money,
  stageColor,
  type CalendarRow,
  type Lead,
  type LeadFile,
  type LeadNote,
  type LeadSourceRow,
  type PipelineStageRow,
  type ProjectTypeRow,
  type Profile,
} from "@/lib/data/types";
import { LeadForm } from "../pipeline/lead-form";

export function ContactsTable({
  leads,
  notes,
  files,
  reps,
  stages,
  calendars,
  projectTypes,
  sources,
  canWrite,
  canDelete,
}: {
  leads: Lead[];
  notes: LeadNote[];
  files: LeadFile[];
  reps: Profile[];
  stages: PipelineStageRow[];
  calendars: CalendarRow[];
  projectTypes: ProjectTypeRow[];
  sources: LeadSourceRow[];
  canWrite: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Lead | null>(null);
  const [consumedOpenId, setConsumedOpenId] = useState<string | null>(null);

  const openLeadId = searchParams.get("openLead");
  if (openLeadId && openLeadId !== consumedOpenId) {
    setConsumedOpenId(openLeadId);
    const found = leads.find((l) => l.id === openLeadId);
    if (found) setEditing(found);
  }

  useEffect(() => {
    if (searchParams.get("openLead")) {
      router.replace("/contacts", { scroll: false });
    }
  }, [searchParams, router]);

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
        <div className="table-scroll">
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
                <td>{l.phone || "—"}</td>
                <td>{l.source || "—"}</td>
                <td>{repName(l.assigned_to)}</td>
                <td>
                  <Badge color={stageColor(stages, l.stage)}>
                    {l.stage}
                  </Badge>
                </td>
                <td className="right mono">{money(l.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {editing && (
        <LeadForm
          lead={editing}
          reps={reps}
          stages={stages}
          calendars={calendars}
          projectTypes={projectTypes}
          sources={sources}
          notes={notes.filter((n) => n.lead_id === editing.id)}
          files={files.filter((f) => f.lead_id === editing.id)}
          readOnly={!canWrite}
          canDelete={canDelete}
          onCancel={() => setEditing(null)}
          onSaved={() => setEditing(null)}
          onDeleted={() => setEditing(null)}
        />
      )}
    </div>
  );
}

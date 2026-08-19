"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  leadDisplayName,
  mapsUrl,
  money,
  normalizePhone,
  stageColor,
  type CalendarRow,
  type Lead,
  type LeadTask,
  type LeadFile,
  type LeadNote,
  type LeadSourceRow,
  type PipelineStageRow,
  type ProjectTypeRow,
  type Profile,
} from "@/lib/data/types";
import { LeadForm } from "../pipeline/lead-form";
import type { LeadEstimateIndex } from "@/lib/data/lead-estimate-index";
import type { DispatcherPickerBootstrap } from "../calendar/dispatcher-picker";
import { safeInternalPath } from "@/lib/safe-path";

/**
 * One contact row, memoized. Clicking a row re-renders the table (the
 * click opens the contact window via state), and re-reconciling ~1,500
 * rows before the window paints is where the open used to spend its
 * time. Stable props mean that render now skips every row.
 */
const ContactRow = memo(function ContactRow({
  lead,
  repLabel,
  color,
  onOpen,
}: {
  lead: Lead;
  repLabel: string;
  color: string;
  onOpen: (lead: Lead) => void;
}) {
  return (
    <tr onClick={() => onOpen(lead)}>
      <td>
        <div className="ur-name">{leadDisplayName(lead)}</div>
        {lead.email && <div className="ur-add-phone">{lead.email}</div>}
      </td>
      <td>
        {lead.address ? (
          <a
            href={mapsUrl(lead.address)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            {lead.address}
          </a>
        ) : (
          "—"
        )}
      </td>
      <td>{lead.phone || "—"}</td>
      <td>{lead.source || "—"}</td>
      <td>{repLabel}</td>
      <td>
        <Badge color={color}>{lead.stage}</Badge>
      </td>
      <td className="right mono">{money(lead.value)}</td>
    </tr>
  );
});

export function ContactsTable({
  leads,
  tasks,
  notes,
  files,
  reps,
  stages,
  calendars,
  projectTypes,
  sources,
  canWrite,
  canDelete,
  isAdmin,
  estimateIndex,
  dispatcherPicker,
}: {
  leads: Lead[];
  tasks: LeadTask[];
  notes: LeadNote[];
  files: LeadFile[];
  reps: Profile[];
  stages: PipelineStageRow[];
  calendars: CalendarRow[];
  projectTypes: ProjectTypeRow[];
  sources: LeadSourceRow[];
  canWrite: boolean;
  canDelete: boolean;
  isAdmin: boolean;
  estimateIndex: LeadEstimateIndex;
  dispatcherPicker?: DispatcherPickerBootstrap;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Lead | null>(null);
  const [consumedOpenId, setConsumedOpenId] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState<string | null>(null);

  const openLeadId = searchParams.get("openLead");
  if (openLeadId && openLeadId !== consumedOpenId) {
    setConsumedOpenId(openLeadId);
    // Where to go back to once they close the contact. Captured now,
    // because the effect below strips the URL down to /contacts and the
    // page would otherwise have no memory of where the user came from --
    // closing a lead opened from Marketing Analytics stranded them in
    // Dispatch › Contacts, which looks like the app navigated on its own.
    setReturnTo(safeInternalPath(searchParams.get("from")));
    const found = leads.find((l) => l.id === openLeadId);
    if (found) setEditing(found);
  } else if (!openLeadId && consumedOpenId) {
    // Param has been stripped from the URL (below) -- clear the guard so
    // a future deep link to this same lead (e.g. searching for it again)
    // can reopen it. Without this, consumedOpenId stays set forever and
    // silently blocks every subsequent open of that lead until a full
    // page refresh remounts the component.
    setConsumedOpenId(null);
  }

  useEffect(() => {
    if (searchParams.get("openLead")) {
      router.replace("/contacts", { scroll: false });
    }
  }, [searchParams, router]);

  /**
   * Close the contact, returning to the page that opened it.
   *
   * Only when it was opened by a deep link carrying `from`. A contact
   * opened by clicking a row on this page has nowhere else to go, and
   * navigating away from Contacts there would be the same bug in
   * reverse.
   */
  function closeLead() {
    setEditing(null);
    if (returnTo) {
      const target = returnTo;
      setReturnTo(null);
      router.push(target);
    }
  }

  const totalContacts = leads.length;
  // Memoized alongside the per-lead indexes below: this component
  // re-renders when a row is clicked to open the contact, and with the
  // whole book on screen every unmemoized pass over it happens between
  // the click and the window painting.
  const { withOpenLeads, noSetterAssigned } = useMemo(
    () => ({
      withOpenLeads: leads.filter((l) => !["Won", "Lost", "DNC"].includes(l.stage)).length,
      noSetterAssigned: leads.filter((l) => !l.assigned_to).length,
    }),
    [leads]
  );

  // O(1) lookups when opening a contact, instead of filtering the
  // company-wide arrays inline in the LeadForm props -- which re-ran on
  // every render and handed the form fresh array identities each time.
  const tasksByLead = useMemo(() => {
    const map = new Map<string, LeadTask[]>();
    for (const t of tasks) {
      const list = map.get(t.lead_id) ?? [];
      list.push(t);
      map.set(t.lead_id, list);
    }
    return map;
  }, [tasks]);
  const notesByLead = useMemo(() => {
    const map = new Map<string, LeadNote[]>();
    for (const n of notes) {
      const list = map.get(n.lead_id) ?? [];
      list.push(n);
      map.set(n.lead_id, list);
    }
    return map;
  }, [notes]);
  const filesByLead = useMemo(() => {
    const map = new Map<string, LeadFile[]>();
    for (const f of files) {
      const list = map.get(f.lead_id) ?? [];
      list.push(f);
      map.set(f.lead_id, list);
    }
    return map;
  }, [files]);

  /**
   * Contacts that look like the same person twice.
   *
   * Grouped on the primary phone's last ten digits and on the email,
   * because that is exactly how the CSV importer warns on the way in --
   * these are the ones that got in before that warning existed. Review
   * only: each row opens the contact, and deleting the redundant one
   * happens there, where the full record is visible.
   */
  const duplicateGroups = useMemo(() => {
    const groups: { key: string; kind: "phone" | "email"; members: Lead[] }[] = [];
    const byPhone = new Map<string, Lead[]>();
    const byEmail = new Map<string, Lead[]>();
    for (const l of leads) {
      const p = l.phone ? normalizePhone(l.phone) : "";
      if (p.length === 10) byPhone.set(p, [...(byPhone.get(p) ?? []), l]);
      const e = (l.email ?? "").trim().toLowerCase();
      if (e) byEmail.set(e, [...(byEmail.get(e) ?? []), l]);
    }
    for (const [key, members] of byPhone) if (members.length > 1) groups.push({ key, kind: "phone", members });
    // An email group that is just a phone group again adds noise, not
    // information -- only report it when it names somebody new.
    const inPhoneGroups = new Set(groups.flatMap((g) => g.members.map((m) => m.id)));
    for (const [key, members] of byEmail)
      if (members.length > 1 && members.some((m) => !inPhoneGroups.has(m.id)))
        groups.push({ key, kind: "email", members });
    return groups.sort((a, b) => b.members.length - a.members.length);
  }, [leads]);
  const [showDuplicates, setShowDuplicates] = useState(false);

  const repById = useMemo(
    () => new Map(reps.map((r) => [r.id, r.name || "Unassigned"])),
    [reps]
  );
  function repName(id: string | null) {
    if (!id) return "Unassigned";
    return repById.get(id) || "Unassigned";
  }

  const q = search.trim().toLowerCase();
  const qDigits = q.replace(/\D/g, "");
  const filtered = useMemo(
    () =>
      q
        ? leads.filter((l) => {
            const textMatch = `${leadDisplayName(l)} ${l.email ?? ""} ${l.phone ?? ""} ${l.address ?? ""}`
              .toLowerCase()
              .includes(q);
            const phoneMatch =
              qDigits.length >= 3 && !!l.phone && normalizePhone(l.phone).includes(qDigits);
            return textMatch || phoneMatch;
          })
        : leads,
    [leads, q, qDigits]
  );

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

      {duplicateGroups.length > 0 && (
        <div className="dup-banner">
          <span>
            ⚠ {duplicateGroups.length} possible duplicate{" "}
            {duplicateGroups.length === 1 ? "group" : "groups"} — contacts sharing a phone number
            or email.
          </span>
          <button className="btn-ghost small" onClick={() => setShowDuplicates((v) => !v)}>
            {showDuplicates ? "Hide" : "Review"}
          </button>
        </div>
      )}

      {showDuplicates && (
        <div className="dup-panel">
          {duplicateGroups.map((g) => (
            <div key={g.kind + g.key} className="dup-group">
              <div className="dup-group-head">
                {g.kind === "phone" ? "📞 " : "✉ "}
                <span className="mono">{g.kind === "phone" ? g.key.replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3") : g.key}</span>
                {" · "}
                {g.members.length} contacts
              </div>
              {g.members.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className="dup-member"
                  onClick={() => setEditing(l)}
                  title="Open this contact — delete the redundant one from its card"
                >
                  <span className="ur-name">{leadDisplayName(l)}</span>
                  <span className="dup-member-meta">
                    {l.stage}
                    {Number(l.value) > 0 ? ` · ${money(l.value)}` : ""}
                    {l.email ? ` · ${l.email}` : ""}
                  </span>
                </button>
              ))}
            </div>
          ))}
          <p className="hint-note">
            Open each contact and keep the one with the real history — notes, appointments,
            estimates. Deleting the redundant copy happens on its card, where you can see what
            it holds first.
          </p>
        </div>
      )}

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
              <ContactRow
                key={l.id}
                lead={l}
                repLabel={repName(l.assigned_to)}
                color={stageColor(stages, l.stage)}
                onOpen={setEditing}
              />
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
          tasks={tasksByLead.get(editing.id) ?? []}
          notes={notesByLead.get(editing.id) ?? []}
          files={filesByLead.get(editing.id) ?? []}
          readOnly={!canWrite}
          canDelete={canDelete}
          isAdmin={isAdmin}
          estimateIndex={estimateIndex}
          dispatcherPicker={dispatcherPicker}
          onCancel={closeLead}
          onSaved={closeLead}
          onDeleted={closeLead}
        />
      )}
    </div>
  );
}

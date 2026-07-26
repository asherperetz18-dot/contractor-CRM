"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  leadDisplayName,
  type Lead,
  type Profile,
  type SetterContact,
} from "@/lib/data/types";
import { assignSetterContact, unassignSetterContact } from "@/lib/actions/setter-contacts";

export function SetterAssignments({
  reps,
  leads,
  assignments,
  canWrite,
}: {
  reps: Profile[];
  leads: Lead[];
  assignments: SetterContact[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState(false);

  const leadById = new Map(leads.map((l) => [l.id, l]));

  function assignmentsFor(setterId: string) {
    return assignments.filter((a) => a.setter_id === setterId);
  }

  async function handleAssign(setterId: string, leadId: string) {
    setPending(true);
    await assignSetterContact(setterId, leadId);
    setPending(false);
    setSearch("");
    router.refresh();
  }

  async function handleUnassign(id: string) {
    setPending(true);
    await unassignSetterContact(id);
    setPending(false);
    router.refresh();
  }

  const q = search.trim().toLowerCase();

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Appt. Setter Assignments</h1>
          <p className="module-sub">
            Manage which contacts each appointment setter is assigned to
          </p>
        </div>
      </div>

      {reps.length === 0 ? (
        <div className="empty-state">
          <p className="empty-label">No active team members yet</p>
        </div>
      ) : (
        <div className="user-list">
          {reps.map((rep) => {
            const assigned = assignmentsFor(rep.id);
            const isOpen = expanded === rep.id;
            const isAdding = addingFor === rep.id;
            const assignedLeadIds = new Set(assigned.map((a) => a.lead_id));
            const candidates = q
              ? leads
                  .filter((l) => !assignedLeadIds.has(l.id))
                  .filter((l) => leadDisplayName(l).toLowerCase().includes(q))
                  .slice(0, 8)
              : [];

            return (
              <div key={rep.id} className="cp-card" style={{ maxWidth: "none" }}>
                <div
                  className="cp-tz-head"
                  style={{ cursor: "pointer" }}
                  onClick={() => setExpanded(isOpen ? null : rep.id)}
                >
                  <span>
                    {rep.name || rep.email}{" "}
                    <span className="ur-add-phone">{rep.email}</span>
                  </span>
                  <span className="filter-label">
                    {assigned.length} contact{assigned.length === 1 ? "" : "s"}{" "}
                    {isOpen ? "▲" : "▼"}
                  </span>
                </div>

                {isOpen && (
                  <>
                    {assigned.length === 0 ? (
                      <p className="empty-hint">No contacts assigned.</p>
                    ) : (
                      <ul className="dash-list">
                        {assigned.map((a) => {
                          const lead = leadById.get(a.lead_id);
                          return (
                            <li key={a.id}>
                              <span style={{ flex: 1 }}>
                                {lead ? leadDisplayName(lead) : "(deleted contact)"}
                              </span>
                              {canWrite && (
                                <button
                                  type="button"
                                  className="icon-btn"
                                  onClick={() => handleUnassign(a.id)}
                                  disabled={pending}
                                  aria-label="Remove"
                                >
                                  ✕
                                </button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    {canWrite &&
                      (isAdding ? (
                        <div style={{ marginTop: 10 }}>
                          <input
                            className="ur-search"
                            autoFocus
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search contacts to add..."
                          />
                          {candidates.length > 0 && (
                            <div className="contact-match-list">
                              {candidates.map((l) => (
                                <div
                                  key={l.id}
                                  className="contact-match-row"
                                  onClick={() => handleAssign(rep.id, l.id)}
                                >
                                  {leadDisplayName(l)}
                                  {l.address ? ` — ${l.address}` : ""}
                                </div>
                              ))}
                            </div>
                          )}
                          <button
                            type="button"
                            className="btn-ghost small"
                            onClick={() => {
                              setAddingFor(null);
                              setSearch("");
                            }}
                          >
                            Done
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="btn-ghost small"
                          onClick={() => setAddingFor(rep.id)}
                        >
                          + Add contacts
                        </button>
                      ))}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

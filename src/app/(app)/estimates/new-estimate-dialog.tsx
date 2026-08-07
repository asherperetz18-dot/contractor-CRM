"use client";

import { useState, useTransition } from "react";
import { createEstimate } from "@/lib/actions/estimates";
import type { EstimateLead } from "./estimates-view";

// Mirrors the reference product's create flow, which starts by linking to
// an existing lead and auto-filling the customer from it. Every estimate
// belongs to a lead here -- there is no free-floating document.
export function NewEstimateDialog({
  leads,
  onClose,
  onCreated,
}: {
  leads: EstimateLead[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<EstimateLead | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const needle = query.trim().toLowerCase();
  const matches = needle
    ? leads
        .filter((l) => {
          const haystack = [l.first_name, l.last_name, l.email, l.address]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return haystack.includes(needle);
        })
        .slice(0, 8)
    : [];

  function nameOf(l: EstimateLead) {
    return [l.first_name, l.last_name].filter(Boolean).join(" ").trim() || "Unnamed lead";
  }

  function submit() {
    if (!selected) return setError("Pick a lead first.");
    if (!title.trim()) return setError("Give the estimate a title.");
    setError(null);
    startTransition(async () => {
      const res = await createEstimate(selected.id, title);
      if (res.error) return setError(res.error);
      if (res.id) onCreated(res.id);
    });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal est-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">Create New Estimate</h2>
        <p className="modal-sub">Link this estimate to an existing lead.</p>

        {selected ? (
          <div className="est-selected-lead">
            <div>
              <div className="ur-name">{nameOf(selected)}</div>
              <div className="ur-add-phone">{selected.address || selected.email || "—"}</div>
            </div>
            <button className="btn-ghost" onClick={() => setSelected(null)}>
              Change
            </button>
          </div>
        ) : (
          <>
            <input
              className="est-search"
              autoFocus
              placeholder="Search leads by name, contact, or address…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {needle && matches.length === 0 && (
              <p className="modal-sub">No leads match that.</p>
            )}
            <div className="est-lead-results">
              {matches.map((l) => (
                <button key={l.id} className="est-lead-result" onClick={() => setSelected(l)}>
                  <div className="ur-name">{nameOf(l)}</div>
                  <div className="ur-add-phone">{l.address || l.email || "—"}</div>
                </button>
              ))}
            </div>
          </>
        )}

        {selected && (
          <label className="field">
            <span className="field-label">Title</span>
            <input
              className="est-title-input"
              autoFocus
              placeholder="e.g. Kitchen remodel, New roof"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
          </label>
        )}

        {error && <p className="error-note">{error}</p>}

        <div className="modal-actions">
          <button className="btn-ghost" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit} disabled={pending || !selected}>
            {pending ? "Creating…" : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createEstimate } from "@/lib/actions/estimates";
import { searchEstimateLeads, type EstimateLeadMatch } from "@/lib/actions/lead-search";

// Mirrors the reference product's create flow, which starts by linking to
// an existing lead and auto-filling the customer from it. Every estimate
// belongs to a lead here -- there is no free-floating document.
//
// The lead search runs server-side (searchEstimateLeads): this dialog
// used to filter an array of every lead in the company, which is why the
// estimates page shipped 79k contacts to draw a few dozen documents.
// Same debounce-and-discard idiom as the topbar's Search for Anything.
export function NewEstimateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<EstimateLeadMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<EstimateLeadMatch | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function handleQuery(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const q = value.trim();
    if (q.length < 2) {
      setSearching(false);
      setMatches([]);
      return;
    }

    setSearching(true);
    const requestId = ++requestIdRef.current;
    debounceRef.current = setTimeout(() => {
      searchEstimateLeads(q).then((found) => {
        if (requestIdRef.current !== requestId) return;
        setMatches(found);
        setSearching(false);
      });
    }, 300);
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
              <div className="ur-name">{selected.label}</div>
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
              onChange={(e) => handleQuery(e.target.value)}
            />
            {query.trim().length >= 2 && !searching && matches.length === 0 && (
              <p className="modal-sub">No leads match that.</p>
            )}
            <div className="est-lead-results">
              {matches.map((l) => (
                <button key={l.id} className="est-lead-result" onClick={() => setSelected(l)}>
                  <div className="ur-name">{l.label}</div>
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

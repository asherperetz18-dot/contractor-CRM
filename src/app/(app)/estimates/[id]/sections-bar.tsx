"use client";

import { useState, useTransition } from "react";
import { moneyCents, type EstimateGroup } from "@/lib/data/types";
import {
  createEstimateGroup,
  deleteEstimateGroup,
  updateEstimateGroup,
} from "@/lib/actions/estimate-groups";

/**
 * Sections on an estimate, and what each one comes to.
 *
 * The subtotals are computed from the rows on screen rather than from
 * what is saved, so a price typed a moment ago is reflected immediately.
 * A section total that lags behind the line above it reads as a bug even
 * when the saved figure is right.
 */
export function SectionsBar({
  estimateId,
  groups,
  subtotals,
  locked,
  onChanged,
}: {
  estimateId: string;
  groups: EstimateGroup[];
  /** Live totals by group id, from the builder's current rows. */
  subtotals: Map<string, number>;
  locked: boolean;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  if (locked && groups.length === 0) return null;

  return (
    <div className="est-sections">
      <div className="est-sections-head">
        <span className="est-margin-label">Sections</span>
        {!locked && (
          <button
            className="btn-ghost small"
            onClick={() => setAdding((a) => !a)}
            disabled={pending}
          >
            {adding ? "Cancel" : "+ Add section"}
          </button>
        )}
      </div>

      {groups.length === 0 ? (
        <p className="est-tax-note">
          No sections. Every line reads as one list &mdash; which is right for a small job, and
          hard going on a whole-house remodel.
        </p>
      ) : (
        <div className="est-section-chips">
          {groups.map((g) => (
            <div key={g.id} className="est-section-chip">
              {locked ? (
                <span className="ur-name">{g.name}</span>
              ) : (
                <input
                  className="est-item-name"
                  defaultValue={g.name}
                  disabled={pending}
                  onBlur={(e) => {
                    if (e.target.value === g.name) return;
                    const next = e.target.value;
                    startTransition(async () => {
                      const res = await updateEstimateGroup(g.id, { name: next });
                      if (res.error) return setError(res.error);
                      onChanged();
                    });
                  }}
                />
              )}
              <span className="mono">{moneyCents(subtotals.get(g.id) ?? 0)}</span>
              {!locked && (
                <button
                  className="btn-ghost est-row-remove"
                  aria-label={`Remove section ${g.name}`}
                  title="Removes the heading. The lines inside stay on the estimate."
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const res = await deleteEstimateGroup(g.id);
                      if (res.error) return setError(res.error);
                      onChanged();
                    })
                  }
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div className="form-row" style={{ marginTop: 8 }}>
          <input
            className="est-item-name"
            placeholder="Section name (e.g. Kitchen)"
            value={name}
            autoFocus
            disabled={pending}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            className="btn-primary small"
            disabled={pending || !name.trim()}
            onClick={() =>
              startTransition(async () => {
                const res = await createEstimateGroup(estimateId, name);
                if (res.error) return setError(res.error);
                setName("");
                setAdding(false);
                onChanged();
              })
            }
          >
            {pending ? "Adding…" : "Add"}
          </button>
        </div>
      )}

      {error && <p className="error-note">{error}</p>}
    </div>
  );
}

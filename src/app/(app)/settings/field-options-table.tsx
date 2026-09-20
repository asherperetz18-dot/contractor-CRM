"use client";

import { moveInList } from "@/lib/data/move-in-list";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/components/ui/field";
import {
  createFieldOption,
  deleteFieldOption,
  renameFieldOption,
  reorderFieldOptions,
  setLeadSourceDefaultCost,
  setProjectTypeWeatherSensitive,
  type OptionTable,
} from "@/lib/actions/lead-field-options";
import { leadCostInputValue } from "@/lib/data/lead-source-cost";
import type { LeadSourceRow, ProjectTypeRow } from "@/lib/data/types";

type Row = ProjectTypeRow | LeadSourceRow;

export function FieldOptionsTable({
  table,
  title,
  description,
  itemLabel,
  rows,
  showWeatherSensitive,
  leadCost,
}: {
  table: OptionTable;
  title: string;
  description: string;
  itemLabel: string;
  rows: Row[];
  /** Project types only: scopes the rain-forecast alert to relevant work. */
  showWeatherSensitive?: boolean;
  /**
   * Lead sources only: a "Lead cost" box per source. The company default
   * is shown as the placeholder of every blank box, so the row reads as
   * what a lead from there will actually cost.
   */
  leadCost?: { companyDefault: number | null };
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleToggleWeatherSensitive(id: string, value: boolean) {
    const result = await setProjectTypeWeatherSensitive(id, value);
    if (result.error) {
      setError(result.error);
      return;
    }
    refresh();
  }

  function refresh() {
    startTransition(() => router.refresh());
  }

  function handleDrop(targetId: string) {
    setDragOverId(null);
    if (!draggedId || draggedId === targetId) {
      setDraggedId(null);
      return;
    }
    const ids = rows.map((r) => r.id);
    const fromIndex = ids.indexOf(draggedId);
    const toIndex = ids.indexOf(targetId);
    ids.splice(fromIndex, 1);
    ids.splice(toIndex, 0, draggedId);
    setDraggedId(null);
    startTransition(async () => {
      await reorderFieldOptions(table, ids);
      router.refresh();
    });
  }

  // The ▲/▼ buttons on touch screens: one swap with a neighbour, saved
  // through the same action the drag uses.
  function handleMove(index: number, delta: -1 | 1) {
    const ids = moveInList(rows.map((x) => x.id), index, delta);
    if (!ids) return;
    startTransition(async () => {
      await reorderFieldOptions(table, ids);
      router.refresh();
    });
  }

  async function handleCreate() {
    if (!newName.trim()) {
      setError(`${itemLabel} name is required.`);
      return;
    }
    setPending(true);
    setError("");
    const result = await createFieldOption(table, newName);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setNewName("");
    setShowCreate(false);
    refresh();
  }

  function startRename(row: Row) {
    setRenamingId(row.id);
    setRenameValue(row.name);
    setError("");
  }

  async function handleRename(id: string) {
    if (!renameValue.trim()) {
      setError(`${itemLabel} name is required.`);
      return;
    }
    setPending(true);
    setError("");
    const result = await renameFieldOption(table, id, renameValue);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setRenamingId(null);
    refresh();
  }

  async function handleDelete(row: Row) {
    if (!confirm(`Delete "${row.name}"?`)) return;
    setError("");
    const result = await deleteFieldOption(table, row.id);
    if (result.error) {
      setError(result.error);
      return;
    }
    refresh();
  }

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">{title}</h1>
          <p className="module-sub">{description}</p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          + Add {itemLabel}
        </button>
      </div>

      {error && <p className="error-note">{error}</p>}

      <table className="data-table">
        <thead>
          <tr>
            <th></th>
            <th>#</th>
            <th>{itemLabel}</th>
            {showWeatherSensitive && <th>Rain alerts</th>}
            {leadCost && <th>Lead cost</th>}
            <th className="right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.id}
              draggable
              onDragStart={() => setDraggedId(r.id)}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverId(r.id);
              }}
              onDragLeave={() => setDragOverId((cur) => (cur === r.id ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(r.id);
              }}
              className={
                (draggedId === r.id ? "stage-row-dragging " : "") +
                (dragOverId === r.id && draggedId !== r.id ? "stage-row-dragover" : "")
              }
            >
              <td className="stage-drag-handle" title="Drag to reorder">
                <span className="drag-grip">⠿</span>
                <span className="reorder-btns">
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => handleMove(i, -1)}
                    disabled={i === 0}
                    aria-label={`Move ${r.name} up`}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => handleMove(i, 1)}
                    disabled={i === rows.length - 1}
                    aria-label={`Move ${r.name} down`}
                  >
                    ▼
                  </button>
                </span>
              </td>
              <td>{i + 1}</td>
              <td>
                {renamingId === r.id ? (
                  <div className="stage-rename-row">
                    <input
                      className="stage-rename-input"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      autoFocus
                    />
                    <button
                      className="btn-primary"
                      disabled={pending}
                      onClick={() => handleRename(r.id)}
                    >
                      Save
                    </button>
                    <button className="btn-ghost" onClick={() => setRenamingId(null)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  r.name
                )}
              </td>
              {showWeatherSensitive && (
                <td>
                  <label className="est-record-check">
                    <input
                      type="checkbox"
                      checked={(r as ProjectTypeRow).weather_sensitive}
                      onChange={(e) => handleToggleWeatherSensitive(r.id, e.target.checked)}
                    />
                    Warn about rain
                  </label>
                </td>
              )}
              {leadCost && (
                <td>
                  <LeadCostCell
                    // Remount when the stored figure changes, so a save
                    // that normalized "$1,250.50" shows back as 1250.5.
                    key={`${r.id}:${leadCostInputValue((r as LeadSourceRow).default_lead_cost)}`}
                    row={r as LeadSourceRow}
                    companyDefault={leadCost.companyDefault}
                    onError={setError}
                    onSaved={refresh}
                  />
                </td>
              )}
              <td className="right">
                {renamingId !== r.id && (
                  <>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => startRename(r)}
                      aria-label={`Rename ${r.name}`}
                      title="Rename"
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => handleDelete(r)}
                      aria-label={`Delete ${r.name}`}
                      title="Delete"
                    >
                      🗑
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="hint-note">
        Drag rows to reorder (on a touch screen, use the ▲▼ buttons). Renaming an option updates it on any lead already using that value.
        {leadCost &&
          " Lead cost is put on new leads from that source when nobody types one: blank uses the company default, 0 means free."}
      </p>

      {showCreate && (
        <div className="stage-create-panel">
          <Field label={`${itemLabel} Name`}>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
          </Field>
          <div className="modal-actions">
            <div />
            <div>
              <button className="btn-ghost" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleCreate} disabled={pending}>
                {pending ? "Adding…" : `Add ${itemLabel}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One source's "Lead cost" box. Saves when you leave the box or press
 * Enter, and only if the text changed -- tabbing down the list must not
 * write twenty rows.
 */
function LeadCostCell({
  row,
  companyDefault,
  onError,
  onSaved,
}: {
  row: LeadSourceRow;
  companyDefault: number | null;
  onError: (message: string) => void;
  onSaved: () => void;
}) {
  const stored = leadCostInputValue(row.default_lead_cost);
  const [draft, setDraft] = useState(stored);
  const [saving, setSaving] = useState(false);
  const fallback = companyDefault == null ? "none" : String(companyDefault);
  const blankMeans =
    companyDefault == null ? "no company default, so no cost" : `the company default, $${companyDefault}`;

  async function save() {
    if (draft.trim() === stored) return;
    setSaving(true);
    onError("");
    const result = await setLeadSourceDefaultCost(row.id, draft);
    setSaving(false);
    if (result.error) {
      onError(result.error);
      return;
    }
    onSaved();
  }

  return (
    <span className="lead-cost-box">
      <span>$</span>
      <input
        className="lead-cost-input"
        inputMode="decimal"
        value={draft}
        placeholder={fallback}
        title={`Blank = ${blankMeans}. 0 = free.`}
        aria-label={`Lead cost for ${row.name}`}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </span>
  );
}

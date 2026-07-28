"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Field } from "@/components/ui/field";
import {
  createFieldOption,
  deleteFieldOption,
  renameFieldOption,
  reorderFieldOptions,
  type OptionTable,
} from "@/lib/actions/lead-field-options";
import type { LeadSourceRow, ProjectTypeRow } from "@/lib/data/types";

type Row = ProjectTypeRow | LeadSourceRow;

export function FieldOptionsTable({
  table,
  title,
  description,
  itemLabel,
  rows,
}: {
  table: OptionTable;
  title: string;
  description: string;
  itemLabel: string;
  rows: Row[];
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
      <div className="ur-breadcrumb">
        <Link href="/settings" className="ur-crumb-link">
          ⚙ Settings
        </Link>
        <span> › </span>
        <span>{title}</span>
      </div>

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
                ⠿
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
        Drag rows to reorder. Renaming an option updates it on any lead already using that value.
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

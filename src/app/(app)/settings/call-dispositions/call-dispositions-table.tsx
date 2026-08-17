"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import type { CallDispositionRow } from "@/lib/data/types";
import {
  createDisposition,
  deleteDisposition,
  renameDisposition,
  reorderDispositions,
  updateDispositionColor,
  updateDispositionRules,
} from "@/lib/actions/call-dispositions";

export function CallDispositionsTable({
  dispositions,
  stageNames,
}: {
  dispositions: CallDispositionRow[];
  /** This company's pipeline stages, for the "moves lead to" picker. */
  stageNames: string[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#7C8798");
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
    const ids = dispositions.map((c) => c.id);
    const fromIndex = ids.indexOf(draggedId);
    const toIndex = ids.indexOf(targetId);
    ids.splice(fromIndex, 1);
    ids.splice(toIndex, 0, draggedId);
    setDraggedId(null);
    startTransition(async () => {
      await reorderDispositions(ids);
      router.refresh();
    });
  }

  async function handleCreate() {
    if (!newName.trim()) {
      setError("Disposition name is required.");
      return;
    }
    setPending(true);
    setError("");
    const result = await createDisposition(newName, newColor);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setNewName("");
    setNewColor("#7C8798");
    setShowCreate(false);
    refresh();
  }

  function startRename(d: CallDispositionRow) {
    setRenamingId(d.id);
    setRenameValue(d.name);
    setError("");
  }

  async function handleRename(id: string) {
    if (!renameValue.trim()) {
      setError("Disposition name is required.");
      return;
    }
    setPending(true);
    setError("");
    const result = await renameDisposition(id, renameValue);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setRenamingId(null);
    refresh();
  }

  async function handleColorChange(id: string, color: string) {
    await updateDispositionColor(id, color);
    refresh();
  }

  async function handleRules(
    d: CallDispositionRow,
    moveToStage: string | null,
    createsFollowupTask: boolean
  ) {
    setError("");
    const result = await updateDispositionRules(d.id, { moveToStage, createsFollowupTask });
    if (result.error) {
      setError(result.error);
      return;
    }
    refresh();
  }

  async function handleDelete(d: CallDispositionRow) {
    if (!confirm(`Delete the "${d.name}" disposition?`)) return;
    setError("");
    const result = await deleteDisposition(d.id);
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
        <span>Call Dispositions</span>
      </div>

      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Call Dispositions</h1>
          <p className="module-sub">
            Manage the call-outcome options used in Call Reports and the Power Dialer
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          + Add Disposition
        </button>
      </div>

      {error && <p className="error-note">{error}</p>}

      <table className="data-table">
        <thead>
          <tr>
            <th></th>
            <th>#</th>
            <th>Disposition</th>
            <th>Color</th>
            <th>Moves Lead To</th>
            <th>Follow-up Task</th>
            <th className="right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {dispositions.map((d, i) => (
            <tr
              key={d.id}
              draggable
              onDragStart={() => setDraggedId(d.id)}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverId(d.id);
              }}
              onDragLeave={() => setDragOverId((cur) => (cur === d.id ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(d.id);
              }}
              className={
                (draggedId === d.id ? "stage-row-dragging " : "") +
                (dragOverId === d.id && draggedId !== d.id ? "stage-row-dragover" : "")
              }
            >
              <td className="stage-drag-handle" title="Drag to reorder">
                ⠿
              </td>
              <td>{i + 1}</td>
              <td>
                {renamingId === d.id ? (
                  <div className="stage-rename-row">
                    <input
                      className="stage-rename-input"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      autoFocus
                    />
                    <button className="btn-primary" disabled={pending} onClick={() => handleRename(d.id)}>
                      Save
                    </button>
                    <button className="btn-ghost" onClick={() => setRenamingId(null)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    {d.name} {d.is_system && <Badge color="#B7862B">SYSTEM</Badge>}
                  </>
                )}
              </td>
              <td>
                <input
                  type="color"
                  className="stage-color-input"
                  value={d.color}
                  onChange={(e) => handleColorChange(d.id, e.target.value)}
                />
              </td>
              <td>
                {d.is_system ? (
                  "—"
                ) : (
                  <select
                    value={d.move_to_stage ?? ""}
                    onChange={(e) =>
                      handleRules(d, e.target.value || null, d.creates_followup_task)
                    }
                  >
                    <option value="">— no move —</option>
                    {stageNames.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                )}
              </td>
              <td>
                {d.is_system ? (
                  "—"
                ) : (
                  <input
                    type="checkbox"
                    checked={d.creates_followup_task}
                    onChange={(e) => handleRules(d, d.move_to_stage, e.target.checked)}
                    title="Book a same-day follow-up task for the caller when a call gets this outcome"
                  />
                )}
              </td>
              <td className="right">
                {!d.is_system && renamingId !== d.id && (
                  <>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => startRename(d)}
                      aria-label="Rename disposition"
                      title="Rename"
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => handleDelete(d)}
                      aria-label="Delete disposition"
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
        Drag rows to reorder. Custom dispositions can be renamed and deleted; the
        system &quot;No Disposition&quot; default can be recolored but not renamed or removed.
      </p>
      <p className="hint-note">
        &quot;Moves Lead To&quot; only advances leads still in the early stages (Unsorted, New
        Lead, Meta, No Answer, Contacted). A lead already past its first appointment never moves —
        a missed call must not drag a proposal back to &quot;No Answer&quot;.
      </p>

      {showCreate && (
        <div className="stage-create-panel">
          <Field label="Disposition Name">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} />
          </Field>
          <Field label="Color">
            <input
              type="color"
              className="stage-color-input"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
            />
          </Field>
          <div className="modal-actions">
            <div />
            <div>
              <button className="btn-ghost" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleCreate} disabled={pending}>
                {pending ? "Adding…" : "Add Disposition"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

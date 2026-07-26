"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import type { PipelineStageRow } from "@/lib/data/types";
import {
  createStage,
  deleteStage,
  renameStage,
  reorderStages,
  updateStageColor,
} from "@/lib/actions/pipeline-stages";

export function PipelineStagesTable({ stages }: { stages: PipelineStageRow[] }) {
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
    const ids = stages.map((s) => s.id);
    const fromIndex = ids.indexOf(draggedId);
    const toIndex = ids.indexOf(targetId);
    ids.splice(fromIndex, 1);
    ids.splice(toIndex, 0, draggedId);
    setDraggedId(null);
    startTransition(async () => {
      await reorderStages(ids);
      router.refresh();
    });
  }

  async function handleCreate() {
    if (!newName.trim()) {
      setError("Stage name is required.");
      return;
    }
    setPending(true);
    setError("");
    const result = await createStage(newName, newColor);
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

  function startRename(stage: PipelineStageRow) {
    setRenamingId(stage.id);
    setRenameValue(stage.name);
    setError("");
  }

  async function handleRename(id: string) {
    if (!renameValue.trim()) {
      setError("Stage name is required.");
      return;
    }
    setPending(true);
    setError("");
    const result = await renameStage(id, renameValue);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setRenamingId(null);
    refresh();
  }

  async function handleColorChange(id: string, color: string) {
    await updateStageColor(id, color);
    refresh();
  }

  async function handleDelete(stage: PipelineStageRow) {
    if (!confirm(`Delete the "${stage.name}" stage?`)) return;
    setError("");
    const result = await deleteStage(stage.id);
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
        <span>Pipeline Stages</span>
      </div>

      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Pipeline Stages</h1>
          <p className="module-sub">
            Manage stages within the pipeline (Appointment Scheduled, Won, Lost, etc.)
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          + Add Stage
        </button>
      </div>

      {error && <p className="error-note">{error}</p>}

      <table className="data-table">
        <thead>
          <tr>
            <th></th>
            <th>#</th>
            <th>Stage Name</th>
            <th>Color</th>
            <th className="right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {stages.map((s, i) => (
            <tr
              key={s.id}
              draggable
              onDragStart={() => setDraggedId(s.id)}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverId(s.id);
              }}
              onDragLeave={() =>
                setDragOverId((cur) => (cur === s.id ? null : cur))
              }
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(s.id);
              }}
              className={
                (draggedId === s.id ? "stage-row-dragging " : "") +
                (dragOverId === s.id && draggedId !== s.id ? "stage-row-dragover" : "")
              }
            >
              <td className="stage-drag-handle" title="Drag to reorder">
                ⠿
              </td>
              <td>{i + 1}</td>
              <td>
                {renamingId === s.id ? (
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
                      onClick={() => handleRename(s.id)}
                    >
                      Save
                    </button>
                    <button className="btn-ghost" onClick={() => setRenamingId(null)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    {s.name}{" "}
                    {s.is_system && <Badge color="#B7862B">SYSTEM</Badge>}
                  </>
                )}
              </td>
              <td>
                <input
                  type="color"
                  className="stage-color-input"
                  value={s.color}
                  onChange={(e) => handleColorChange(s.id, e.target.value)}
                />
              </td>
              <td className="right">
                {!s.is_system && renamingId !== s.id && (
                  <>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => startRename(s)}
                      aria-label="Rename stage"
                      title="Rename"
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => handleDelete(s)}
                      aria-label="Delete stage"
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
        Drag rows to reorder. Stages marked SYSTEM are required by app logic
        (auto-advance on booking, pipeline stats) — you can reorder them, but
        their names can&apos;t be changed and they can&apos;t be deleted.
      </p>

      {showCreate && (
        <div className="stage-create-panel">
          <Field label="Stage Name">
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
                {pending ? "Adding…" : "Add Stage"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

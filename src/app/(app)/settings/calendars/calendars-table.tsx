"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import type { CalendarRow } from "@/lib/data/types";
import {
  createCalendar,
  deleteCalendar,
  renameCalendar,
  reorderCalendars,
  updateCalendarColor,
} from "@/lib/actions/calendars";

export function CalendarsTable({ calendars }: { calendars: CalendarRow[] }) {
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
    const ids = calendars.map((c) => c.id);
    const fromIndex = ids.indexOf(draggedId);
    const toIndex = ids.indexOf(targetId);
    ids.splice(fromIndex, 1);
    ids.splice(toIndex, 0, draggedId);
    setDraggedId(null);
    startTransition(async () => {
      await reorderCalendars(ids);
      router.refresh();
    });
  }

  async function handleCreate() {
    if (!newName.trim()) {
      setError("Calendar name is required.");
      return;
    }
    setPending(true);
    setError("");
    const result = await createCalendar(newName, newColor);
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

  function startRename(cal: CalendarRow) {
    setRenamingId(cal.id);
    setRenameValue(cal.name);
    setError("");
  }

  async function handleRename(id: string) {
    if (!renameValue.trim()) {
      setError("Calendar name is required.");
      return;
    }
    setPending(true);
    setError("");
    const result = await renameCalendar(id, renameValue);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setRenamingId(null);
    refresh();
  }

  async function handleColorChange(id: string, color: string) {
    await updateCalendarColor(id, color);
    refresh();
  }

  async function handleDelete(cal: CalendarRow) {
    if (!confirm(`Delete the "${cal.name}" calendar?`)) return;
    setError("");
    const result = await deleteCalendar(cal.id);
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
        <span>Calendars</span>
      </div>

      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Calendars</h1>
          <p className="module-sub">
            Configure calendars used to categorize appointments, and set colors per calendar
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          + Add Calendar
        </button>
      </div>

      {error && <p className="error-note">{error}</p>}

      <table className="data-table">
        <thead>
          <tr>
            <th></th>
            <th>#</th>
            <th>Calendar Name</th>
            <th>Color</th>
            <th className="right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {calendars.map((c, i) => (
            <tr
              key={c.id}
              draggable
              onDragStart={() => setDraggedId(c.id)}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverId(c.id);
              }}
              onDragLeave={() =>
                setDragOverId((cur) => (cur === c.id ? null : cur))
              }
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(c.id);
              }}
              className={
                (draggedId === c.id ? "stage-row-dragging " : "") +
                (dragOverId === c.id && draggedId !== c.id ? "stage-row-dragover" : "")
              }
            >
              <td className="stage-drag-handle" title="Drag to reorder">
                ⠿
              </td>
              <td>{i + 1}</td>
              <td>
                {renamingId === c.id ? (
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
                      onClick={() => handleRename(c.id)}
                    >
                      Save
                    </button>
                    <button className="btn-ghost" onClick={() => setRenamingId(null)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    {c.name}{" "}
                    {c.is_system && <Badge color="#B7862B">SYSTEM</Badge>}
                  </>
                )}
              </td>
              <td>
                <input
                  type="color"
                  className="stage-color-input"
                  value={c.color}
                  onChange={(e) => handleColorChange(c.id, e.target.value)}
                />
              </td>
              <td className="right">
                {!c.is_system && renamingId !== c.id && (
                  <>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => startRename(c)}
                      aria-label="Rename calendar"
                      title="Rename"
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => handleDelete(c)}
                      aria-label="Delete calendar"
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
        Drag rows to reorder. Custom calendars can be renamed and deleted;
        system calendars can be reordered and recolored but not renamed or removed.
      </p>

      {showCreate && (
        <div className="stage-create-panel">
          <Field label="Calendar Name">
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
                {pending ? "Adding…" : "Add Calendar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useCompanyToday } from "@/components/company-zone-context";
import { Field } from "@/components/ui/field";
import type { LeadTask, Profile } from "@/lib/data/types";
import { repBylineName, repDropdownOptions } from "@/lib/data/rep-options";
import { completeLeadTask, createLeadTask, deleteLeadTask } from "@/lib/actions/leads";
import { attempt } from "@/lib/appointment-save";

function formatDueTime(time: string | null) {
  if (!time) return "";
  return new Date(`1970-01-01T${time.slice(0, 5)}:00`).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDueDate(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return dateStr;
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, tomorrow)) return "Tomorrow";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * The task being typed, held by whoever owns it. The panel unmounts on a
 * tab switch, so a draft kept inside it vanished the moment someone
 * clicked over to Result -- a window that wants the draft to survive (and
 * its own Save to commit it) holds it with this hook and passes it in.
 */
export function useTaskDraft() {
  // A new task is due today on the company's calendar, not the UTC day
  // (already tomorrow from 5pm Pacific).
  const today = useCompanyToday();
  const blank = () => ({ title: "", due_date: today(), due_time: "", assigned_to: "" });
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(blank);
  // On its way to the server, by Add Task or the window's Save: the other
  // waits, so a double tap on a slow signal can't add it twice.
  const [busy, setBusy] = useState(false);
  return {
    showAdd,
    setShowAdd,
    form,
    setForm,
    busy,
    setBusy,
    // Something typed into an open form: work that would be lost.
    waiting: showAdd && form.title.trim() !== "",
    reset: () => {
      setForm(blank());
      setShowAdd(false);
    },
  };
}

export type TaskDraft = ReturnType<typeof useTaskDraft>;

export function TasksPanel({
  leadId,
  tasks,
  reps,
  members,
  readOnly,
  onChanged,
  draft,
}: {
  leadId: string;
  tasks: LeadTask[];
  reps: Profile[];
  // The whole roster, deactivated members included. Name lookups (the
  // assignee suffix, the "Added by" byline) read this, never `reps` --
  // the Active-only list would strip the name off a task entered or
  // held by somebody who has since left. Falls back to `reps` only for
  // a host that has nothing wider to give.
  members?: Profile[];
  readOnly?: boolean;
  onChanged: () => void;
  // Held by the host so it outlives a tab switch; the panel keeps its own
  // when none is given.
  draft?: TaskDraft;
}) {
  const own = useTaskDraft();
  const { showAdd, setShowAdd, form, setForm, busy, setBusy, reset } = draft ?? own;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const open = tasks.filter((t) => !t.completed_at);
  const done = tasks.filter((t) => t.completed_at);

  const roster = members ?? reps;

  function repName(id: string | null) {
    if (!id) return null;
    return roster.find((r) => r.id === id)?.name || null;
  }

  // Each call goes through attempt: one that never reaches the server
  // says so instead of leaving the buttons greyed out, and an error the
  // server returns is shown rather than swallowed.
  async function handleAdd() {
    if (!form.title.trim()) {
      setError("Type what the task is first.");
      return;
    }
    setPending(true);
    setBusy(true);
    setError("");
    const result = await attempt(() => createLeadTask(leadId, form));
    setPending(false);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    reset();
    onChanged();
  }

  function cancelAdd() {
    setError("");
    reset();
  }

  async function handleComplete(taskId: string) {
    setPending(true);
    setError("");
    const result = await attempt(() => completeLeadTask(taskId));
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onChanged();
  }

  async function handleDelete(taskId: string, title: string) {
    if (!window.confirm(`Delete the task "${title}"?`)) return;
    setPending(true);
    setError("");
    const result = await attempt(() => deleteLeadTask(taskId));
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onChanged();
  }

  return (
    <div className="second-contact-block">
      <div className="second-contact-head">
        <span>Follow-up Tasks</span>
        {!readOnly && !showAdd && (
          <button
            type="button"
            className="icon-btn"
            onClick={() => setShowAdd(true)}
            aria-label="Add task"
          >
            + Add
          </button>
        )}
      </div>

      {open.length === 0 && done.length === 0 && (
        <p className="empty-hint">No follow-up tasks yet.</p>
      )}

      {open.length > 0 && (
        <ul className="dash-list">
          {open.map((t) => {
            const addedBy = repBylineName(t.created_by, roster);
            return (
            <li key={t.id}>
              {!readOnly && (
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => handleComplete(t.id)}
                  disabled={pending}
                  aria-label="Mark complete"
                >
                  ☐
                </button>
              )}
              <span style={{ flex: 1 }}>
                {t.title}
                {repName(t.assigned_to) && ` — ${repName(t.assigned_to)}`}
                {addedBy && <span className="task-byline">Added by {addedBy}</span>}
              </span>
              <span className="mono">
                {formatDueDate(t.due_date)}
                {t.due_time && ` ${formatDueTime(t.due_time)}`}
              </span>
              {!readOnly && (
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => handleDelete(t.id, t.title)}
                  disabled={pending}
                  aria-label="Delete task"
                >
                  ✕
                </button>
              )}
            </li>
            );
          })}
        </ul>
      )}

      {done.length > 0 && (
        <ul className="dash-list">
          {done.map((t) => (
            <li key={t.id} style={{ opacity: 0.55 }}>
              <span>✓</span>
              <span style={{ flex: 1, textDecoration: "line-through" }}>
                {t.title}
              </span>
              <span className="mono">{formatDueDate(t.due_date)}</span>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="error-note">{error}</p>}

      {showAdd && !readOnly && (
        <div className="form-grid" style={{ marginTop: 10 }}>
          <Field label="Task">
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Follow up call"
              disabled={busy}
            />
          </Field>
          <Field label="Due Date">
            <input
              type="date"
              value={form.due_date}
              onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
              disabled={busy}
            />
          </Field>
          <Field label="Due Time (optional)">
            <input
              type="time"
              value={form.due_time}
              onChange={(e) => setForm((f) => ({ ...f, due_time: e.target.value }))}
              disabled={busy}
            />
          </Field>
          <Field label="Assigned To">
            {/* Blank saves as the person adding it (createLeadTask), so
                a task can no longer land on nobody's plate. */}
            <select
              value={form.assigned_to}
              onChange={(e) => setForm((f) => ({ ...f, assigned_to: e.target.value }))}
              disabled={busy}
            >
              <option value="">Me — assign to myself</option>
              {repDropdownOptions(reps, [form.assigned_to]).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name || r.email}
                </option>
              ))}
            </select>
          </Field>
          {form.due_time && (
            <p className="hint-note" style={{ gridColumn: "1 / -1", margin: 0 }}>
              The assigned rep gets a text reminder 2 hours before this due time.
            </p>
          )}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            <button
              type="button"
              className="btn-primary small"
              onClick={handleAdd}
              disabled={pending || busy}
            >
              Add Task
            </button>
            {/* Clears the draft as well as hiding it, so the window's Save
                can't add a task the person backed out of. Held, like the
                fields above, while the task is on its way: what's sent is
                what was on screen when it was sent. */}
            <button
              type="button"
              className="btn-ghost small"
              onClick={cancelAdd}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { Field } from "@/components/ui/field";
import type { LeadTask, Profile } from "@/lib/data/types";
import { completeLeadTask, createLeadTask, deleteLeadTask } from "@/lib/actions/leads";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function TasksPanel({
  leadId,
  tasks,
  reps,
  readOnly,
  onChanged,
}: {
  leadId: string;
  tasks: LeadTask[];
  reps: Profile[];
  readOnly?: boolean;
  onChanged: () => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState({ title: "", due_date: todayISO(), assigned_to: "" });

  const open = tasks.filter((t) => !t.completed_at);
  const done = tasks.filter((t) => t.completed_at);

  function repName(id: string | null) {
    if (!id) return null;
    return reps.find((r) => r.id === id)?.name || null;
  }

  async function handleAdd() {
    if (!form.title.trim()) return;
    setPending(true);
    await createLeadTask(leadId, form);
    setPending(false);
    setForm({ title: "", due_date: todayISO(), assigned_to: "" });
    setShowAdd(false);
    onChanged();
  }

  async function handleComplete(taskId: string) {
    setPending(true);
    await completeLeadTask(taskId);
    setPending(false);
    onChanged();
  }

  async function handleDelete(taskId: string) {
    setPending(true);
    await deleteLeadTask(taskId);
    setPending(false);
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
          {open.map((t) => (
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
              </span>
              <span className="mono">{t.due_date}</span>
              {!readOnly && (
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => handleDelete(t.id)}
                  disabled={pending}
                  aria-label="Delete task"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
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
              <span className="mono">{t.due_date}</span>
            </li>
          ))}
        </ul>
      )}

      {showAdd && !readOnly && (
        <div className="form-grid" style={{ marginTop: 10 }}>
          <Field label="Task">
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Follow up call"
            />
          </Field>
          <Field label="Due Date">
            <input
              type="date"
              value={form.due_date}
              onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
            />
          </Field>
          <Field label="Assigned To">
            <select
              value={form.assigned_to}
              onChange={(e) => setForm((f) => ({ ...f, assigned_to: e.target.value }))}
            >
              <option value="">Unassigned</option>
              {reps.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name || r.email}
                </option>
              ))}
            </select>
          </Field>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            <button
              type="button"
              className="btn-primary small"
              onClick={handleAdd}
              disabled={pending}
            >
              Add Task
            </button>
            <button
              type="button"
              className="btn-ghost small"
              onClick={() => setShowAdd(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

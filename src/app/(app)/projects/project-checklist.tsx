"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addProjectChecklistItem,
  applyChecklistTemplate,
  deleteProjectChecklistItem,
  setProjectChecklistItemDone,
  updateProjectChecklistItem,
} from "@/lib/actions/checklists";

export type ChecklistItemRow = {
  id: string;
  estimate_id: string;
  label: string;
  sort_order: number;
  due_date: string | null;
  assigned_to: string | null;
  completed_at: string | null;
  completed_by: string | null;
};

/**
 * The checklist under one project row. Check-off is for anyone who can
 * see this page; changing the list (add, delete, apply a template) is
 * Office/Admin -- the same split the database policies enforce.
 */
export function ProjectChecklist({
  estimateId,
  items,
  templates,
  canEdit,
  memberNames,
}: {
  estimateId: string;
  items: ChecklistItemRow[];
  templates: { id: string; name: string; count: number }[];
  canEdit: boolean;
  memberNames: Record<string, string>;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState("");
  const [newItem, setNewItem] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [error, setError] = useState("");

  const refresh = () => startTransition(() => router.refresh());

  async function toggle(item: ChecklistItemRow) {
    setBusy(item.id);
    setError("");
    const result = await setProjectChecklistItemDone(item.id, !item.completed_at);
    setBusy("");
    if (result?.error) {
      setError(result.error);
      return;
    }
    refresh();
  }

  async function add() {
    if (!newItem.trim()) return;
    setBusy("add");
    setError("");
    const result = await addProjectChecklistItem(estimateId, newItem);
    setBusy("");
    if (result?.error) {
      setError(result.error);
      return;
    }
    setNewItem("");
    refresh();
  }

  async function applyTemplate() {
    if (!templateId) return;
    setBusy("template");
    setError("");
    const result = await applyChecklistTemplate(estimateId, templateId);
    setBusy("");
    if (result?.error) {
      setError(result.error);
      return;
    }
    setTemplateId("");
    refresh();
  }

  async function remove(item: ChecklistItemRow) {
    setBusy(item.id);
    setError("");
    const result = await deleteProjectChecklistItem(item.id);
    setBusy("");
    if (result?.error) {
      setError(result.error);
      return;
    }
    refresh();
  }

  return (
    <div className="proj-checklist">
      {items.length === 0 ? (
        <p className="empty-hint" style={{ margin: "2px 0 8px" }}>
          No checklist on this job yet
          {templates.length > 0 ? " — apply a template below or add steps by hand." : "."}
        </p>
      ) : (
        <ul className="proj-checklist-list">
          {items.map((item) => {
            const overdue =
              !!item.due_date && !item.completed_at && item.due_date < new Date().toISOString().slice(0, 10);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="proj-check-box"
                  onClick={() => toggle(item)}
                  disabled={busy === item.id}
                  aria-label={item.completed_at ? "Mark not done" : "Mark done"}
                >
                  {item.completed_at ? "✓" : "☐"}
                </button>
                <span className={item.completed_at ? "proj-check-done" : undefined}>
                  {item.label}
                </span>

                {/* The plan: when it's due and whose it is. Editable in
                    place by the same roles that can shape the list;
                    read-only facts for everyone else. */}
                {canEdit ? (
                  <input
                    type="date"
                    className={"proj-check-due" + (overdue ? " proj-check-overdue" : "")}
                    value={item.due_date ?? ""}
                    disabled={busy === item.id}
                    onChange={(e) =>
                      startTransition(async () => {
                        setBusy(item.id);
                        const r = await updateProjectChecklistItem(item.id, {
                          dueDate: e.target.value || null,
                        });
                        setBusy("");
                        if (r?.error) return setError(r.error);
                        refresh();
                      })
                    }
                  />
                ) : (
                  item.due_date && (
                    <span className={"proj-check-meta" + (overdue ? " proj-check-overdue" : "")}>
                      due{" "}
                      {new Date(item.due_date + "T00:00:00").toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  )
                )}
                {canEdit ? (
                  <select
                    className="proj-check-assignee"
                    value={item.assigned_to ?? ""}
                    disabled={busy === item.id}
                    onChange={(e) =>
                      startTransition(async () => {
                        setBusy(item.id);
                        const r = await updateProjectChecklistItem(item.id, {
                          assignedTo: e.target.value || null,
                        });
                        setBusy("");
                        if (r?.error) return setError(r.error);
                        refresh();
                      })
                    }
                  >
                    <option value="">Unassigned</option>
                    {Object.entries(memberNames)
                      .filter(([, name]) => name)
                      .sort((a, b) => a[1].localeCompare(b[1]))
                      .map(([id, name]) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                  </select>
                ) : (
                  item.assigned_to && (
                    <span className="proj-check-meta">
                      {memberNames[item.assigned_to] || "assigned"}
                    </span>
                  )
                )}

                {item.completed_at && (
                  <span className="proj-check-meta">
                    ✓ {memberNames[item.completed_by ?? ""] || "someone"} ·{" "}
                    {new Date(item.completed_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                )}
                {canEdit && (
                  <button
                    type="button"
                    className="icon-btn proj-check-remove"
                    onClick={() => remove(item)}
                    disabled={busy === item.id}
                    aria-label="Remove item"
                  >
                    ✕
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error && <p className="error-note">{error}</p>}

      {canEdit && (
        <div className="proj-checklist-tools">
          <input
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder="Add a step…"
          />
          <button
            type="button"
            className="btn-ghost small"
            onClick={add}
            disabled={busy === "add" || !newItem.trim()}
          >
            Add
          </button>
          {templates.length > 0 && (
            <>
              <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                <option value="">Apply a template…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.count})
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-ghost small"
                onClick={applyTemplate}
                disabled={busy === "template" || !templateId}
              >
                Apply
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

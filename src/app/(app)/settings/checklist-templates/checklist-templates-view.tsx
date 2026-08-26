"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import {
  deleteChecklistTemplate,
  saveChecklistTemplate,
  type ChecklistTemplate,
} from "@/lib/actions/checklists";

type Draft = { id?: string; name: string; itemsText: string };

export function ChecklistTemplatesView({ templates }: { templates: ChecklistTemplate[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!draft) return;
    setPending(true);
    setError("");
    const result = await saveChecklistTemplate(draft);
    setPending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setDraft(null);
    startTransition(() => router.refresh());
  }

  async function remove(t: ChecklistTemplate) {
    if (!window.confirm(`Delete the "${t.name}" template? Checklists already on projects keep their items.`))
      return;
    const result = await deleteChecklistTemplate(t.id);
    if (result?.error) {
      setError(result.error);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div>
      <div className="ur-breadcrumb">
        <Link href="/settings" className="ur-crumb-link">
          ⚙ Settings
        </Link>
        <span> › </span>
        <span>Checklist Templates</span>
      </div>

      {error && !draft && <p className="error-note">{error}</p>}

      <div className="modal-actions" style={{ marginTop: 0, marginBottom: 10 }}>
        <span className="hint-note">
          Templates are copied onto a project — editing one later never rewrites a running job.
        </span>
        <button
          type="button"
          className="btn-primary small"
          onClick={() => {
            setError("");
            setDraft({ name: "", itemsText: "" });
          }}
        >
          + New template
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="empty-state">
          <p className="empty-label">No checklist templates yet</p>
          <p className="empty-hint">
            Make one for each kind of job you run — &quot;Kitchen close-out&quot;,
            &quot;Pre-drywall inspection&quot; — then apply it from the Projects page.
          </p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Template</th>
                <th>Steps</th>
                <th>Updated</th>
                <th className="right"></th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id}>
                  <td>
                    {t.name}
                    <div className="est-tax-note">
                      {t.items.slice(0, 3).join(" · ")}
                      {t.items.length > 3 ? " · …" : ""}
                    </div>
                  </td>
                  <td>{t.items.length}</td>
                  <td>
                    {new Date(t.updated_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </td>
                  <td className="right">
                    <button
                      type="button"
                      className="btn-ghost small"
                      onClick={() => {
                        setError("");
                        setDraft({ id: t.id, name: t.name, itemsText: t.items.join("\n") });
                      }}
                    >
                      Edit
                    </button>{" "}
                    <button type="button" className="btn-ghost small" onClick={() => remove(t)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {draft && (
        <Modal
          title={draft.id ? "Edit template" : "New checklist template"}
          onClose={() => setDraft(null)}
        >
          <Field label="Template name">
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Kitchen close-out"
            />
          </Field>
          <Field label="Steps — one per line, in order">
            <textarea
              value={draft.itemsText}
              onChange={(e) => setDraft({ ...draft, itemsText: e.target.value })}
              rows={12}
              placeholder={
                "Final walkthrough with customer\nTouch-up paint\nHaul away debris\nCollect final payment\nRequest a review"
              }
            />
          </Field>
          {error && <p className="error-note">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Save template"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ScopeTemplate } from "@/lib/data/types";
import { deleteScopeTemplate, saveScopeTemplate } from "@/lib/actions/scope-templates";

type Draft = { id?: string; name: string; projectType: string; body: string };

const BLANK: Draft = { name: "", projectType: "", body: "" };

export function ScopeLibraryTable({
  templates,
  projectTypes,
}: {
  templates: ScopeTemplate[];
  projectTypes: string[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    if (!draft) return;
    setError(null);
    startTransition(async () => {
      const res = await saveScopeTemplate({
        id: draft.id,
        name: draft.name,
        projectType: draft.projectType || null,
        body: draft.body,
      });
      if (res.error) return setError(res.error);
      setDraft(null);
      router.refresh();
    });
  }

  function remove(t: ScopeTemplate) {
    setError(null);
    startTransition(async () => {
      const res = await deleteScopeTemplate(t.id);
      if (res.error) return setError(res.error);
      router.refresh();
    });
  }

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">Scope Library</h1>
          <p className="module-sub">
            Examples of your own scopes of work. The AI generator copies their structure and
            wording — this is what makes generated scopes sound like you.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setDraft({ ...BLANK })} disabled={pending}>
          + Add example
        </button>
      </div>

      <p className="rv-banner">
        🛡 Tag an example with a project type and it is used for those jobs. Leave the type blank
        for a house standard used on every job. The generator uses up to <strong>two</strong> at a
        time — more crowds out the actual brief.
      </p>

      {error && <p className="error-note">{error}</p>}

      {templates.length === 0 ? (
        <div className="empty-state">
          <p className="empty-label">No examples yet</p>
          <p className="empty-hint">
            Add two or three of your best real scopes — one per common job type. That single step
            does more for output quality than any other setting.
          </p>
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Project type</th>
              <th className="right">Length</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id}>
                <td>
                  <div className="ur-name">{t.name}</div>
                  <div className="ur-add-phone">{t.body.slice(0, 90)}…</div>
                </td>
                <td>{t.project_type || <span className="ur-add-phone">Any job</span>}</td>
                <td className="right mono">{t.body.length.toLocaleString()}</td>
                <td className="right">
                  <button
                    className="btn-ghost"
                    onClick={() =>
                      setDraft({
                        id: t.id,
                        name: t.name,
                        projectType: t.project_type ?? "",
                        body: t.body,
                      })
                    }
                    disabled={pending}
                  >
                    Edit
                  </button>
                  <button className="btn-ghost" onClick={() => remove(t)} disabled={pending}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {draft && (
        <div className="modal-backdrop" onClick={() => setDraft(null)}>
          <div className="modal scope-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="est-pay-title">{draft.id ? "Edit example" : "Add example"}</h2>
            <div className="est-meta-grid">
              <label className="field">
                <span className="field-label">Name</span>
                <input
                  className="est-title-input"
                  autoFocus
                  placeholder="e.g. Standard bathroom remodel"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="field-label">Project type</span>
                <select
                  className="est-title-input"
                  value={draft.projectType}
                  onChange={(e) => setDraft({ ...draft, projectType: e.target.value })}
                >
                  <option value="">Any job (house standard)</option>
                  {projectTypes.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <textarea
              className="scope-textarea"
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              placeholder={
                "Paste one of your real scopes here — the whole thing, exactly as you'd send it.\n\nThe closer it is to your actual work, the better the generated ones will be."
              }
            />
            {error && <p className="error-note">{error}</p>}
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setDraft(null)} disabled={pending}>
                Cancel
              </button>
              <button className="btn-primary" onClick={save} disabled={pending}>
                {pending ? "Saving…" : "Save example"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

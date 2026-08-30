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

type DraftItem = { label: string; offsetDays: number | null };
type Draft = { id?: string; name: string; items: DraftItem[]; autoApply: boolean };

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
    const result = await saveChecklistTemplate({
      id: draft.id,
      name: draft.name,
      items: draft.items,
      autoApply: draft.autoApply,
    });
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

  function setItem(i: number, patch: Partial<DraftItem>) {
    if (!draft) return;
    setDraft({
      ...draft,
      items: draft.items.map((it, j) => (j === i ? { ...it, ...patch } : it)),
    });
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
            setDraft({ name: "", items: [{ label: "", offsetDays: null }], autoApply: false });
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
            &quot;Pre-drywall inspection&quot; — then apply it from the Projects page, or mark one
            to apply itself the moment a contract is signed.
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
                    {t.auto_apply && <span className="count-pill"> auto on signing</span>}
                    <div className="est-tax-note">
                      {t.items
                        .slice(0, 3)
                        .map((i) => i.label + (i.offset_days !== null ? ` (+${i.offset_days}d)` : ""))
                        .join(" · ")}
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
                        setDraft({
                          id: t.id,
                          name: t.name,
                          items: t.items.map((i) => ({ label: i.label, offsetDays: i.offset_days })),
                          autoApply: t.auto_apply,
                        });
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
          wide
        >
          <Field label="Template name">
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Kitchen close-out"
            />
          </Field>

          <p className="module-sub" style={{ margin: "12px 0 6px" }}>
            Steps, in order. &quot;Days after signing&quot; sets each step&apos;s due date
            automatically when the checklist lands on a job — leave it blank for steps with no
            deadline.
          </p>
          <div style={{ display: "grid", gap: 8 }}>
            {draft.items.map((it, i) => (
              <div key={i} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <input
                  style={{ flex: "1 1 260px", minWidth: 0 }}
                  value={it.label}
                  placeholder={i === 0 ? "e.g. File for permit" : "Next step…"}
                  onChange={(e) => setItem(i, { label: e.target.value })}
                />
                <input
                  type="number"
                  min={0}
                  max={365}
                  style={{ width: 90 }}
                  value={it.offsetDays ?? ""}
                  placeholder="days"
                  title="Due this many days after the contract is signed"
                  onChange={(e) =>
                    setItem(i, { offsetDays: e.target.value === "" ? null : Number(e.target.value) })
                  }
                />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Remove step"
                  onClick={() =>
                    setDraft({ ...draft, items: draft.items.filter((_, j) => j !== i) })
                  }
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn-ghost small"
            style={{ marginTop: 8 }}
            onClick={() => setDraft({ ...draft, items: [...draft.items, { label: "", offsetDays: null }] })}
          >
            + Add step
          </button>

          <label style={{ display: "flex", gap: 8, alignItems: "center", margin: "14px 0 0" }}>
            <input
              type="checkbox"
              checked={draft.autoApply}
              onChange={(e) => setDraft({ ...draft, autoApply: e.target.checked })}
            />
            Apply this template automatically when a contract is signed
          </label>
          <p className="est-tax-note" style={{ marginTop: 4 }}>
            One template per company can auto-apply; turning it on here turns it off on any other.
          </p>

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

"use client";

import { useEffect, useState, useTransition } from "react";
import {
  deleteContractTemplate,
  getContractTemplates,
  saveContractTemplate,
  type ContractTemplate,
} from "@/lib/actions/contract-templates";
import { MERGE_FIELDS, parseContract, tokensUsed, unknownTokens } from "@/lib/contracts/merge";

type Draft = { id?: string; name: string; body: string; isDefault: boolean };

const BLANK: Draft = { name: "", body: "", isDefault: false };

export function ContractsView() {
  const [templates, setTemplates] = useState<ContractTemplate[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [pending, startTransition] = useTransition();
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getContractTemplates();
      if (cancelled) return;
      if (res.error) return setError(res.error);
      setTemplates(res.templates ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  function save() {
    if (!draft) return;
    setError("");
    setSaved("");
    startTransition(async () => {
      const res = await saveContractTemplate({
        id: draft.id,
        name: draft.name,
        body: draft.body,
        isDefault: draft.isDefault,
      });
      if (res.error) return setError(res.error);
      setDraft(null);
      setSaved("Saved.");
      setReloadKey((k) => k + 1);
    });
  }

  if (error && !templates) return <p className="error-note">{error}</p>;
  if (!templates) return <p className="empty-hint">Loading…</p>;

  // Written while typing, so a mistyped token is caught here rather than
  // discovered as literal braces on a document a customer is reading.
  const unknown = draft ? unknownTokens(draft.body) : [];
  const used = draft ? tokensUsed(draft.body) : [];

  if (draft) {
    return (
      <div className="ta-panel">
        <label className="field">
          <span className="field-label">Name *</span>
          <input
            value={draft.name}
            placeholder="e.g. Home Improvement Contract — Roofing"
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            disabled={pending}
          />
        </label>

        <label className="field">
          <span className="field-label">Contract text *</span>
          <textarea
            value={draft.body}
            rows={18}
            placeholder="Paste your contract here from Word. Use {{client_name}} and the other fields listed below wherever a detail should be filled in."
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            disabled={pending}
          />
        </label>

        <label className="est-record-check">
          <input
            type="checkbox"
            checked={draft.isDefault}
            onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })}
            disabled={pending}
          />
          <span>
            Use this on new estimates{" "}
            <span className="est-tax-note">— only one contract can be the default</span>
          </span>
        </label>

        {unknown.length > 0 && (
          <p className="error-note">
            Not a field this system knows: {unknown.map((t) => `{{${t}}}`).join(", ")}. It
            will print on the contract exactly as written.
          </p>
        )}

        <details className="hint-note" style={{ marginTop: 10 }}>
          <summary>Fields you can use ({MERGE_FIELDS.length})</summary>
          <table className="data-table" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Field</th>
                <th>Fills in with</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {MERGE_FIELDS.map((f) => (
                <tr key={f.token}>
                  <td className="mono">{`{{${f.token}}}`}</td>
                  <td>{f.label}</td>
                  <td className="est-tax-note">
                    {used.includes(f.token) ? "in use" : f.example}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ marginTop: 8 }}>
            The price and deposit fill in when the estimate is sent, not when it is
            created — nothing is priced yet at that point.
          </p>
        </details>

        {error && <p className="error-note">{error}</p>}

        <div className="modal-actions" style={{ marginTop: 14 }}>
          <button className="btn-ghost" onClick={() => setDraft(null)} disabled={pending}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={save}
            disabled={pending || !draft.name.trim() || !draft.body.trim()}
          >
            {pending ? "Saving…" : "Save contract"}
          </button>
        </div>

        {draft.body.trim() && (
          <div style={{ marginTop: 18 }}>
            <div className="estdoc-label">Preview</div>
            <div className="estdoc-terms">
              {parseContract(draft.body).map((b, i) =>
                b.kind === "heading" ? (
                  <h4 key={i} className="estdoc-terms-head">
                    {b.text}
                  </h4>
                ) : b.kind === "bullet" ? (
                  <ul key={i} className="estdoc-terms-list">
                    {b.items.map((it, j) => (
                      <li key={j}>{it}</li>
                    ))}
                  </ul>
                ) : (
                  <p key={i}>{b.text}</p>
                )
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="modal-actions" style={{ marginBottom: 14 }}>
        <div>{saved && <span className="cp-saved">✓ {saved}</span>}</div>
        <button className="btn-primary" onClick={() => setDraft({ ...BLANK })}>
          + New contract
        </button>
      </div>

      {templates.length === 0 ? (
        <p className="empty-hint">
          No contract yet. Paste yours in and mark it the default — every estimate
          created after that carries it.
        </p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Length</th>
              <th>Updated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id}>
                <td>
                  {t.name}
                  {t.is_default && <span className="est-tax-note"> · used on new estimates</span>}
                </td>
                <td>{t.body.split(/\s+/).filter(Boolean).length} words</td>
                <td>{new Date(t.updated_at).toLocaleDateString("en-US")}</td>
                <td className="right">
                  <button
                    className="btn-ghost small"
                    onClick={() =>
                      setDraft({ id: t.id, name: t.name, body: t.body, isDefault: t.is_default })
                    }
                  >
                    Edit
                  </button>{" "}
                  <button
                    className="btn-ghost small"
                    disabled={pending}
                    onClick={() => {
                      // Says what it does not do, because "delete the
                      // contract" sounds like it reaches signed ones.
                      if (
                        window.confirm(
                          `Delete "${t.name}"? Contracts already signed keep their own copy and are not affected.`
                        )
                      ) {
                        startTransition(async () => {
                          const res = await deleteContractTemplate(t.id);
                          if (res.error) return setError(res.error);
                          setReloadKey((k) => k + 1);
                        });
                      }
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {error && <p className="error-note">{error}</p>}
    </div>
  );
}

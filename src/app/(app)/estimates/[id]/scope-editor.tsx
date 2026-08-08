"use client";

import { useState, useTransition } from "react";
import { formatScopeWithAI, generateScopeWithAI } from "@/lib/actions/scope-ai";
import { saveScopeTemplate } from "@/lib/actions/scope-templates";

/**
 * Full-size editor for a line item's scope description.
 *
 * The inline field grows to fit but a real scope of work runs to
 * paragraphs, so this gives it a proper window. Edits are held locally
 * and only handed back on Done, so Cancel genuinely discards -- including
 * discarding an AI reformat the rep did not like.
 */
export function ScopeEditor({
  title,
  initial,
  readOnly,
  estimateId,
  onClose,
  onSave,
}: {
  title: string;
  initial: string;
  readOnly: boolean;
  estimateId: string;
  onClose: () => void;
  onSave: (text: string) => void;
}) {
  const [text, setText] = useState(initial);
  const [beforeFormat, setBeforeFormat] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function format() {
    setError(null);
    startTransition(async () => {
      const res = await formatScopeWithAI(text);
      if (res.error) return setError(res.error);
      if (res.formatted) {
        // Kept so one click undoes it. A reformat that loses the rep's
        // own wording with no way back is worse than no button at all.
        setBeforeFormat(text);
        setText(res.formatted);
      }
    });
  }

  // Expands whatever is in the box -- a few words of brief, or notes from
  // the site visit -- into a full scope. Same undo, since this replaces
  // more of the rep's writing than formatting does.
  function generate() {
    setError(null);
    startTransition(async () => {
      const res = await generateScopeWithAI(text, estimateId);
      if (res.error) return setError(res.error);
      if (res.scope) {
        setBeforeFormat(text);
        setText(res.scope);
        setNote(
          res.examplesUsed
            ? `Written using ${res.examplesUsed} example${res.examplesUsed === 1 ? "" : "s"} from your scope library`
            : "No scope-library examples matched this job type — add some in Admin Settings to sharpen this"
        );
      }
    });
  }

  // Banks a good scope as a worked example, which is the only thing that
  // durably improves what the generator produces next time.
  function saveAsTemplate() {
    setError(null);
    startTransition(async () => {
      const res = await saveScopeTemplate({
        name: title || "Saved scope",
        projectType: null,
        body: text,
      });
      if (res.error) return setError(res.error);
      setNote("Saved to your scope library. Tag it with a project type in Admin Settings.");
    });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal scope-modal" onClick={(e) => e.stopPropagation()}>
        <div className="scope-modal-head">
          <div>
            <h2 className="est-pay-title">Scope of work</h2>
            <p className="est-pay-sub">{title || "Line item"}</p>
          </div>
          {!readOnly && (
            <div className="est-pay-actions">
              {beforeFormat !== null && (
                <button
                  className="btn-ghost"
                  onClick={() => {
                    setText(beforeFormat);
                    setBeforeFormat(null);
                  }}
                  disabled={pending}
                >
                  Undo format
                </button>
              )}
              <button className="btn-ghost" onClick={generate} disabled={pending || !text.trim()}>
                {pending ? "Working…" : "✨ Generate with AI"}
              </button>
              <button className="btn-ghost" onClick={format} disabled={pending || !text.trim()}>
                {pending ? "Working…" : "✨ Format with AI"}
              </button>
              <button className="btn-ghost" onClick={saveAsTemplate} disabled={pending || !text.trim()}>
                Save to library
              </button>
            </div>
          )}
        </div>

        <textarea
          className="scope-textarea"
          value={text}
          readOnly={readOnly}
          autoFocus
          placeholder={
            "Describe the work. e.g.\n\nDemo existing tile and tub surround.\nRelocate shower valve.\nInstall new 60x32 tub, tile to ceiling."
          }
          onChange={(e) => setText(e.target.value)}
        />

        <p className="est-tax-note">
          Shown to the customer under this line item. Format with AI tidies the wording and never
          adds or removes scope.
        </p>

        {error && <p className="error-note">{error}</p>}
        {note && <p className="hint-note">{note}</p>}

        <div className="modal-actions">
          <button className="btn-ghost" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          {!readOnly && (
            <button className="btn-primary" onClick={() => onSave(text)} disabled={pending}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

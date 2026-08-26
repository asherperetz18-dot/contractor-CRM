"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Field } from "@/components/ui/field";
import { saveAiAnalysisSettings } from "@/lib/actions/settings";
import {
  DEFAULT_NEGATIVE_SIGNALS,
  DEFAULT_POSITIVE_SIGNALS,
} from "@/lib/data/ai-analysis";

const MODELS = [
  { value: "claude-opus-5", label: "Claude Opus 5 — most capable (recommended)" },
  { value: "claude-sonnet-5", label: "Claude Sonnet 5 — faster, cheaper" },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5 — fastest" },
];

export function AiAnalysisForm({
  settings,
  configured,
}: {
  settings: {
    ai_analysis_enabled: boolean;
    ai_analysis_model: string;
    ai_analysis_positive_signals: string | null;
    ai_analysis_negative_signals: string | null;
  };
  configured: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(settings.ai_analysis_enabled);
  const [model, setModel] = useState(settings.ai_analysis_model || "claude-opus-5");
  const [positive, setPositive] = useState(settings.ai_analysis_positive_signals ?? "");
  const [negative, setNegative] = useState(settings.ai_analysis_negative_signals ?? "");
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setPending(true);
    setError("");
    const result = await saveAiAnalysisSettings({
      enabled,
      model,
      positiveSignals: positive,
      negativeSignals: negative,
    });
    setPending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setSaved(true);
    startTransition(() => router.refresh());
  }

  return (
    <div>
      <div className="ur-breadcrumb">
        <Link href="/settings" className="ur-crumb-link">
          ⚙ Settings
        </Link>
        <span> › </span>
        <span>AI Analysis</span>
      </div>

      <div className="module-toolbar">
        <div>
          <h1 className="module-title">AI Analysis</h1>
          <p className="module-sub">
            Reads a contact&apos;s texts, calls, notes, and appointment history, then reports
            the buying signals in it — on the contact card, next to the conversation
          </p>
        </div>
      </div>

      {!configured && (
        <p className="error-note">
          The AI service isn&apos;t connected on the server yet — these settings will save, but
          analysis won&apos;t run until it is.
        </p>
      )}

      <div className="cp-card">
        <div className="cp-card-head">🧠 Analyzer</div>

        <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              setSaved(false);
            }}
          />
          <span>Enable AI Analysis on contact cards</span>
        </label>

        <Field label="Model">
          <select
            value={model}
            onChange={(e) => {
              setModel(e.target.value);
              setSaved(false);
            }}
          >
            {MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Positive signals">
          <textarea
            value={positive}
            onChange={(e) => {
              setPositive(e.target.value);
              setSaved(false);
            }}
            rows={9}
            placeholder={DEFAULT_POSITIVE_SIGNALS}
          />
        </Field>
        <p className="cp-hint">
          One signal per line — what a serious buyer sounds like in your trade. Leave blank
          to use the built-in list shown above.
        </p>

        <Field label="Negative signals">
          <textarea
            value={negative}
            onChange={(e) => {
              setNegative(e.target.value);
              setSaved(false);
            }}
            rows={9}
            placeholder={DEFAULT_NEGATIVE_SIGNALS}
          />
        </Field>
        <p className="cp-hint">
          One per line — what a dead deal sounds like. Blank uses the built-in list.
        </p>

        {error && <p className="error-note">{error}</p>}
        <div className="modal-actions">
          <span className="hint-note">{saved ? "✓ Saved" : ""}</span>
          <button type="button" className="btn-primary" onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

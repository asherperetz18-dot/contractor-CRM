"use client";

import { useState, useTransition } from "react";
import { saveAiEstimatorSettings } from "@/lib/actions/settings";

export type EstimatorSettingsRow = {
  ai_estimator_enabled: boolean;
  ai_estimator_model: string;
  ai_estimator_instructions: string | null;
  ai_estimator_rate_card: string | null;
};

// Only models this app is actually wired for. A free-text model field
// would let a typo silently disable the feature at the worst moment.
const MODELS = [
  { id: "claude-opus-5", label: "Claude Opus 5 — most capable, best for pricing" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5 — faster and cheaper" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 — fastest, simple scopes only" },
];

export function AiEstimatorForm({
  settings,
  configured,
}: {
  settings: EstimatorSettingsRow;
  configured: boolean;
}) {
  const [enabled, setEnabled] = useState(settings.ai_estimator_enabled);
  const [model, setModel] = useState(settings.ai_estimator_model || "claude-opus-5");
  const [instructions, setInstructions] = useState(settings.ai_estimator_instructions ?? "");
  const [rateCard, setRateCard] = useState(settings.ai_estimator_rate_card ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await saveAiEstimatorSettings({
        enabled,
        model,
        instructions: instructions.trim() || null,
        rateCard: rateCard.trim() || null,
      });
      if (res.error) return setError(res.error);
      setSaved(true);
    });
  }

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">AI Estimator</h1>
          <p className="module-sub">
            Prompt and model settings for the AI scope and estimate generator
          </p>
        </div>
        <button className="btn-primary" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
      </div>

      {!configured && (
        <p className="error-note">
          No Anthropic API key is set on the server, so these features won&apos;t run yet even when
          switched on.
        </p>
      )}

      <section className="est-pay">
        <div className="est-pay-head">
          <div>
            <h2 className="est-pay-title">Enable the AI estimator</h2>
            <p className="est-pay-sub">
              Adds Generate with AI and Generate priced estimate to the estimate builder. Off by
              default: this proposes prices on a document a homeowner signs, so it is opted into
              deliberately.
            </p>
          </div>
          <button
            type="button"
            className="ur-toggle-btn"
            onClick={() => setEnabled((v) => !v)}
            aria-pressed={enabled}
          >
            <span className={"toggle-track" + (enabled ? " toggle-on" : "")}>
              <span className="toggle-thumb" />
            </span>
          </button>
        </div>

        <label className="field">
          <span className="field-label">Model</span>
          <select
            className="est-title-input"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="est-pay">
        <div className="est-pay-head">
          <div>
            <h2 className="est-pay-title">Your rate card</h2>
            <p className="est-pay-sub">
              What you charge, in your own words. This is what generated prices are built from.
            </p>
          </div>
        </div>
        <textarea
          className="scope-textarea"
          rows={10}
          value={rateCard}
          onChange={(e) => setRateCard(e.target.value)}
          placeholder={
            "One per line, however you think about it. For example:\n\n" +
            "Demo concrete slab: $8 per sf\n" +
            "Framing labor: $85/hr\n" +
            "Dumpster (40 yd): $650 each\n" +
            "Standard bath remodel, labor only: $18,000 lump sum\n" +
            "Tile setting: $14 per sf"
          }
        />
        <p className="est-tax-note">
          <strong>This is the safety rail.</strong> Generated prices come only from what you write
          here. Leave it empty and the generator returns line items with quantities but{" "}
          <strong>no prices at all</strong> — it will not guess at market rates, because a guess
          dressed up as an estimate is the one output that can genuinely cost you money.
        </p>
      </section>

      <section className="est-pay">
        <div className="est-pay-head">
          <div>
            <h2 className="est-pay-title">House style</h2>
            <p className="est-pay-sub">
              Optional. How you like scopes written — vocabulary, detail level, anything you always
              include or exclude.
            </p>
          </div>
        </div>
        <textarea
          className="scope-textarea"
          rows={7}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder={
            "For example:\n\n" +
            "Always list permits and inspections as their own line.\n" +
            "We never include appliances unless stated.\n" +
            "Keep bullets short — homeowners skim.\n" +
            "Use 'demolition', never 'demo', on customer-facing text."
          }
        />
      </section>

      {error && <p className="error-note">{error}</p>}
      {saved && <p className="hint-note">Saved.</p>}
    </div>
  );
}

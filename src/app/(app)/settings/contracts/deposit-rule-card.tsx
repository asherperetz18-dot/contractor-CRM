"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/components/ui/field";
import { saveDepositRule, type DepositRuleSettings } from "@/lib/actions/settings";
import { depositRuleSentence, isCaliforniaState, parseDepositRule } from "@/lib/deposit-rule";

/**
 * The deposit each new estimate asks for at signing: a percent of the
 * total, held under an optional dollar cap (DECISIONS #117). It used to
 * be California's limit for every company; now each company sets its
 * own, and a California company can't go above the legal limit.
 */
export function DepositRuleCard({ initial }: { initial: DepositRuleSettings }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [percent, setPercent] = useState(String(initial.percentBp / 100));
  const [cap, setCap] = useState(initial.capCents > 0 ? String(initial.capCents / 100) : "");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = parseDepositRule(percent, cap);
  const california = isCaliforniaState(initial.licenseState);

  async function handleSave() {
    setPending(true);
    const res = await saveDepositRule({ percent, cap });
    setPending(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setSaved(true);
    startTransition(() => router.refresh());
  }

  const edit = (fn: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    fn(e.target.value);
    setSaved(false);
    setError(null);
  };

  return (
    <div className="cp-card">
      <div className="cp-card-head">Deposit at signing</div>
      <p className="cp-card-sub">
        Each new estimate asks for{" "}
        <strong>{"rule" in parsed ? depositRuleSentence(parsed.rule) : "…"}</strong>.
        Estimates already created keep the deposit they were made with.
      </p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Field label="Percent of the total">
          <input inputMode="decimal" value={percent} onChange={edit(setPercent)} placeholder="10" />
        </Field>
        <Field label="Cap in dollars (blank = no cap)">
          <input inputMode="decimal" value={cap} onChange={edit(setCap)} placeholder="1000" />
        </Field>
      </div>
      {california && (
        <p className="cp-hint">
          Your licence is in California, where a home improvement deposit can be no more than $1,000 or 10% of
          the price, whichever is less.
        </p>
      )}
      <div className="modal-actions">
        <div>
          {saved && <span className="cp-saved">✓ Saved</span>}
          {error && <span className="error-note">{error}</span>}
        </div>
        <div>
          <button className="btn-primary" onClick={handleSave} disabled={pending || "error" in parsed}>
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

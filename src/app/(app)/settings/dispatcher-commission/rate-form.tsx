"use client";

import { useState, useTransition } from "react";
import { setDispatcherCommissionRate } from "@/lib/actions/dispatcher";

export function CommissionRateForm({ initialPercent }: { initialPercent: number }) {
  const [percent, setPercent] = useState(initialPercent.toFixed(2));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await setDispatcherCommissionRate(Number(percent));
      if (res.error) return setError(res.error);
      setSaved(true);
    });
  }

  const value = Number(percent) || 0;

  return (
    <section className="est-pay">
      <label className="field">
        <span className="field-label">Commission rate</span>
        <div className="pp-url-row">
          <input
            className="est-item-price"
            inputMode="decimal"
            value={percent}
            onChange={(e) => {
              setPercent(e.target.value);
              setSaved(false);
            }}
            disabled={pending}
          />
          <span>% of the gross sale</span>
          <button className="btn-primary" onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </label>

      {error && <p className="error-note">{error}</p>}
      {saved && <p className="hint-note">Saved. New contracts use this rate from now on.</p>}

      {/* Percentages are abstract; a worked example is not. */}
      <p className="est-tax-note">
        At {value.toFixed(2)}%, a $25,000 contract pays the dispatcher{" "}
        <strong>${((25000 * value) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong>.
      </p>
      <p className="est-tax-note">
        Earned on the gross sale the moment the contract is signed, to whoever holds the lead. The
        Commissions report shows it beside the share backed by money actually collected, so you can
        decide which to pay against.
      </p>
    </section>
  );
}

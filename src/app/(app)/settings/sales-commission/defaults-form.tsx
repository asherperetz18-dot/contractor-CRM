"use client";

import { useState, useTransition } from "react";
import { computeRepCommission, moneyCents } from "@/lib/data/types";
import { saveSalesCommissionDefaults } from "@/lib/actions/rep-commission";

/**
 * The company's starting figures for a new contract.
 *
 * Changing them here does not move a contract already signed. Each
 * contract stamps its own rate when its sales team is saved, so what has
 * been earned stays earned -- otherwise editing this box would restate
 * everybody's past pay.
 */
export function SalesDefaultsForm({
  initialCommissionBp,
  initialLeadCostBp,
}: {
  initialCommissionBp: number;
  initialLeadCostBp: number;
}) {
  const [commission, setCommission] = useState((initialCommissionBp / 100).toString());
  const [leadCost, setLeadCost] = useState((initialLeadCostBp / 100).toString());
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const toBp = (v: string) => Math.round((Number(v.replace(/[^0-9.]/g, "")) || 0) * 100);

  // A worked example on a round number, because "50% of net" and "15%
  // lead cost" do not tell you what anybody actually gets paid.
  const example = computeRepCommission({
    contractCents: 8000000,
    leadCostBp: toBp(leadCost),
    commissionRateBp: toBp(commission),
    expensesCents: 4800000,
    hasCosts: true,
    rep1Bp: 10000,
    rep2Bp: 0,
  });

  return (
    <div className="est-pay">
      <div className="form-row">
        <label className="field">
          <span className="field-label">Lead cost %</span>
          <input
            className="est-item-price"
            inputMode="decimal"
            value={leadCost}
            disabled={pending}
            onChange={(e) => {
              setLeadCost(e.target.value);
              setSaved(false);
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">Commission % of net profit</span>
          <input
            className="est-item-price"
            inputMode="decimal"
            value={commission}
            disabled={pending}
            onChange={(e) => {
              setCommission(e.target.value);
              setSaved(false);
            }}
          />
        </label>
      </div>

      <div className="est-pay-balance">
        <div className="est-pay-figures">
          <div>
            <span className="est-margin-label">Example contract</span>
            <span className="mono">{moneyCents(example.contractCents)}</span>
          </div>
          <div>
            <span className="est-margin-label">Lead cost</span>
            <span className="mono">−{moneyCents(example.leadCostCents)}</span>
          </div>
          <div>
            <span className="est-margin-label">Costs</span>
            <span className="mono">−{moneyCents(example.expensesCents)}</span>
          </div>
          <div>
            <span className="est-margin-label">Net profit</span>
            <span className="mono">{moneyCents(example.netProfitCents)}</span>
          </div>
          <div>
            <span className="est-margin-label">Rep is paid</span>
            <span className="mono">{moneyCents(example.poolCents)}</span>
          </div>
        </div>
        <div className="est-pay-verdict">
          On an $80,000 job that spent $48,000. Both figures can be changed on any individual
          contract.
        </div>
      </div>

      {error && <p className="error-note">{error}</p>}
      {saved && <p className="hint-note">Saved. New contracts start from these figures.</p>}

      <button
        className="btn-primary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError("");
            const res = await saveSalesCommissionDefaults({
              commissionBp: toBp(commission),
              leadCostBp: toBp(leadCost),
            });
            if (res.error) return setError(res.error);
            setSaved(true);
          })
        }
      >
        {pending ? "Saving…" : "Save defaults"}
      </button>

      <p className="est-tax-note">
        Contracts already signed keep the rate they were saved with, so changing this cannot
        rewrite what anyone has already earned.
      </p>
    </div>
  );
}

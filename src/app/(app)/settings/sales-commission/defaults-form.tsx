"use client";

import { useState, useTransition } from "react";
import { computeRepCommission, moneyCents } from "@/lib/data/types";
import { saveSalesCommissionDefaults } from "@/lib/actions/rep-commission";
import { saveCloserDefault } from "@/lib/actions/closer-defaults";

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
  initialCloserBp,
}: {
  initialCommissionBp: number;
  initialLeadCostBp: number;
  initialCloserBp: number;
}) {
  const [commission, setCommission] = useState((initialCommissionBp / 100).toString());
  const [leadCost, setLeadCost] = useState((initialLeadCostBp / 100).toString());
  const [closer, setCloser] = useState((initialCloserBp / 100).toString());
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

  // The closer's cut of that same pool. Two different bases meet here:
  // the closer's figure is a share of NET PROFIT, while the split inside
  // a contract is a share of the commission pool -- so 5% against a 50%
  // pool is a tenth of the pool, not a twentieth of the job. Same
  // conversion migration 0135 does at signature; shown here so the
  // number is checkable before it is ever paid.
  const commissionBp = toBp(commission);
  const closerBp = toBp(closer);
  const closerPoolBp =
    commissionBp > 0 ? Math.min(Math.round((closerBp / commissionBp) * 10000), 10000) : 0;
  const closerCents = Math.round((example.poolCents * closerPoolBp) / 10000);
  const repCents = example.poolCents - closerCents;
  const closerOverPool = commissionBp > 0 && closerBp >= commissionBp;

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
        <label className="field">
          <span className="field-label">Closer % of net profit</span>
          <input
            className="est-item-price"
            inputMode="decimal"
            value={closer}
            disabled={pending}
            onChange={(e) => {
              setCloser(e.target.value);
              setSaved(false);
            }}
          />
        </label>
      </div>

      <p className="est-tax-note">
        The closer&rsquo;s share comes out of the rep&rsquo;s, not on top of it. A 5% closer
        against a 50% commission leaves the rep on 45%.
      </p>

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
            <span className="mono">{moneyCents(repCents)}</span>
          </div>
          <div>
            <span className="est-margin-label">Closer is paid</span>
            <span className="mono">{moneyCents(closerCents)}</span>
          </div>
        </div>
        <div className="est-pay-verdict">
          On an $80,000 job that spent $48,000, with a closer on the lead. Every figure can be
          changed on any individual contract, and the closer&rsquo;s share on any individual
          lead.
        </div>
      </div>

      {closerOverPool && (
        <p className="error-note">
          The closer&rsquo;s share is the whole commission or more, so the rep would be paid
          nothing. Lower it below the commission rate.
        </p>
      )}
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
            // Second write, and deliberately after the first: the closer
            // default lives on the company profile beside these two but
            // belongs to a different feature. If it fails, the message
            // says which figure did not save rather than implying none
            // of them did.
            const closerRes = await saveCloserDefault(toBp(closer));
            if (closerRes.error) {
              return setError(
                `Commission and lead cost saved, but the closer share did not: ${closerRes.error}`
              );
            }
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

"use client";

import { useEffect, useState, useTransition } from "react";
import { computeRepCommission, moneyCents } from "@/lib/data/types";
import {
  getCommissionReps,
  getSalesTeam,
  saveSalesTeam,
  type SalesTeam,
} from "@/lib/actions/rep-commission";
import { getJobExpenses } from "@/lib/actions/job-expenses";

/**
 * Who is paid on this contract, and what it comes to.
 *
 * The figure is shown live from the costs recorded so far, so it moves as
 * the job spends. That is honest rather than convenient: commission here
 * comes out of net profit, so it is not knowable at signature, and a
 * number that pretended otherwise would have to be taken back later.
 */
export function SalesTeamPanel({
  estimateId,
  leadId,
  contractCents,
  canEdit,
}: {
  estimateId: string;
  leadId: string;
  contractCents: number;
  canEdit: boolean;
}) {
  const [team, setTeam] = useState<SalesTeam | null>(null);
  const [reps, setReps] = useState<{ id: string; name: string }[]>([]);
  const [expensesCents, setExpensesCents] = useState(0);
  const [hasCosts, setHasCosts] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [res, people, costs] = await Promise.all([
        getSalesTeam(estimateId),
        getCommissionReps(),
        getJobExpenses(leadId),
      ]);
      if (cancelled) return;
      if (res.error) return setError(res.error);
      setTeam(res.team ?? null);
      setReps(people);
      const rows = costs.expenses ?? [];
      setExpensesCents(rows.reduce((s, e) => s + e.amount_cents, 0));
      // Whether any cost exists at all, not whether they sum to zero --
      // the difference between a measured job and an unmeasured one.
      setHasCosts(rows.length > 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [estimateId, leadId]);

  if (error && !team) return <p className="error-note">{error}</p>;
  if (!team) return null;

  const detail = computeRepCommission({
    contractCents,
    leadCostBp: team.lead_cost_bp,
    commissionRateBp: team.commission_rate_bp,
    expensesCents,
    hasCosts,
    rep1Bp: team.sales_rep_1_bp,
    rep2Bp: team.sales_rep_2 ? team.sales_rep_2_bp : 0,
  });

  const set = (patch: Partial<SalesTeam>) => {
    setTeam((t) => (t ? { ...t, ...patch } : t));
    setSaved("");
  };
  const pct = (bp: number) => (bp / 100).toString();
  const toBp = (v: string) => Math.round((Number(v.replace(/[^0-9.]/g, "")) || 0) * 100);
  const repName = (id: string | null) =>
    reps.find((r) => r.id === id)?.name ?? "—";

  return (
    <section className="est-pay">
      <div className="est-pay-head">
        <div>
          <h2 className="est-pay-title">Sales team</h2>
          <p className="est-pay-sub">
            Commission comes out of what the job actually makes: the contract, less the lead
            cost, less what was spent. Not visible to the customer.
          </p>
        </div>
      </div>

      <div className="form-row">
        <label className="field">
          <span className="field-label">Lead cost %</span>
          <input
            className="est-item-price"
            inputMode="decimal"
            value={pct(team.lead_cost_bp)}
            disabled={!canEdit || pending}
            onChange={(e) => set({ lead_cost_bp: toBp(e.target.value) })}
          />
        </label>
        <label className="field">
          <span className="field-label">Commission % of net</span>
          <input
            className="est-item-price"
            inputMode="decimal"
            value={pct(team.commission_rate_bp)}
            disabled={!canEdit || pending}
            onChange={(e) => set({ commission_rate_bp: toBp(e.target.value) })}
          />
        </label>
      </div>

      <div className="form-row">
        <label className="field">
          <span className="field-label">Salesperson</span>
          <select
            value={team.sales_rep_1 ?? ""}
            disabled={!canEdit || pending}
            onChange={(e) => set({ sales_rep_1: e.target.value || null })}
          >
            <option value="">— none —</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Share %</span>
          <input
            className="est-item-price"
            inputMode="decimal"
            value={pct(team.sales_rep_1_bp)}
            disabled={!canEdit || pending || !team.sales_rep_2}
            onChange={(e) => {
              const one = toBp(e.target.value);
              // The other share follows, so the two always make a whole.
              set({ sales_rep_1_bp: one, sales_rep_2_bp: 10000 - one });
            }}
          />
        </label>
      </div>

      <div className="form-row">
        <label className="field">
          <span className="field-label">Second salesperson</span>
          <select
            value={team.sales_rep_2 ?? ""}
            disabled={!canEdit || pending}
            onChange={(e) => {
              const id = e.target.value || null;
              // Adding a second rep splits it evenly to begin with;
              // removing them gives the whole share back to the first.
              set(
                id
                  ? { sales_rep_2: id, sales_rep_1_bp: 5000, sales_rep_2_bp: 5000 }
                  : { sales_rep_2: null, sales_rep_1_bp: 10000, sales_rep_2_bp: 0 }
              );
            }}
          >
            <option value="">— none —</option>
            {reps
              .filter((r) => r.id !== team.sales_rep_1)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Share %</span>
          <input
            className="est-item-price"
            inputMode="decimal"
            value={pct(team.sales_rep_2_bp)}
            disabled={!canEdit || pending || !team.sales_rep_2}
            onChange={(e) => {
              const two = toBp(e.target.value);
              set({ sales_rep_2_bp: two, sales_rep_1_bp: 10000 - two });
            }}
          />
        </label>
      </div>

      {detail.unmeasured ? (
        // A job with nothing spent on it is not maximally profitable, it
        // is unmeasured. Printing a figure here would promise a rep the
        // commission on an $80,000 sale rather than on its margin.
        <div className="est-pay-balance">
          <div className="est-pay-verdict">
            <strong>No costs recorded on this job yet.</strong> Commission comes out of net
            profit, so there is nothing to work it out from — it will appear here as costs are
            entered.
          </div>
        </div>
      ) : (
        <div
          className={"est-pay-balance" + (detail.poolCents > 0 ? " est-pay-ok" : " est-pay-off")}
        >
          <div className="est-pay-figures">
            <div>
              <span className="est-margin-label">Contract</span>
              <span className="mono">{moneyCents(detail.contractCents)}</span>
            </div>
            <div>
              <span className="est-margin-label">Lead cost</span>
              <span className="mono">−{moneyCents(detail.leadCostCents)}</span>
            </div>
            <div>
              <span className="est-margin-label">Spent</span>
              <span className="mono">−{moneyCents(detail.expensesCents)}</span>
            </div>
            <div>
              <span className="est-margin-label">Net profit</span>
              <span className="mono">{moneyCents(detail.netProfitCents)}</span>
            </div>
            <div>
              <span className="est-margin-label">Commission</span>
              <span className="mono">{moneyCents(detail.poolCents)}</span>
            </div>
          </div>
          <div className="est-pay-verdict">
            {repName(team.sales_rep_1)} {moneyCents(detail.rep1Cents)}
            {team.sales_rep_2 && (
              <>
                {" · "}
                {repName(team.sales_rep_2)} {moneyCents(detail.rep2Cents)}
              </>
            )}
            {detail.netProfitCents <= 0 && " · this job has not made money, so nothing is owed"}
          </div>
        </div>
      )}

      {error && <p className="error-note">{error}</p>}
      {saved && <p className="hint-note">{saved}</p>}
      {canEdit && (
        <button
          className="btn-ghost est-add-row"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError("");
              const res = await saveSalesTeam(estimateId, team);
              if (res.error) return setError(res.error);
              setSaved("Sales team saved");
            })
          }
        >
          {pending ? "Saving…" : "Save sales team"}
        </button>
      )}
    </section>
  );
}

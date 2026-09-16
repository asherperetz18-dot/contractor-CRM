"use client";

import { memo, useEffect, useState, useTransition } from "react";
import { computeRepCommission, moneyCents } from "@/lib/data/types";
import {
  getCommissionReps,
  getSalesTeam,
  getSalesTeamChanges,
  saveSalesTeam,
  type CommissionRep,
  type SalesTeam,
  type SalesTeamChangeRow,
} from "@/lib/actions/rep-commission";
import { repDropdownOptions } from "@/lib/data/rep-options";
import { seatHoldersChanged } from "@/lib/data/sales-team-changes";
import { getJobExpenses } from "@/lib/actions/job-expenses";

/**
 * Who is paid on this contract, and what it comes to.
 *
 * The figure is shown live from the costs recorded so far, so it moves as
 * the job spends. That is honest rather than convenient: commission here
 * comes out of net profit, so it is not knowable at signature, and a
 * number that pretended otherwise would have to be taken back later.
 */
// memo: the estimate builder re-renders on every keystroke; this panel's
// props are stable then, so it sits those renders out.
export const SalesTeamPanel = memo(function SalesTeamPanel({
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
  // The team as last loaded or saved, so Save can tell a seat moving to
  // a different person from the numbers being tuned.
  const [savedTeam, setSavedTeam] = useState<SalesTeam | null>(null);
  const [reps, setReps] = useState<CommissionRep[]>([]);
  const [expensesCents, setExpensesCents] = useState(0);
  const [hasCosts, setHasCosts] = useState(false);
  const [changes, setChanges] = useState<SalesTeamChangeRow[]>([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [res, people, costs, log] = await Promise.all([
        getSalesTeam(estimateId),
        getCommissionReps(),
        getJobExpenses(leadId),
        // Pay history, so it rides the same gate as editing.
        canEdit ? getSalesTeamChanges(estimateId) : Promise.resolve({ changes: [] }),
      ]);
      if (cancelled) return;
      if (res.error) return setError(res.error);
      setTeam(res.team ?? null);
      setSavedTeam(res.team ?? null);
      setReps(people);
      const rows = costs.expenses ?? [];
      setExpensesCents(rows.reduce((s, e) => s + e.amount_cents, 0));
      // Whether any cost exists at all, not whether they sum to zero --
      // the difference between a measured job and an unmeasured one.
      setHasCosts(rows.length > 0);
      setChanges(log.changes ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [estimateId, leadId, canEdit]);

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
    closerPoolBp: team.closer_id ? team.closer_pool_bp : 0,
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
            {repDropdownOptions(reps, [team.sales_rep_1]).map((r) => (
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
            {repDropdownOptions(reps, [team.sales_rep_2])
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

      {/* The closer's cut comes off the pool first; the rep shares
          above split what is left, so editing here never rebalances
          them. Seeded from the lead at signature, adjustable after. */}
      <div className="form-row">
        <label className="field">
          <span className="field-label">Closer</span>
          <select
            value={team.closer_id ?? ""}
            disabled={!canEdit || pending}
            onChange={(e) => set({ closer_id: e.target.value || null })}
          >
            <option value="">— none —</option>
            {repDropdownOptions(reps, [team.closer_id])
              .filter((r) => r.id !== team.sales_rep_1 && r.id !== team.sales_rep_2)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Share % of pool</span>
          <input
            className="est-item-price"
            inputMode="decimal"
            value={pct(team.closer_pool_bp)}
            disabled={!canEdit || pending || !team.closer_id}
            onChange={(e) => set({ closer_pool_bp: toBp(e.target.value) })}
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
            {team.closer_id && (
              <>
                {" · "}
                {repName(team.closer_id)} (closer) {moneyCents(detail.closerCents)}
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
          onClick={() => {
            // Moving a seat restates pay -- the old rep's line leaves the
            // statement while this list and the document keep naming
            // whoever sold the job. Said out loud before it happens,
            // because it reads like a rename and isn't one.
            if (
              savedTeam &&
              seatHoldersChanged(savedTeam, team) &&
              !window.confirm(
                "This changes who is PAID on this signed contract — the commission " +
                  "line moves to the new person and off the old one's statement. " +
                  "The document keeps naming whoever sold the job, and the change " +
                  "is recorded in the history below. Move the pay?"
              )
            )
              return;
            startTransition(async () => {
              setError("");
              const res = await saveSalesTeam(estimateId, team);
              if (res.error) return setError(res.error);
              setSaved("Sales team saved");
              setSavedTeam(team);
              const log = await getSalesTeamChanges(estimateId);
              setChanges(log.changes ?? []);
            });
          }}
        >
          {pending ? "Saving…" : "Save sales team"}
        </button>
      )}

      {canEdit && changes.length > 0 && (
        // Seats decide pay and the statement follows whoever holds them
        // now, so every edit since signature is on the record here.
        <div className="est-team-log">
          <h3 className="est-team-log-title">Change history</h3>
          <ul className="est-team-log-list">
            {changes.map((c) => (
              <li key={c.id}>
                <span className="est-team-log-when">
                  {new Date(c.changedAt).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                  {" · "}
                  {c.changedByName}
                </span>{" "}
                {c.lines.join(" · ")}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
});

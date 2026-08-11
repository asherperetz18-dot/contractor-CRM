"use client";

import { useEffect, useState, useTransition } from "react";
import {
  centsFromInput,
  expensesByPhase,
  formatMarginPct,
  moneyCents,
  phaseProfit,
  depositCents,
  type EstimatePayment,
  type JobExpense,
} from "@/lib/data/types";
import {
  assignExpensePhase,
  createJobExpense,
  deleteJobExpense,
  getJobExpenses,
} from "@/lib/actions/job-expenses";

const BLANK = { vendor: "", category: "", description: "", amount: "", spentOn: "" };

/**
 * What the job cost, against what it bills, phase by phase.
 *
 * Costs hang off the lead rather than this estimate, so a contract, its
 * change orders and its completion all draw on the same pile -- a job
 * that went over on tile went over once, not once per document.
 *
 * Unfiled costs are shown as their own line rather than spread across
 * the phases. Spreading would move every phase's margin by an amount
 * nobody chose, and the resulting percentages would look precise while
 * being invented.
 */
export function JobCosts({
  leadId,
  payments,
  totalCents,
  depositPercentBp,
  depositCapCents,
  canEdit,
}: {
  leadId: string;
  payments: EstimatePayment[];
  totalCents: number;
  depositPercentBp: number;
  depositCapCents: number;
  canEdit: boolean;
}) {
  const [expenses, setExpenses] = useState<JobExpense[] | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(BLANK);
  const [pending, startTransition] = useTransition();
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getJobExpenses(leadId);
      if (cancelled) return;
      if (res.error) return setError(res.error);
      setExpenses(res.expenses ?? []);
      setError("");
    })();
    return () => {
      cancelled = true;
    };
  }, [leadId, reloadKey]);

  // Error before loading. The other order strands the panel on "Loading…"
  // for good, because a failed load never sets the list that clears it.
  if (error && !expenses) return <p className="error-note">{error}</p>;
  if (!expenses) return null;

  const byPhase = expensesByPhase(expenses);
  const deposit = depositCents(totalCents, depositPercentBp, depositCapCents);
  const unfiled = byPhase.get(null) ?? [];
  const totalCost = expenses.reduce((s, e) => s + e.amount_cents, 0);
  const jobProfit = phaseProfit(totalCents, expenses);

  function add() {
    setError("");
    startTransition(async () => {
      const res = await createJobExpense({
        leadId,
        estimatePaymentId: null,
        vendor: draft.vendor,
        category: draft.category,
        description: draft.description,
        amountCents: centsFromInput(draft.amount),
        spentOn: draft.spentOn,
      });
      if (res.error) return setError(res.error);
      setDraft(BLANK);
      setAdding(false);
      setReloadKey((k) => k + 1);
    });
  }

  return (
    <section className="est-pay">
      <div className="est-pay-head">
        <div>
          <h2 className="est-pay-title">Job costs</h2>
          <p className="est-pay-sub">
            What this job has actually spent, filed against the phase it belongs to. Costs
            follow the job, so change orders and the original contract share one pile.
          </p>
        </div>
        {canEdit && (
          <div className="est-pay-actions">
            <button className="btn-ghost" onClick={() => setAdding((a) => !a)} disabled={pending}>
              {adding ? "Cancel" : "+ Add cost"}
            </button>
          </div>
        )}
      </div>

      {adding && (
        <div className="est-pay-balance" style={{ display: "block" }}>
          <div className="form-row">
            <input
              className="est-item-name"
              placeholder="Vendor (e.g. Home Depot)"
              value={draft.vendor}
              onChange={(e) => setDraft({ ...draft, vendor: e.target.value })}
            />
            <input
              className="est-item-name"
              placeholder="Category (e.g. Job Materials)"
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            />
          </div>
          <input
            className="est-item-desc"
            placeholder="What it was for"
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
          <div className="form-row">
            <input
              className="est-item-price"
              inputMode="decimal"
              placeholder="Amount"
              value={draft.amount}
              onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
            />
            <input
              className="est-item-price"
              type="date"
              value={draft.spentOn}
              onChange={(e) => setDraft({ ...draft, spentOn: e.target.value })}
            />
            <button className="btn-primary small" onClick={add} disabled={pending}>
              {pending ? "Saving…" : "Save cost"}
            </button>
          </div>
        </div>
      )}

      {expenses.length === 0 ? (
        <p className="empty-hint">
          No costs recorded on this job yet. Add them here, or connect QuickBooks to pull
          them in from the project automatically.
        </p>
      ) : (
        <>
          {/* Phase by phase: what it bills, what it spent, what is left.
              Plain data-table, not est-pay-table: that one's phone layout
              stacks each row into a card and treats the last cell as an
              actions column -- full width, label suppressed. Margin is the
              last cell here and real data, so it lost its heading and read
              as a stray dash. data-table scrolls sideways instead and
              every column keeps its header. */}
          <table className="data-table">
            <thead>
              <tr>
                <th>Phase</th>
                <th className="right">Bills</th>
                <th className="right">Cost</th>
                <th className="right">Profit</th>
                <th className="right">Margin</th>
              </tr>
            </thead>
            <tbody>
              <tr className="est-pay-deposit">
                <td>
                  <div className="ur-name">Deposit</div>
                </td>
                <td className="right mono" data-label="Bills">
                  {moneyCents(deposit)}
                </td>
                <td className="right mono" data-label="Cost">
                  —
                </td>
                <td className="right mono" data-label="Profit">
                  —
                </td>
                <td className="right mono" data-label="Margin">
                  —
                </td>
              </tr>
              {payments.map((p) => {
                const pp = phaseProfit(p.amount_cents, byPhase.get(p.id) ?? []);
                return (
                  <tr key={p.id}>
                    <td>
                      <div className="ur-name">{p.name || "Unnamed phase"}</div>
                    </td>
                    <td className="right mono" data-label="Bills">
                      {moneyCents(pp.billedCents)}
                    </td>
                    <td className="right mono" data-label="Cost">
                      {pp.costCents ? moneyCents(pp.costCents) : "—"}
                    </td>
                    <td className="right mono" data-label="Profit">
                      {pp.costCents ? moneyCents(pp.profitCents) : "—"}
                    </td>
                    <td className="right mono" data-label="Margin">
                      {pp.costCents ? formatMarginPct(pp.pct) : "—"}
                    </td>
                  </tr>
                );
              })}
              {unfiled.length > 0 && (
                <tr>
                  <td>
                    <div className="ur-name">Not filed to a phase</div>
                    <div className="ur-add-phone">
                      {unfiled.length} cost{unfiled.length === 1 ? "" : "s"} · not counted in any
                      phase above
                    </div>
                  </td>
                  <td className="right mono" data-label="Bills">
                    —
                  </td>
                  <td className="right mono" data-label="Cost">
                    {moneyCents(unfiled.reduce((s, e) => s + e.amount_cents, 0))}
                  </td>
                  <td className="right mono" data-label="Profit">
                    —
                  </td>
                  <td className="right mono" data-label="Margin">
                    —
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div
            className={
              "est-pay-balance" + (jobProfit.profitCents >= 0 ? " est-pay-ok" : " est-pay-off")
            }
          >
            <div className="est-pay-figures">
              <div>
                <span className="est-margin-label">Contract</span>
                <span className="mono">{moneyCents(totalCents)}</span>
              </div>
              <div>
                <span className="est-margin-label">Spent</span>
                <span className="mono">{moneyCents(totalCost)}</span>
              </div>
              <div>
                <span className="est-margin-label">Profit</span>
                <span className="mono">{moneyCents(jobProfit.profitCents)}</span>
              </div>
              <div>
                <span className="est-margin-label">Margin</span>
                <span className="mono">{formatMarginPct(jobProfit.pct)}</span>
              </div>
            </div>
            <div className="est-pay-verdict">
              {/* Every cost counts here, filed or not -- the job total is
                  the one figure that must not depend on whether somebody
                  got round to sorting the receipts. */}
              Whole job, including costs not yet filed to a phase.
            </div>
          </div>

          {/* The receipts themselves, each with the phase it is filed to. */}
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Vendor</th>
                <th>What for</th>
                <th className="right">Amount</th>
                <th>Phase</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id}>
                  <td className="mono" data-label="Date">
                    {new Date(e.spent_on + "T00:00:00").toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </td>
                  <td data-label="Vendor">
                    {e.vendor || "—"}
                    {e.source === "quickbooks" && (
                      <div className="est-tax-note">from QuickBooks</div>
                    )}
                  </td>
                  <td data-label="What for">
                    {e.description || e.category || "—"}
                    {e.description && e.category && (
                      <div className="est-tax-note">{e.category}</div>
                    )}
                  </td>
                  <td className="right mono" data-label="Amount">
                    {moneyCents(e.amount_cents)}
                  </td>
                  <td data-label="Phase">
                    {canEdit ? (
                      <select
                        value={e.estimate_payment_id ?? ""}
                        disabled={pending}
                        onChange={(ev) =>
                          startTransition(async () => {
                            const res = await assignExpensePhase(e.id, ev.target.value || null);
                            if (res.error) return setError(res.error);
                            setReloadKey((k) => k + 1);
                          })
                        }
                      >
                        <option value="">Not filed</option>
                        {payments.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name || "Unnamed phase"}
                          </option>
                        ))}
                      </select>
                    ) : (
                      payments.find((p) => p.id === e.estimate_payment_id)?.name || "Not filed"
                    )}
                  </td>
                  <td>
                    {canEdit && (
                      <button
                        className="btn-ghost est-row-remove"
                        aria-label="Remove cost"
                        disabled={pending}
                        onClick={() =>
                          startTransition(async () => {
                            const res = await deleteJobExpense(e.id);
                            if (res.error) return setError(res.error);
                            setReloadKey((k) => k + 1);
                          })
                        }
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {error && <p className="error-note">{error}</p>}
    </section>
  );
}

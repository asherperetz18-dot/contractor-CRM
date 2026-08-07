"use client";

import { useState, useTransition } from "react";
import {
  balanceAfterDepositCents,
  centsFromInput,
  centsToInput,
  depositCents,
  moneyCents,
  paymentPercentOfTotal,
  scheduleBalance,
  splitEvenlyCents,
  type EstimatePayment,
} from "@/lib/data/types";
import { generateEstimateSchedule, saveEstimatePayments } from "@/lib/actions/estimates";

type Row = { key: string; name: string; description: string; amount: string };

let seq = 0;
const newKey = () => `pay-${(seq += 1)}`;

function toRow(p: EstimatePayment): Row {
  return {
    key: newKey(),
    name: p.name,
    description: p.description ?? "",
    amount: centsToInput(p.amount_cents),
  };
}

export function PaymentSchedule({
  estimateId,
  totalCents,
  depositPercentBp,
  depositCapCents,
  payments,
  locked,
  onChanged,
}: {
  estimateId: string;
  totalCents: number;
  depositPercentBp: number;
  depositCapCents: number;
  payments: EstimatePayment[];
  locked: boolean;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(payments.map(toRow));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // The deposit is computed, never typed. On a $28,500 job 10% is $2,850
  // but the cap holds it at $1,000 -- that ceiling is California's limit
  // for home improvement contracts, so it must not be editable per job.
  const deposit = depositCents(totalCents, depositPercentBp, depositCapCents);
  const balance = balanceAfterDepositCents(totalCents, deposit);
  const capped = Math.round((totalCents * depositPercentBp) / 10000) > deposit && totalCents > 0;

  const parsed = rows.map((r) => ({ amount_cents: centsFromInput(r.amount) }));
  const bal = scheduleBalance(totalCents, deposit, parsed);

  function patch(key: string, changes: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...changes } : r)));
    setSaved(null);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await saveEstimatePayments(
        estimateId,
        rows.map((r) => ({
          name: r.name,
          description: r.description || null,
          amount_cents: centsFromInput(r.amount),
        }))
      );
      if (res.error) return setError(res.error);
      setSaved(
        res.recalled
          ? "Payment schedule saved · recalled from the customer, send again when ready"
          : "Payment schedule saved"
      );
      onChanged();
    });
  }

  function generate() {
    setError(null);
    startTransition(async () => {
      const res = await generateEstimateSchedule(estimateId);
      if (res.error) return setError(res.error);
      onChanged();
    });
  }

  // Spreads the balance across the phases that already exist, to the cent
  // -- an even split that loses a penny leaves the schedule permanently
  // unbalanced and the rep hunting for it.
  function splitEvenly() {
    if (rows.length === 0) return;
    const amounts = splitEvenlyCents(balance, rows.length);
    setRows((prev) => prev.map((r, i) => ({ ...r, amount: centsToInput(amounts[i] ?? 0) })));
    setSaved(null);
  }

  // Puts whatever is unaccounted for onto the last phase, so a schedule is
  // never one rounding cent away from being sendable.
  function applyDifference() {
    if (rows.length === 0 || bal.differenceCents === 0) return;
    setRows((prev) =>
      prev.map((r, i) =>
        i === prev.length - 1
          ? { ...r, amount: centsToInput(centsFromInput(r.amount) + bal.differenceCents) }
          : r
      )
    );
    setSaved(null);
  }

  return (
    <section className="est-pay">
      <div className="est-pay-head">
        <div>
          <h2 className="est-pay-title">Payments &amp; terms</h2>
          <p className="est-pay-sub">
            Deposit is {(depositPercentBp / 100).toFixed(0)}% or up to{" "}
            {moneyCents(depositCapCents)} &mdash; whichever is less. The balance bills as work
            completes.
          </p>
        </div>
        {!locked && (
          <div className="est-pay-actions">
            <button className="btn-ghost" onClick={generate} disabled={pending || !totalCents}>
              Build schedule
            </button>
            <button className="btn-ghost" onClick={splitEvenly} disabled={pending || !rows.length}>
              Split evenly
            </button>
            <button
              className="btn-ghost"
              onClick={() => {
                setRows((p) => [...p, { key: newKey(), name: "", description: "", amount: "0.00" }]);
                setSaved(null);
              }}
              disabled={pending}
            >
              + Add phase
            </button>
          </div>
        )}
      </div>

      <table className="data-table est-pay-table">
        <thead>
          <tr>
            <th>Name &amp; description</th>
            <th className="right">Percent</th>
            <th className="right">Amount</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr className="est-pay-deposit">
            <td>
              <div className="ur-name">Deposit</div>
              <div className="ur-add-phone">
                Due upon contract signing
                {capped && (
                  <span className="est-pay-capped">
                    {" "}
                    · capped at {moneyCents(depositCapCents)}
                  </span>
                )}
              </div>
            </td>
            <td className="right mono">
              {totalCents ? `${paymentPercentOfTotal(deposit, totalCents)!.toFixed(2)}%` : "—"}
            </td>
            <td className="right mono">{moneyCents(deposit)}</td>
            <td></td>
          </tr>

          {rows.map((r) => {
            const cents = centsFromInput(r.amount);
            const pct = paymentPercentOfTotal(cents, totalCents);
            return (
              <tr key={r.key}>
                <td>
                  <input
                    className="est-item-name"
                    placeholder="e.g. At completion of rough-in"
                    value={r.name}
                    disabled={locked}
                    onChange={(e) => patch(r.key, { name: e.target.value })}
                  />
                  <input
                    className="est-item-desc"
                    placeholder="When this payment is due (shown to customer)"
                    value={r.description}
                    disabled={locked}
                    onChange={(e) => patch(r.key, { description: e.target.value })}
                  />
                </td>
                <td className="right mono">{pct === null ? "—" : `${pct.toFixed(2)}%`}</td>
                <td className="right">
                  <input
                    className="est-item-price"
                    inputMode="decimal"
                    value={r.amount}
                    disabled={locked}
                    onChange={(e) => patch(r.key, { amount: e.target.value })}
                  />
                </td>
                <td>
                  {!locked && (
                    <button
                      className="btn-ghost est-row-remove"
                      onClick={() => {
                        setRows((p) => p.filter((x) => x.key !== r.key));
                        setSaved(null);
                      }}
                      aria-label="Remove phase"
                    >
                      ×
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className={"est-pay-balance" + (bal.balanced ? " est-pay-ok" : " est-pay-off")}>
        <div className="est-pay-figures">
          <div>
            <span className="est-margin-label">Deposit + phases</span>
            <span className="mono">{moneyCents(bal.scheduledCents)}</span>
          </div>
          <div>
            <span className="est-margin-label">Estimate total</span>
            <span className="mono">{moneyCents(totalCents)}</span>
          </div>
          <div>
            <span className="est-margin-label">Difference</span>
            <span className="mono">{moneyCents(bal.differenceCents)}</span>
          </div>
        </div>
        <div className="est-pay-verdict">
          {bal.balanced ? (
            rows.length > 0 ? (
              <>Schedule balanced &mdash; every dollar has a due date.</>
            ) : (
              <>No progress payments yet. The balance of {moneyCents(balance)} is unscheduled.</>
            )
          ) : (
            <>
              {moneyCents(Math.abs(bal.differenceCents))}{" "}
              {bal.differenceCents > 0 ? "is not scheduled yet" : "more than the estimate total"}.
              {!locked && (
                <button className="btn-ghost est-pay-fix" onClick={applyDifference}>
                  Put it on the last phase
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {error && <p className="error-note">{error}</p>}
      {saved && <p className="hint-note">{saved}</p>}

      {!locked && (
        <button className="btn-ghost est-add-row" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save payment schedule"}
        </button>
      )}
    </section>
  );
}

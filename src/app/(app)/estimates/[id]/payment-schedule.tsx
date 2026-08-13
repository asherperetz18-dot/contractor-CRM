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
  depositPayment,
  pendingPayment,
  paymentMethodLabel,
  type EstimatePayment,
  type PortalPayment,
} from "@/lib/data/types";
import { generateEstimateSchedule, saveEstimatePayments } from "@/lib/actions/estimates";
import { PhaseBilling } from "./phase-billing";
import { RecordPayment } from "./record-payment";

type Row = {
  key: string;
  name: string;
  description: string;
  amount: string;
  /**
   * What the rep typed in the percent box, held raw while they are in it.
   *
   * Null means "derive it from the amount", which is the resting state.
   * Without this, typing "3" in a 33% field would immediately be
   * rewritten to "3.00%" by the recalculation and the second digit would
   * never land.
   */
  percentDraft?: string | null;
};

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
  paid,
  locked,
  onChanged,
}: {
  estimateId: string;
  totalCents: number;
  depositPercentBp: number;
  depositCapCents: number;
  payments: EstimatePayment[];
  paid: PortalPayment[];
  locked: boolean;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(payments.map(toRow));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * Re-reads the schedule when the server's copy actually changes.
   *
   * useState only takes its argument the first time. Build schedule wrote
   * five named phases, refreshed the page, and this component kept
   * rendering the rows it had captured on mount -- so a button that had
   * done exactly what it promised looked completely dead, with no error
   * to explain it. Anything else that rewrites the schedule from outside
   * this panel had the same problem.
   *
   * Compared on content rather than identity: a refresh hands over new
   * objects every time, so an identity check would reset the rows on
   * every render and discard whatever was being typed.
   */
  const signature = payments
    .map((p) => `${p.id}:${p.name}:${p.description ?? ""}:${p.amount_cents}`)
    .join("|");
  const [seenSignature, setSeenSignature] = useState(signature);
  if (signature !== seenSignature) {
    setSeenSignature(signature);
    setRows(payments.map(toRow));
    setSaved(null);
  }

  // The deposit is computed, never typed. On a $28,500 job 10% is $2,850
  // but the cap holds it at $1,000 -- that ceiling is California's limit
  // for home improvement contracts, so it must not be editable per job.
  const deposit = depositCents(totalCents, depositPercentBp, depositCapCents);
  const balance = balanceAfterDepositCents(totalCents, deposit);
  const capped = Math.round((totalCents * depositPercentBp) / 10000) > deposit && totalCents > 0;

  // Money actually received, as opposed to money scheduled.
  const depositPaid = depositPayment(paid);
  const settling = pendingPayment(paid);

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
      // Shown from what the server says it wrote, rather than waiting for
      // a refresh to hand this component new props -- which it does not
      // do here. The rows were saved either way; only the screen was
      // stale, which is exactly the kind of silence that reads as a
      // broken button.
      if (res.phases) {
        setRows(res.phases.map((p, i) => toRow({
          id: `generated-${i}`,
          name: p.name,
          description: p.description,
          amount_cents: p.amount_cents,
        } as EstimatePayment)));
        setSaved("Schedule built");
      }
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
            {/* data-label feeds the phone layout, where the header row is
                hidden and each cell has to name itself. */}
            <td className="right mono" data-label="Percent">
              {totalCents ? `${paymentPercentOfTotal(deposit, totalCents)!.toFixed(2)}%` : "—"}
            </td>
            <td className="right mono" data-label="Amount">
              {moneyCents(deposit)}
              {depositPaid && (
                <div className="est-paid-flag">
                  Paid {paymentMethodLabel(depositPaid.method)}
                  {depositPaid.paid_at
                    ? " · " + new Date(depositPaid.paid_at).toLocaleDateString("en-US")
                    : ""}
                </div>
              )}
              {!depositPaid && settling && (
                <div className="est-settling-flag">
                  {paymentMethodLabel(settling.method) || "Payment"} clearing
                </div>
              )}
            </td>
            <td>
              {/* Cash and cheques are most contractors' normal case, so
                  the deposit needs a way in that isn't Stripe. */}
              {locked && !depositPaid && deposit > 0 && (
                <RecordPayment
                  estimateId={estimateId}
                  suggestedCents={deposit}
                  label="Deposit"
                />
              )}
            </td>
          </tr>

          {rows.map((r, i) => {
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
                <td className="right" data-label="Percent">
                  {/* Typeable, not just displayed. Contractors think in
                      percentages -- 10 / 30 / 30 / 20 / 10 -- and were
                      having to do the arithmetic themselves and type the
                      dollars. The amount stays the stored figure: a
                      contract commits the customer to dollars, so the
                      percentage is a way of entering one, not a second
                      source of truth that could drift from it. */}
                  {locked ? (
                    <span className="mono">{pct === null ? "—" : `${pct.toFixed(2)}%`}</span>
                  ) : (
                    <input
                      className="est-item-price"
                      inputMode="decimal"
                      // The typed text while in the box, the computed
                      // figure the rest of the time.
                      value={
                        r.percentDraft ?? (pct === null ? "" : pct.toFixed(2))
                      }
                      placeholder={totalCents ? "0.00" : "—"}
                      disabled={!totalCents}
                      title={
                        totalCents
                          ? "Type a percentage and the amount follows"
                          : "Add a priced line item first — there is nothing to take a percentage of"
                      }
                      onChange={(e) => {
                        const typed = e.target.value;
                        const value = Number(typed.replace(/[^0-9.]/g, ""));
                        patch(r.key, {
                          percentDraft: typed,
                          // Rounded to the cent. Three phases at 33.33%
                          // of $80,000 leave $8 unaccounted, which the
                          // balance line below already reports and the
                          // "put it on the last phase" button clears.
                          amount: Number.isFinite(value)
                            ? centsToInput(Math.round((totalCents * value) / 100))
                            : r.amount,
                        });
                      }}
                      // Released on blur so the cell goes back to showing
                      // what the amount actually is -- including after the
                      // difference has been applied elsewhere.
                      onBlur={() => patch(r.key, { percentDraft: null })}
                    />
                  )}
                </td>
                <td className="right" data-label="Amount">
                  <input
                    className="est-item-price"
                    inputMode="decimal"
                    value={r.amount}
                    disabled={locked}
                    onChange={(e) => patch(r.key, { amount: e.target.value })}
                  />
                </td>
                <td>
                  {locked ? (
                    // Rows come straight from `payments` and cannot be
                    // reordered or removed while locked, so index alignment
                    // holds and each row can find its own saved phase.
                    payments[i] && (
                      <>
                        <PhaseBilling phase={payments[i]} payments={paid} signed={locked} />
                        {!paid.some(
                          (p) =>
                            p.estimate_payment_id === payments[i].id && p.status === "succeeded"
                        ) && (
                          <RecordPayment
                            estimateId={estimateId}
                            phaseId={payments[i].id}
                            suggestedCents={cents}
                            label={r.name || "Progress payment"}
                          />
                        )}
                      </>
                    )
                  ) : (
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

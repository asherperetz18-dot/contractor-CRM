"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  expensesByPhase,
  formatMarginPct,
  moneyCents,
  phaseProfit,
  depositCents,
  type EstimatePayment,
  type JobExpense,
} from "@/lib/data/types";
import { openBillsByPhase, type OpenJobBill } from "@/lib/data/bills";
import { assignExpensePhase, deleteJobExpense, getJobExpenses } from "@/lib/actions/job-expenses";
import { getOpenJobBills } from "@/lib/actions/vendor-bills";
import { getVendors } from "@/lib/actions/vendors";
import type { Vendor } from "@/lib/data/types";
import { ReceiptThumb } from "@/components/ui/receipt-peek";
import { AddBillModal } from "@/components/bills/add-bill-modal";

const fmtDay = (s: string) =>
  new Date(s + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

/**
 * What the job cost, against what it bills, phase by phase.
 *
 * Costs hang off the lead rather than this estimate, so a contract, its
 * change orders and its completion all draw on the same pile -- a job
 * that went over on tile went over once, not once per document.
 *
 * Two columns of money out: Spent (bills already paid -- the receipts)
 * and Unpaid (bills still owed, from Bills to Pay). Profit and margin
 * are figured on Spent only, because that is the money that has left;
 * Unpaid sits beside it so nobody reads a phase as under budget while
 * a $6,000 architect's bill is waiting to be paid.
 *
 * Unfiled costs are shown as their own line rather than spread across
 * the phases. Spreading would move every phase's margin by an amount
 * nobody chose, and the resulting percentages would look precise while
 * being invented.
 */
export function JobCosts({
  leadId,
  jobLabel,
  payments,
  totalCents,
  depositPercentBp,
  depositCapCents,
  canEdit,
  canBills,
}: {
  leadId: string;
  jobLabel: string;
  payments: EstimatePayment[];
  totalCents: number;
  depositPercentBp: number;
  depositCapCents: number;
  canEdit: boolean;
  /** May file an UNPAID bill -- Bookkeeping, Office, Admin. */
  canBills: boolean;
}) {
  const [expenses, setExpenses] = useState<JobExpense[] | null>(null);
  const [openBills, setOpenBills] = useState<OpenJobBill[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [res, bres, vres] = await Promise.all([
        getJobExpenses(leadId),
        getOpenJobBills(leadId),
        getVendors(),
      ]);
      if (cancelled) return;
      if (res.error) return setError(res.error);
      setExpenses(res.expenses ?? []);
      setOpenBills(bres.bills ?? []);
      setVendors(vres.vendors ?? []);
      // Not fatal, but not silent either: with an empty vendor list the
      // rows show "—" where names belong and the picker reads "No
      // vendors yet", which looks like the vendors were never recorded.
      setError(vres.error ? "The vendor list didn't load — reload the page to see vendor names." : "");
    })();
    return () => {
      cancelled = true;
    };
  }, [leadId, reloadKey]);

  // Error before loading. The other order strands the panel on "Loading…"
  // for good, because a failed load never sets the list that clears it.
  if (error && !expenses) return <p className="error-note">{error}</p>;
  if (!expenses) return null;

  const vendorById = new Map(vendors.map((v) => [v.id, v]));
  const nameOf = (vendorId: string | null, text: string | null) =>
    vendorById.get(vendorId ?? "")?.name ?? text ?? "—";
  const byPhase = expensesByPhase(expenses);
  const unpaidByPhase = openBillsByPhase(openBills);
  const unpaidOf = (phaseId: string | null) =>
    (unpaidByPhase.get(phaseId) ?? []).reduce((s, b) => s + b.remaining_cents, 0);
  const deposit = depositCents(totalCents, depositPercentBp, depositCapCents);
  const unfiled = byPhase.get(null) ?? [];
  const unfiledUnpaid = unpaidOf(null);
  const totalCost = expenses.reduce((s, e) => s + e.amount_cents, 0);
  const totalUnpaid = openBills.reduce((s, b) => s + b.remaining_cents, 0);
  const jobProfit = phaseProfit(totalCents, expenses);
  const nothingYet = expenses.length === 0 && openBills.length === 0;

  return (
    <section className="est-pay">
      <div className="est-pay-head">
        <div>
          <h2 className="est-pay-title">Job costs</h2>
          <p className="est-pay-sub">
            Every bill on this job, filed against the phase it belongs to — paid ones count as
            Spent, unpaid ones wait in Bills to Pay. Costs follow the job, so change orders and
            the original contract share one pile.
          </p>
        </div>
        {canEdit && (
          <div className="est-pay-actions">
            <button className="btn-ghost" onClick={() => setAdding(true)} disabled={pending}>
              + Add bill
            </button>
          </div>
        )}
      </div>

      {adding && (
        <AddBillModal
          jobs={[{ leadId, label: jobLabel }]}
          initialLeadId={leadId}
          lockJob
          phases={payments.map((p) => ({ id: p.id, name: p.name || "Unnamed phase" }))}
          canBills={canBills}
          defaultPaid
          vendors={vendors}
          onSaved={() => setReloadKey((k) => k + 1)}
          onClose={() => setAdding(false)}
        />
      )}

      {nothingYet ? (
        <p className="empty-hint">
          No bills recorded on this job yet. Add them here, or connect QuickBooks to pull
          them in from the project automatically.
        </p>
      ) : (
        <>
          {/* Phase by phase: what it bills, what it spent, what is still
              owed, what is left. Plain data-table, not est-pay-table: that
              one's phone layout stacks each row into a card and treats the
              last cell as an actions column -- full width, label
              suppressed. Margin is the last cell here and real data, so it
              lost its heading and read as a stray dash. data-table scrolls
              sideways instead and every column keeps its header. */}
          <table className="data-table">
            <thead>
              <tr>
                <th>Phase</th>
                <th className="right">Billed to client</th>
                <th className="right">Spent</th>
                <th className="right">Unpaid</th>
                <th className="right">Profit</th>
                <th className="right">Margin</th>
              </tr>
            </thead>
            <tbody>
              <tr className="est-pay-deposit">
                <td>
                  <div className="ur-name">Deposit</div>
                </td>
                <td className="right mono" data-label="Billed to client">
                  {moneyCents(deposit)}
                </td>
                <td className="right mono" data-label="Spent">
                  —
                </td>
                <td className="right mono" data-label="Unpaid">
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
                const unpaid = unpaidOf(p.id);
                return (
                  <tr key={p.id}>
                    <td>
                      <div className="ur-name">{p.name || "Unnamed phase"}</div>
                    </td>
                    <td className="right mono" data-label="Billed to client">
                      {moneyCents(pp.billedCents)}
                    </td>
                    <td className="right mono" data-label="Spent">
                      {pp.costCents ? moneyCents(pp.costCents) : "—"}
                    </td>
                    <td className="right mono" data-label="Unpaid">
                      {unpaid ? <span className="bill-unpaid">{moneyCents(unpaid)}</span> : "—"}
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
              {(unfiled.length > 0 || unfiledUnpaid > 0) && (
                <tr>
                  <td>
                    <div className="ur-name">Not filed to a phase</div>
                    <div className="ur-add-phone">
                      {unfiled.length} paid · {(unpaidByPhase.get(null) ?? []).length} unpaid · not
                      counted in any phase above
                    </div>
                  </td>
                  <td className="right mono" data-label="Billed to client">
                    —
                  </td>
                  <td className="right mono" data-label="Spent">
                    {unfiled.length ? moneyCents(unfiled.reduce((s, e) => s + e.amount_cents, 0)) : "—"}
                  </td>
                  <td className="right mono" data-label="Unpaid">
                    {unfiledUnpaid ? <span className="bill-unpaid">{moneyCents(unfiledUnpaid)}</span> : "—"}
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
                <span className="est-margin-label">Unpaid bills</span>
                <span className="mono">{moneyCents(totalUnpaid)}</span>
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
              {/* Every paid cost counts here, filed or not -- the job total
                  is the one figure that must not depend on whether somebody
                  got round to sorting the receipts. Unpaid bills are shown
                  but not subtracted: the money hasn't left yet. */}
              Whole job, including costs not yet filed to a phase. Profit is on what has been
              paid; {moneyCents(totalUnpaid)} more is owed to vendors.
            </div>
          </div>

          {openBills.length > 0 && (
            <>
              <div className="bills-group-head" style={{ marginTop: 14 }}>
                <strong>Unpaid bills on this job</strong>
                <span className="mono">{moneyCents(totalUnpaid)}</span>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Receipt</th>
                    <th>Bill date</th>
                    <th>Vendor</th>
                    <th>What for</th>
                    <th className="right">Left to pay</th>
                    <th>Phase</th>
                  </tr>
                </thead>
                <tbody>
                  {openBills.map((b) => (
                    <tr key={b.id}>
                      <td data-label="Receipt">
                        {b.receipt_url ? (
                          <ReceiptThumb url={b.receipt_url} path={b.receipt_path} />
                        ) : (
                          <span className="est-tax-note">none</span>
                        )}
                      </td>
                      <td className="mono" data-label="Bill date">
                        {b.bill_date ? fmtDay(b.bill_date) : "—"}
                      </td>
                      <td data-label="Vendor">{nameOf(b.vendor_id, b.vendor_name)}</td>
                      <td data-label="What for">{b.reference || "—"}</td>
                      <td className="right mono" data-label="Left to pay">
                        {moneyCents(b.remaining_cents)}
                        {b.remaining_cents < b.amount_cents && (
                          <div className="est-tax-note">of {moneyCents(b.amount_cents)}</div>
                        )}
                      </td>
                      <td data-label="Phase">
                        {payments.find((p) => p.id === b.estimate_payment_id)?.name || "Not filed"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="est-tax-note" style={{ marginBottom: 14 }}>
                Pay these from <Link href="/bills">Bills to Pay</Link>. Each payment lands below as a
                cost on the same phase, receipt and all.
              </p>
            </>
          )}

          {/* The paid bills themselves, each with the phase it is filed to. */}
          {expenses.length > 0 && (
            <>
              <div className="bills-group-head" style={{ marginTop: 14 }}>
                <strong>Paid</strong>
                <span className="mono">{moneyCents(totalCost)}</span>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Receipt</th>
                    <th>Date paid</th>
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
                      <td data-label="Receipt">
                        {e.receipt_url ? (
                          <ReceiptThumb url={e.receipt_url} path={e.receipt_path} />
                        ) : (
                          <span className="est-tax-note">none</span>
                        )}
                      </td>
                      <td className="mono" data-label="Date paid">
                        {fmtDay(e.spent_on)}
                      </td>
                      <td data-label="Vendor">
                        {/* The vendor record wins over the stored text. A cost
                            keeps only one or the other, so correcting a
                            vendor's name corrects it everywhere it appears
                            rather than leaving old receipts on the old
                            spelling. */}
                        {nameOf(e.vendor_id, e.vendor)}
                        {e.source === "quickbooks" && (
                          <div className="est-tax-note">from QuickBooks</div>
                        )}
                        {e.source === "bill" && (
                          <div className="est-tax-note">paid from Bills to Pay</div>
                        )}
                        {!e.vendor_id && e.vendor && (
                          <div className="est-tax-note">not on the vendor list</div>
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
        </>
      )}

      {error && <p className="error-note">{error}</p>}
    </section>
  );
}

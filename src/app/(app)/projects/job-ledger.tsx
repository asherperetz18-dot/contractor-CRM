"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getJobLedger, type JobLedgerResult } from "@/lib/actions/job-ledger";
import { fileCostsToContract } from "@/lib/actions/job-expenses";
import { ledgerCounts, ledgerFilter, type LedgerEntry, type LedgerFilter } from "@/lib/data/job-ledger";
import { expenseEditLock } from "@/lib/data/expense-edit";
import { moneyCents, type JobExpense } from "@/lib/data/types";
import { ReceiptThumb } from "@/components/ui/receipt-peek";
import { EditPaidBillModal } from "@/components/bills/edit-paid-bill-modal";
import type { BillJobOption } from "@/components/bills/add-bill-modal";
import { RecordPayment } from "../estimates/[id]/record-payment";

const FILTERS: { key: LedgerFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "in", label: "Money in" },
  { key: "out", label: "Money out" },
  { key: "owed", label: "Still owed" },
];

const KIND: Record<LedgerEntry["kind"], { label: string; cls: string }> = {
  in: { label: "↓ Paid in", cls: "jl-k-in" },
  clearing: { label: "↓ Clearing", cls: "jl-k-owed" },
  out: { label: "↑ Paid out", cls: "jl-k-out" },
  owed: { label: "◷ Owed", cls: "jl-k-owed" },
  unpaid_bill: { label: "◷ Bill unpaid", cls: "jl-k-owed" },
};

const monthLabel = (day: string) =>
  day
    ? new Date(`${day.slice(0, 7)}-01T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : "No date";
const shortDay = (day: string) =>
  day ? new Date(`${day}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "2-digit" }) : "—";

const signed = (e: LedgerEntry) =>
  e.kind === "in" ? `+${moneyCents(e.amountCents)}` : e.kind === "out" ? `−${moneyCents(e.amountCents)}` : moneyCents(e.amountCents);
const amountClass = (e: LedgerEntry) =>
  e.kind === "in" ? "jl-amt-in" : e.kind === "out" ? "jl-amt-out" : "jl-amt-owed";

/**
 * Every dollar on one job -- paid in, paid out, still owed -- opened
 * under its Projects row. The totals line is the row's own figures, and
 * the lines itemize them (job-ledger.ts applies the row's rules), so the
 * two can't disagree.
 */
export function JobLedger({
  estimateId,
  filter,
  onFilter,
  totals,
  canInvoice,
  canEditCosts,
  canAddCosts,
  canRecord,
  jobs,
  reloadKey,
  onInvoice,
  onAddBill,
  onBillToClient,
}: {
  estimateId: string;
  filter: LedgerFilter;
  onFilter: (f: LedgerFilter) => void;
  /** The row's own figures. */
  totals: { collectedCents: number; spentCents: number; netCashCents: number; owedCents: number; billsUnpaidCents: number };
  canInvoice: boolean;
  canEditCosts: boolean;
  canAddCosts: boolean;
  /** Record payment (Bookkeeping, Office, Admin). */
  canRecord: boolean;
  jobs: BillJobOption[];
  /** Bumped by the page after something changes the job's money. */
  reloadKey: number;
  onInvoice: () => void;
  onAddBill: () => void;
  onBillToClient: (costId: string) => void;
}) {
  const router = useRouter();
  const [ledger, setLedger] = useState<JobLedgerResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [recording, setRecording] = useState<string | null>(null);
  const [editing, setEditing] = useState<JobExpense | null>(null);
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getJobLedger(estimateId).then((res) => {
      if (cancelled) return;
      if (res.error) setError(res.error);
      else setLedger(res.ledger ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [estimateId, reload, reloadKey]);

  function changed() {
    setReload((n) => n + 1);
    router.refresh();
  }

  async function assignAll(ids: string[]) {
    setAssigning(true);
    const res = await fileCostsToContract(ids, estimateId);
    setAssigning(false);
    if (res.error) return setError(res.error);
    changed();
  }

  if (error) return <p className="error-note">{error}</p>;
  if (!ledger) return <p className="empty-hint">Loading transactions…</p>;

  const counts = ledgerCounts(ledger.entries);
  const shown = ledgerFilter(ledger.entries, filter);
  const expenseById = new Map(ledger.expenses.map((e) => [e.id, e]));

  return (
    <div className="jl">
      <div className="jl-head">
        <div className="jl-filters" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={"jl-filt" + (filter === f.key ? " on" : "")}
              aria-pressed={filter === f.key}
              onClick={() => onFilter(f.key)}
            >
              {f.label} <b>{counts[f.key]}</b>
            </button>
          ))}
        </div>
        <div className="jl-actions">
          {canInvoice && (
            <button type="button" className="btn-ghost small jl-add-in" onClick={onInvoice}>
              + Invoice
            </button>
          )}
          {canAddCosts && (
            <button type="button" className="btn-ghost small jl-add-out" onClick={onAddBill}>
              + Add bill
            </button>
          )}
        </div>
      </div>

      {ledger.unassigned.length > 0 && (
        <div className="stmt-warning">
          <strong>
            {ledger.unassigned.length} cost{ledger.unassigned.length === 1 ? "" : "s"} (
            {moneyCents(ledger.unassigned.reduce((s, c) => s + c.amountCents, 0))})
            {ledger.unassigned.length === 1 ? " isn't" : " aren't"} assigned to a contract
          </strong>
          , so this customer&rsquo;s other contracts and this one all leave{" "}
          {ledger.unassigned.length === 1 ? "it" : "them"} out: {ledger.unassigned.map((c) => c.label).join(", ")}.
          {canEditCosts && (
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                className="btn-primary small"
                disabled={assigning}
                onClick={() => void assignAll(ledger.unassigned.map((c) => c.id))}
              >
                {assigning ? "Assigning…" : `Assign to ${ledger.contractDocNumber}`}
              </button>
            </div>
          )}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="empty-hint">
          {ledger.entries.length === 0 ? "No money in or out on this job yet." : "Nothing here under this filter."}
        </p>
      ) : (
        <div className="jl-box">
          <table className="jl-table">
            <thead>
              <tr>
                <th className="jl-date">Date</th>
                <th className="jl-type">Type</th>
                <th className="jl-what">What</th>
                <th className="jl-rcpt">Receipt</th>
                <th className="jl-amt">Amount</th>
                <th className="jl-act">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e, i) => {
                // A month heading above the first line of each month.
                const heading = i === 0 || shown[i - 1].date.slice(0, 7) !== e.date.slice(0, 7);
                const expense = e.costId ? expenseById.get(e.costId) : undefined;
                return (
                  <React.Fragment key={e.id}>
                    {heading && (
                      <tr className="jl-month">
                        <td colSpan={6}>{monthLabel(e.date)}</td>
                      </tr>
                    )}
                    <tr className="jl-row">
                      <td className="jl-date mono">{shortDay(e.date)}</td>
                      <td className="jl-type">
                        <span className={"jl-kind " + KIND[e.kind].cls}>
                          {e.kind === "owed" && e.isInvoice ? "◷ Invoice owed" : KIND[e.kind].label}
                        </span>
                      </td>
                      <td className="jl-what">
                        <b>{e.title}</b>
                        {e.detail && <span>{e.detail}</span>}
                      </td>
                      <td className="jl-rcpt">
                        {e.receipt ? (
                          <ReceiptThumb url={e.receipt.url} path={e.receipt.path} size={34} />
                        ) : (
                          <span className="jl-none">—</span>
                        )}
                      </td>
                      <td className={"jl-amt mono " + amountClass(e)}>{signed(e)}</td>
                      <td className="jl-act">
                        <span className="jl-row-actions">
                          {e.kind === "out" &&
                            (e.billedOn ? (
                              <span className="jl-billed">✓ Billed on {e.billedOn}</span>
                            ) : (
                              canInvoice &&
                              e.costId && (
                                <button
                                  type="button"
                                  className="btn-ghost small inv-bill-btn"
                                  onClick={() => onBillToClient(e.costId!)}
                                >
                                  Bill to client
                                </button>
                              )
                            ))}
                          {e.kind === "out" && canEditCosts && expense && !expenseEditLock(expense) && (
                            <button type="button" className="btn-ghost small" onClick={() => setEditing(expense)}>
                              ✎ Edit
                            </button>
                          )}
                          {e.kind === "owed" && canRecord && (
                            <button
                              type="button"
                              className="btn-ghost small"
                              onClick={() => setRecording(recording === e.id ? null : e.id)}
                            >
                              Record payment
                            </button>
                          )}
                          {(e.kind === "owed" || e.kind === "in" || e.kind === "clearing") && e.docId && e.isInvoice && (
                            <Link className="btn-ghost small" href={`/estimates/${e.docId}`}>
                              Open
                            </Link>
                          )}
                          {e.kind === "unpaid_bill" && (
                            <Link className="btn-ghost small" href="/bills">
                              Pay in Bills to Pay
                            </Link>
                          )}
                        </span>
                      </td>
                    </tr>
                    {recording === e.id && e.docId && (
                      <tr className="jl-record">
                        <td colSpan={6}>
                          <RecordPayment
                            estimateId={e.docId}
                            phaseId={e.phaseId}
                            suggestedCents={e.amountCents}
                            label={e.title}
                            startOpen
                            onDone={() => {
                              setRecording(null);
                              changed();
                            }}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="jl-totals">
        <span>
          Collected <b className="jl-amt-in">{moneyCents(totals.collectedCents)}</b>
        </span>
        <span>
          Spent <b className="jl-amt-out">{moneyCents(totals.spentCents)}</b>
        </span>
        <span className="jl-net">
          Net cash <b>{moneyCents(totals.netCashCents)}</b>
        </span>
        <span>
          Owed to you <b className="jl-amt-owed">{moneyCents(totals.owedCents)}</b>
        </span>
        <span>
          Bills unpaid <b className="jl-amt-owed">{moneyCents(totals.billsUnpaidCents)}</b>
        </span>
      </div>

      {editing && (
        <EditPaidBillModal
          expense={editing}
          jobs={jobs}
          vendors={ledger.vendors}
          onSaved={changed}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

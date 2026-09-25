"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ReceiptThumb } from "@/components/ui/receipt-peek";
import {
  moneyCents,
  paidTotalCents,
  paymentMethodLabel,
  phaseState,
  phaseStateLabel,
  type Estimate,
  type EstimateItem,
  type EstimatePayment,
  type PortalPayment,
} from "@/lib/data/types";
import { requestProgressPayment } from "@/lib/actions/progress-billing";
import { cancelInvoice } from "@/lib/actions/invoices";
import { RecordPayment } from "./record-payment";

const BADGE: Record<string, string> = {
  paid: "signed",
  clearing: "sent",
  partial: "sent",
  overdue: "declined",
  billed: "sent",
  unbilled: "draft",
};

const fmtDay = (iso: string | null) =>
  iso
    ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

export type InvoiceLineCost = {
  id: string;
  receipt_url: string | null;
  receipt_path: string | null;
  spent_on: string;
  amount_cents: number;
};

/**
 * One invoice, office side: what was billed, what's come in, and the
 * few things to do with it -- text the Pay link again, record a cheque,
 * or cancel it if it went out by mistake. No editor: an issued invoice
 * is a record, and a wrong one is cancelled and re-issued.
 */
export function InvoiceView({
  invoice,
  items,
  phase,
  paid,
  customer,
  parent,
  costs,
  canBill,
  canRecord,
}: {
  invoice: Estimate;
  items: EstimateItem[];
  phase: EstimatePayment | null;
  paid: PortalPayment[];
  customer: { id: string; name: string; phone: string | null };
  parent: { id: string; doc_number: string } | null;
  /** The job costs its lines bill back, by cost id. */
  costs: Record<string, InvoiceLineCost>;
  canBill: boolean;
  canRecord: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  const cancelled = invoice.status === "Void";
  const settled = paidTotalCents(paid);
  const owed = Math.max(0, invoice.total_cents - settled);
  const state = phase ? phaseState(phase, paid.filter((p) => p.estimate_payment_id === phase.id)) : null;
  const moneyIn = settled > 0 || paid.some((p) => p.status === "pending");

  function resend() {
    if (!phase) return;
    setError(null);
    startTransition(async () => {
      const res = await requestProgressPayment(phase.id, phase.due_date ?? undefined);
      if (res.error) return setError(res.error);
      setNote(`Pay link texted to ${res.sentTo}.`);
      router.refresh();
    });
  }

  function cancel() {
    setError(null);
    startTransition(async () => {
      const res = await cancelInvoice(invoice.id, reason);
      if (res.error) return setError(res.error);
      setCancelling(false);
      setNote(`${invoice.doc_number} cancelled. Nothing is owed on it now.`);
      router.refresh();
    });
  }

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">
            Invoice {invoice.doc_number}{" "}
            {cancelled ? (
              <span className="est-badge est-badge-declined">Cancelled</span>
            ) : (
              state && (
                <span className={"est-badge est-badge-" + (BADGE[state] ?? "draft")}>
                  {phaseStateLabel(state)}
                </span>
              )
            )}
          </h1>
          <p className="module-sub">
            <Link href={`/contacts?openLead=${customer.id}&from=/estimates/${invoice.id}`}>{customer.name}</Link>
            {parent && (
              <>
                {" · for contract "}
                <Link href={`/estimates/${parent.id}`}>{parent.doc_number}</Link>
              </>
            )}
            {" · issued "}
            {fmtDay(invoice.issued_at ?? invoice.created_at)}
            {phase?.due_date && !cancelled && <> · due {fmtDay(phase.due_date)}</>}
          </p>
        </div>
        <div className="est-header-actions">
          <button className="btn-ghost" onClick={() => router.back()}>
            Back
          </button>
          <Link className="btn-ghost" href={`/estimates/${invoice.id}/preview`}>
            Preview as Customer
          </Link>
          <Link className="btn-ghost" href={`/estimates/${invoice.id}/preview?print=1`}>
            Print / PDF
          </Link>
        </div>
      </div>

      {cancelled && (
        <p className="stmt-warning">
          Cancelled{invoice.voided_at ? ` ${fmtDay(invoice.voided_at)}` : ""}
          {invoice.void_reason ? ` — ${invoice.void_reason}` : ""}. The customer sees it as cancelled and
          nothing on it is owed. Its costs can be billed again.
        </p>
      )}
      {note && <p className="hint-note">{note}</p>}
      {error && <p className="error-note">{error}</p>}

      <div className="stat-grid inv-stats">
        <div className="stat-card stat-static">
          <div className="stat-value mono">{moneyCents(invoice.total_cents)}</div>
          <div className="stat-label">Billed</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono inv-in">{moneyCents(settled)}</div>
          <div className="stat-label">Paid</div>
        </div>
        <div className="stat-card stat-static">
          <div className="stat-value mono">{cancelled ? "—" : moneyCents(owed)}</div>
          <div className="stat-label">Still owed</div>
        </div>
      </div>

      <div className="table-scroll inv-table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>What for</th>
              <th>Receipt</th>
              <th className="right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const sourceId = (item as EstimateItem & { source_expense_id?: string | null }).source_expense_id;
              const cost = sourceId ? costs[sourceId] : undefined;
              const shown = (item as EstimateItem & { show_source_receipt?: boolean | null }).show_source_receipt !== false;
              return (
                <tr key={item.id}>
                  <td>
                    <strong>{item.name}</strong>
                    {item.description && <div className="est-tax-note">{item.description}</div>}
                    {cost && (
                      <div className="est-tax-note">
                        Bills back a {moneyCents(cost.amount_cents)} cost paid {fmtDay(cost.spent_on)}
                        {cost.receipt_url && !shown ? " · receipt kept internal" : ""}
                      </div>
                    )}
                  </td>
                  <td>
                    {cost?.receipt_url ? (
                      <ReceiptThumb url={cost.receipt_url} path={cost.receipt_path} />
                    ) : (
                      <span className="est-tax-note">—</span>
                    )}
                  </td>
                  <td className="right mono">{moneyCents(item.line_total_cents)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>
                <strong>Total</strong>
              </td>
              <td className="right mono">
                <strong>{moneyCents(invoice.total_cents)}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <h2 className="inv-h2">Payments</h2>
      {paid.length === 0 ? (
        <p className="empty-hint">Nothing paid yet.</p>
      ) : (
        <div className="table-scroll inv-table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>How</th>
                <th>Status</th>
                <th className="right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {paid.map((p) => (
                <tr key={p.id}>
                  <td>{fmtDay(p.paid_at ?? p.created_at)}</td>
                  <td>{paymentMethodLabel(p.method) || "—"}</td>
                  <td>
                    <span
                      className={
                        "est-badge est-badge-" +
                        (p.status === "succeeded" ? "signed" : p.status === "pending" ? "sent" : "declined")
                      }
                    >
                      {p.status === "succeeded" ? "Paid" : p.status === "pending" ? "Clearing" : p.status}
                    </span>
                  </td>
                  <td className="right mono">{moneyCents(p.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!cancelled && (
        <div className="inv-actions">
          {canBill && phase && owed > 0 && (
            <button type="button" className="btn-primary" disabled={pending} onClick={resend}>
              {pending ? "Sending…" : "Text the Pay link"}
            </button>
          )}
          {canRecord && owed > 0 && (
            <RecordPayment
              estimateId={invoice.id}
              phaseId={phase?.id ?? null}
              suggestedCents={owed}
              label={invoice.doc_number}
            />
          )}
          {canBill && !moneyIn && !cancelling && (
            <button type="button" className="btn-ghost est-void-btn" onClick={() => setCancelling(true)}>
              Cancel invoice
            </button>
          )}
        </div>
      )}
      {cancelling && (
        <div className="inv-cancel">
          <label className="field">
            <span className="field-label">Why is it cancelled?</span>
            <input
              autoFocus
              placeholder="e.g. Wrong amount — re-issued as a new invoice"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="inv-actions">
            <button type="button" className="btn-primary" disabled={pending || !reason.trim()} onClick={cancel}>
              {pending ? "Cancelling…" : "Cancel invoice"}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setCancelling(false)}>
              Keep it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

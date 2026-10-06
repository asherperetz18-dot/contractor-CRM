"use client";

import { Fragment, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ReceiptThumb } from "@/components/ui/receipt-peek";
import {
  creditableCents,
  moneyCents,
  paidTotalCents,
  paymentMethodLabel,
  phaseState,
  phaseStateLabel,
  removableCredit,
  type BillCreditRow,
  type Estimate,
  type EstimateItem,
  type EstimatePayment,
  type PortalPayment,
} from "@/lib/data/types";
import { requestProgressPayment } from "@/lib/actions/progress-billing";
import { cancelInvoice } from "@/lib/actions/invoices";
import { paymentTermsLabel } from "@/lib/data/invoices";
import { RecordPayment } from "./record-payment";
import { clearInvoiceNote, peekInvoiceNote } from "./invoice-note";
import { SendChannelSelect, defaultBillChannel, sendLabel } from "@/components/invoices/send-channel-select";
import { sentViaLabel, type BillChannel } from "@/lib/bill-email";
import { RemindersSent, RemindersToggle } from "@/components/invoices/reminders-toggle";
import { GiveCredit } from "@/components/invoices/give-credit";
import { RemoveCreditButton, RemoveCreditForm } from "@/components/invoices/remove-credit";

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
  credits = [],
}: {
  invoice: Estimate;
  items: EstimateItem[];
  phase: EstimatePayment | null;
  paid: PortalPayment[];
  customer: { id: string; name: string; phone: string | null; email: string | null };
  parent: { id: string; doc_number: string } | null;
  /** The job costs its lines bill back, by cost id. */
  costs: Record<string, InvoiceLineCost>;
  canBill: boolean;
  canRecord: boolean;
  /** Credits given on it (0209, DECISIONS #154), oldest first; removed
   *  ones (#160) included, for the record. */
  credits?: BillCreditRow[];
}) {
  const router = useRouter();
  // What happened when it was sent from a draft, handed over by the
  // editor this page replaced (a text that didn't go out included).
  const [note, setNote] = useState<string | null>(() => peekInvoiceNote(invoice.id));
  useEffect(() => clearInvoiceNote(invoice.id), [invoice.id]);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  // Which credit's Remove is open (DECISIONS #160).
  const [removingCredit, setRemovingCredit] = useState<string | null>(null);
  const [channel, setChannel] = useState<BillChannel>(() => defaultBillChannel(customer));
  // When it last went to the customer, and how (0206, DECISIONS #150).
  const lastSent = phase as (EstimatePayment & { sent_at?: string | null; sent_via?: string | null }) | null;

  const cancelled = invoice.status === "Void";
  const settled = paidTotalCents(paid);
  // Credits come off what's owed; the invoice keeps its amount (#154).
  const credited = Math.max(0, phase?.credit_cents ?? 0);
  const owed = Math.max(0, invoice.total_cents - credited - settled);
  const state = phase ? phaseState(phase, paid.filter((p) => p.estimate_payment_id === phase.id)) : null;
  const moneyIn = settled > 0 || paid.some((p) => p.status === "pending");

  function resend() {
    if (!phase) return;
    setError(null);
    startTransition(async () => {
      const res = await requestProgressPayment(phase.id, phase.due_date ?? undefined, channel);
      if (res.error) return setError(res.error);
      setNote(res.warning ?? `Pay link sent to ${res.sentTo}.`);
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
            {" · "}
            <Link href={`/invoices/statement/${customer.id}`}>Statement</Link>
            {parent && (
              <>
                {" · for contract "}
                <Link href={`/estimates/${parent.id}`}>{parent.doc_number}</Link>
              </>
            )}
            {" · issued "}
            {fmtDay(invoice.issued_at ?? invoice.created_at)}
            {phase?.due_date && !cancelled && <> · due {fmtDay(phase.due_date)}</>}
            {paymentTermsLabel(invoice.payment_terms_days) && <> · {paymentTermsLabel(invoice.payment_terms_days)}</>}
            {lastSent?.sent_at && !cancelled && (
              <>
                {" · last sent "}
                {fmtDay(lastSent.sent_at)} {sentViaLabel(lastSent.sent_via)}
              </>
            )}
            {phase && !cancelled && <RemindersSent phaseId={phase.id} prefix=" · " />}
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
        {credited > 0 && (
          <div className="stat-card stat-static">
            <div className="stat-value mono">{moneyCents(credited)}</div>
            <div className="stat-label">Credited</div>
          </div>
        )}
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
                    {Number(item.quantity) !== 1 && (
                      <div className="est-tax-note">
                        {item.quantity} × {moneyCents(item.unit_price_cents)}
                      </div>
                    )}
                    {item.taxable && invoice.tax_cents > 0 && <div className="est-tax-note">Taxable</div>}
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
            {invoice.tax_cents > 0 && (
              <>
                <tr>
                  <td colSpan={2}>Subtotal</td>
                  <td className="right mono">{moneyCents(invoice.subtotal_cents)}</td>
                </tr>
                <tr>
                  <td colSpan={2}>Sales tax ({(invoice.tax_rate_bp ?? 0) / 100}%)</td>
                  <td className="right mono">{moneyCents(invoice.tax_cents)}</td>
                </tr>
              </>
            )}
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
                      {/* A refund (#155) is money going back: a negative row. */}
                      {p.amount_cents < 0
                        ? p.status === "succeeded"
                          ? "Refunded"
                          : p.status === "pending"
                            ? "Refund going through"
                            : p.status
                        : p.status === "succeeded"
                          ? "Paid"
                          : p.status === "pending"
                            ? "Clearing"
                            : p.status}
                    </span>
                  </td>
                  <td className="right mono">{moneyCents(p.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {credits.length > 0 && (
        <>
          <h2 className="inv-h2">Credits</h2>
          <div className="table-scroll inv-table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Why</th>
                  <th className="right">Amount</th>
                  {canRecord && <th />}
                </tr>
              </thead>
              <tbody>
                {credits.map((c) => (
                  <Fragment key={c.id}>
                    <tr className={c.removed_at ? "credit-removed" : undefined}>
                      <td>{fmtDay(c.created_at)}</td>
                      <td>
                        {c.reason}
                        {c.refund_payment_id && !c.removed_at && <div className="empty-hint">Came with a refund</div>}
                        {/* Kept on record once removed (DECISIONS #160). */}
                        {c.removed_at && (
                          <div className="empty-hint">
                            Removed {fmtDay(c.removed_at)}
                            {c.remove_reason ? `: ${c.remove_reason}` : ""}
                          </div>
                        )}
                      </td>
                      <td className="right mono">
                        {c.removed_at ? <s>-{moneyCents(c.amount_cents)}</s> : `-${moneyCents(c.amount_cents)}`}
                      </td>
                      {canRecord && (
                        <td className="right">
                          {removableCredit(c) && removingCredit !== c.id && (
                            <RemoveCreditButton onClick={() => setRemovingCredit(c.id)} />
                          )}
                        </td>
                      )}
                    </tr>
                    {/* The question on a row of its own, the table's width,
                        so a phone keeps the date and reason in view. */}
                    {removingCredit === c.id && (
                      <tr>
                        <td colSpan={4}>
                          <RemoveCreditForm
                            creditId={c.id}
                            amountCents={c.amount_cents}
                            onClose={() => setRemovingCredit(null)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!cancelled && (
        <div className="inv-actions">
          {canBill && phase && owed > 0 && (
            <>
              <SendChannelSelect value={channel} onChange={setChannel} disabled={pending} />
              <button type="button" className="btn-primary" disabled={pending} onClick={resend}>
                {pending ? "Sending…" : sendLabel(channel).replace("Send", "Send again")}
              </button>
              {/* Automatic reminders on this invoice (DECISIONS #152). */}
              <RemindersToggle phaseId={phase.id} paused={(phase as { reminders_paused?: boolean }).reminders_paused} />
            </>
          )}
          {/* Take something off what's owed, without money moving (#154).
              Only once 0209 has given the bill its credit. */}
          {canRecord && phase && owed > 0 && phase.credit_cents !== undefined && (
            <GiveCredit
              phaseId={phase.id}
              maxCents={creditableCents(phase, paid.filter((p) => p.estimate_payment_id === phase.id))}
            />
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

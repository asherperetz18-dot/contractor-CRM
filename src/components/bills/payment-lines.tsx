"use client";

import { Field } from "@/components/ui/field";
import { centsFromInput, moneyCents } from "@/lib/data/types";
import {
  BILL_PAYMENT_METHODS,
  BILL_PAYMENT_METHOD_LABEL,
  billReferenceLabel,
  paymentAccountLabel,
  type BillPaymentLine,
  type BillPaymentMethod,
  type PaymentAccount,
} from "@/lib/data/bills";

/** A payment line as typed: the amount stays text until it is saved. */
export type PaymentLineDraft = {
  key: number;
  method: BillPaymentMethod;
  paidFromAccountId: string;
  amount: string;
  reference: string;
  paidOn: string;
};

let nextKey = 1;
export function newPaymentLine(paidOn: string, method: BillPaymentMethod = "card"): PaymentLineDraft {
  return { key: nextKey++, method, paidFromAccountId: "", amount: "", reference: "", paidOn };
}

/**
 * The amounts the lines actually carry. Paid in full with a single line,
 * that line IS the whole bill -- nobody should have to type the total
 * twice at the counter.
 */
export function linesForSave(
  lines: PaymentLineDraft[],
  totalCents: number,
  full: boolean
): BillPaymentLine[] {
  return lines.map((l) => ({
    amountCents: full && lines.length === 1 ? totalCents : centsFromInput(l.amount),
    method: l.method,
    paidOn: l.paidOn,
    reference: l.reference,
    paidFromAccountId: l.paidFromAccountId,
  }));
}

/**
 * One row per payment -- method, the account it came out of, amount, the
 * check/ref number and the day it went -- so a bill paid $800 on the
 * Amex and $300 by check is recorded as exactly that, the way QuickBooks
 * records it (a Bill Payment each).
 */
export function PaymentLines({
  lines,
  onChange,
  accounts,
  totalCents,
  full,
}: {
  lines: PaymentLineDraft[];
  onChange: (lines: PaymentLineDraft[]) => void;
  /** Empty until migration 0176 runs or no account is set up. */
  accounts: PaymentAccount[];
  totalCents: number;
  full: boolean;
}) {
  const set = (key: number, patch: Partial<PaymentLineDraft>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const saved = linesForSave(lines, totalCents, full);
  const paid = saved.reduce((s, l) => s + (l.amountCents || 0), 0);
  const left = totalCents - paid;
  const single = full && lines.length === 1;

  return (
    <div className="bill-pay-lines">
      {lines.map((l, i) => (
        <div key={l.key} className="bill-pay-line">
          <div className="bill-pay-row">
            <Field label="Method">
              <select
                value={l.method}
                onChange={(e) => set(l.key, { method: e.target.value as BillPaymentMethod })}
              >
                {BILL_PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {BILL_PAYMENT_METHOD_LABEL[m]}
                  </option>
                ))}
              </select>
            </Field>
            {accounts.length > 0 && (
              <Field label="Paid from">
                <select
                  value={l.paidFromAccountId}
                  onChange={(e) => set(l.key, { paidFromAccountId: e.target.value })}
                >
                  <option value="">Not set</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {paymentAccountLabel(a)}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Amount">
              <input
                inputMode="decimal"
                placeholder="0.00"
                value={single ? (totalCents / 100).toFixed(2) : l.amount}
                readOnly={single}
                title={single ? "Paid in full — the whole bill" : undefined}
                onChange={(e) => set(l.key, { amount: e.target.value })}
              />
            </Field>
            {lines.length > 1 && (
              <button
                type="button"
                className="btn-ghost est-row-remove"
                aria-label={`Remove payment ${i + 1}`}
                onClick={() => onChange(lines.filter((x) => x.key !== l.key))}
              >
                ×
              </button>
            )}
          </div>
          <div className="bill-pay-row">
            <Field label={billReferenceLabel(l.method)}>
              <input
                placeholder="optional"
                value={l.reference}
                onChange={(e) => set(l.key, { reference: e.target.value })}
              />
            </Field>
            <Field label="Date paid">
              <input type="date" value={l.paidOn} onChange={(e) => set(l.key, { paidOn: e.target.value })} />
            </Field>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="btn-ghost small"
        onClick={() => {
          const last = lines[lines.length - 1];
          onChange([...lines, newPaymentLine(last?.paidOn ?? "", "check")]);
        }}
      >
        + Add another payment
      </button>
      {totalCents > 0 && (
        <div className="bill-pay-sum">
          <span>
            Paid <span className="mono">{moneyCents(paid)}</span> of{" "}
            <span className="mono">{moneyCents(totalCents)}</span>
          </span>
          {left > 0 ? (
            <span className="bill-pay-left">
              {full ? `${moneyCents(left)} still to cover` : `${moneyCents(left)} left → Bills to Pay`}
            </span>
          ) : left < 0 ? (
            <span className="bill-pay-over">{moneyCents(-left)} more than the bill</span>
          ) : (
            <span className="bill-pay-done">Paid in full</span>
          )}
        </div>
      )}
    </div>
  );
}

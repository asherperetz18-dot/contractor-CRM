"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  centsFromInput,
  moneyCents,
  MANUAL_PAYMENT_METHODS,
  type ManualPaymentMethod,
} from "@/lib/data/types";
import { updateManualPayment } from "@/lib/actions/manual-payments";

const METHOD_LABEL: Record<ManualPaymentMethod, string> = {
  cash: "Cash",
  check: "Check",
  zelle: "Zelle",
  wire: "Wire transfer",
  other: "Other",
};

/**
 * Fixing a hand-recorded payment where it sits in the history.
 *
 * Opens from clicking the row: the cheque number that never got typed,
 * the wrong amount, the wrong day. Same fields as Record payment on the
 * contract, minus the clearing checkbox — settling a pending row stays
 * with "Mark cleared" so there is exactly one way a payment becomes
 * money.
 */
export function EditManualPayment({
  paymentId,
  status,
  amountCents,
  method,
  reference,
  note,
  date,
  onClose,
}: {
  paymentId: string;
  status: string;
  amountCents: number;
  method: string | null;
  reference: string | null;
  note: string | null;
  date: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState((amountCents / 100).toFixed(2));
  const isManualMethod = (MANUAL_PAYMENT_METHODS as readonly string[]).includes(method ?? "");
  const [payMethod, setPayMethod] = useState<ManualPaymentMethod>(
    isManualMethod ? (method as ManualPaymentMethod) : "check"
  );
  const [ref, setRef] = useState(reference ?? "");
  const [memo, setMemo] = useState(note ?? "");
  const [receivedOn, setReceivedOn] = useState(new Date(date).toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateManualPayment(paymentId, {
        amountCents: centsFromInput(amount),
        method: payMethod,
        reference: ref,
        note: memo,
        receivedOn,
      });
      if (res.error) return setError(res.error);
      onClose();
      router.refresh();
    });
  }

  return (
    <div className="est-record">
      <div className="est-record-title">
        Edit payment{status === "pending" ? " — still clearing" : ""}
      </div>
      <div className="est-record-grid">
        <label className="field">
          <span className="field-label">Amount</span>
          <input
            className="est-item-price"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={pending}
          />
        </label>
        <label className="field">
          <span className="field-label">Method</span>
          <select
            value={payMethod}
            onChange={(e) => setPayMethod(e.target.value as ManualPaymentMethod)}
            disabled={pending}
          >
            {MANUAL_PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Received on</span>
          <input
            type="date"
            value={receivedOn}
            onChange={(e) => setReceivedOn(e.target.value)}
            disabled={pending}
          />
        </label>
        <label className="field">
          <span className="field-label">{payMethod === "check" ? "Check number" : "Reference"}</span>
          <input
            className="est-item-name"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            disabled={pending}
          />
        </label>
      </div>

      <label className="field">
        <span className="field-label">Note (optional)</span>
        <input
          className="est-item-desc"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          disabled={pending}
        />
      </label>

      {error && <p className="error-note">{error}</p>}

      <div className="est-pay-actions">
        <button
          className="btn-primary"
          onClick={save}
          disabled={pending || centsFromInput(amount) <= 0}
        >
          {pending ? "Saving…" : `Save ${moneyCents(centsFromInput(amount))}`}
        </button>
        <button className="btn-ghost" onClick={onClose} disabled={pending}>
          Cancel
        </button>
      </div>
    </div>
  );
}

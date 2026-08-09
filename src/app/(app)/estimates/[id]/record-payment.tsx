"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { centsFromInput, moneyCents } from "@/lib/data/types";
import {
  recordManualPayment,
  MANUAL_METHODS,
  type ManualMethod,
} from "@/lib/actions/manual-payments";

const METHOD_LABEL: Record<ManualMethod, string> = {
  cash: "Cash",
  check: "Check",
  zelle: "Zelle",
  wire: "Wire transfer",
  other: "Other",
};

/**
 * Recording money that arrived outside Stripe.
 *
 * Sits on the schedule row it settles, so the amount is already in front
 * of you and the phase is unambiguous -- most of these are "the customer
 * handed me a cheque for the deposit", and retyping which job that was
 * is where mistakes come from.
 */
export function RecordPayment({
  estimateId,
  phaseId,
  suggestedCents,
  label,
}: {
  estimateId: string;
  phaseId?: string | null;
  suggestedCents: number;
  label: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState((suggestedCents / 100).toFixed(2));
  const [method, setMethod] = useState<ManualMethod>("check");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [receivedOn, setReceivedOn] = useState(new Date().toISOString().slice(0, 10));
  const [deposited, setDeposited] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    setWarning(null);
    startTransition(async () => {
      const res = await recordManualPayment({
        estimateId,
        phaseId: phaseId ?? null,
        amountCents: centsFromInput(amount),
        method,
        reference,
        note,
        // Only a cheque has a meaningful gap between taken and banked.
        cleared: method === "check" ? deposited : true,
        receivedOn,
      });
      if (res.error) return setError(res.error);
      setOpen(false);
      setReference("");
      setNote("");
      if (res.warning) setWarning(res.warning);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <>
        <button className="btn-ghost est-record-btn" onClick={() => setOpen(true)} type="button">
          Record payment
        </button>
        {warning && <p className="hint-note">Recorded. {warning}</p>}
      </>
    );
  }

  return (
    <div className="est-record">
      <div className="est-record-title">Record payment — {label}</div>
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
          <select value={method} onChange={(e) => setMethod(e.target.value as ManualMethod)} disabled={pending}>
            {MANUAL_METHODS.map((m) => (
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
          <span className="field-label">{method === "check" ? "Check number" : "Reference"}</span>
          <input
            className="est-item-name"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            disabled={pending}
          />
        </label>
      </div>

      {/* A cheque in a drawer is not money yet. Filed as clearing until
          it is banked, so the Collected figure stays honest. */}
      {method === "check" && (
        <label className="est-record-check">
          <input
            type="checkbox"
            checked={deposited}
            onChange={(e) => setDeposited(e.target.checked)}
            disabled={pending}
          />
          <span>
            Already deposited{" "}
            <span className="est-tax-note">
              — untick and it shows as clearing until it lands
            </span>
          </span>
        </label>
      )}

      <label className="field">
        <span className="field-label">Note (optional)</span>
        <input
          className="est-item-desc"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={pending}
        />
      </label>

      {error && <p className="error-note">{error}</p>}

      <div className="est-pay-actions">
        <button className="btn-primary" onClick={save} disabled={pending || centsFromInput(amount) <= 0}>
          {pending ? "Recording…" : `Record ${moneyCents(centsFromInput(amount))}`}
        </button>
        <button className="btn-ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </button>
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  centsFromInput,
  moneyCents,
  MANUAL_PAYMENT_METHODS,
  type ManualPaymentMethod,
} from "@/lib/data/types";
import { decideRefund, recordRefund } from "@/lib/actions/manual-payments";

const METHOD_LABEL: Record<ManualPaymentMethod, string> = {
  cash: "Cash",
  check: "Check",
  zelle: "Zelle",
  wire: "Wire transfer",
  financing: "Financing",
  other: "Other",
};

/**
 * Recording money given back on one payment (DECISIONS #155).
 *
 * Opens from the payment's Refund button. The CRM never sends money:
 * this records a refund made another way -- a check, cash, a transfer.
 * A card or bank payment refunded in Stripe records itself, so the form
 * says so on those. On a bill, it asks the one question that decides
 * what happens next: does the customer still owe it? No (the usual
 * case) gives a credit with it, so the bill stays settled; yes puts the
 * bill back to owed. A deposit refunded in full is due again.
 */
export function RefundPayment({
  paymentId,
  refundableCents,
  onBill,
  viaStripe,
  onClose,
}: {
  paymentId: string;
  /** What's left to give back on this payment. */
  refundableCents: number;
  /** Paid against a bill (a stage or an invoice), not a deposit. */
  onBill: boolean;
  /** Came in through Stripe: refunds made there record themselves. */
  viaStripe: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState((refundableCents / 100).toFixed(2));
  const [payMethod, setPayMethod] = useState<ManualPaymentMethod>("check");
  const [ref, setRef] = useState("");
  const [reason, setReason] = useState("");
  // Today on this computer's calendar -- the UTC date is already
  // tomorrow in a US office every evening.
  const [refundedOn, setRefundedOn] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [stillOwed, setStillOwed] = useState<"no" | "yes" | null>(null);
  const [emailCustomer, setEmailCustomer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const cents = centsFromInput(amount);
  const ready = cents > 0 && cents <= refundableCents && reason.trim() !== "" && (!onBill || stillOwed !== null);

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await recordRefund({
        paymentId,
        amountCents: cents,
        reason,
        method: payMethod,
        reference: ref,
        refundedOn,
        stillOwed: !onBill || stillOwed === "yes",
        emailCustomer,
      });
      if (res.error) return setError(res.error);
      // Recorded either way; a notice that didn't go is said, and can be
      // sent again from the refund's row.
      if (res.emailError) {
        window.alert(`The refund is recorded, but the notice wasn't emailed: ${res.emailError}`);
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <div className="est-record refund-form">
      <div className="est-record-title">Record a refund — up to {moneyCents(refundableCents)}</div>
      {viaStripe && (
        <p className="empty-hint">
          Refunding the card or bank payment itself? Do it in your Stripe dashboard — it shows up
          here by itself. Use this only for money given back another way.
        </p>
      )}
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
          <span className="field-label">Given back by</span>
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
          <span className="field-label">Refunded on</span>
          <input
            type="date"
            value={refundedOn}
            onChange={(e) => setRefundedOn(e.target.value)}
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
        <span className="field-label">Why (the customer sees this on their statement)</span>
        <input
          className="est-item-desc"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Paid twice, Cabinet order cancelled"
          disabled={pending}
        />
      </label>

      {onBill ? (
        <fieldset className="field refund-owed">
          <legend className="field-label">Does the customer still owe this amount?</legend>
          <label className="est-record-check">
            <input
              type="radio"
              name={`owed-${paymentId}`}
              checked={stillOwed === "no"}
              onChange={() => setStillOwed("no")}
              disabled={pending}
            />
            No — they don&apos;t owe it any more. A credit goes with the refund, so the bill stays
            settled.
          </label>
          <label className="est-record-check">
            <input
              type="radio"
              name={`owed-${paymentId}`}
              checked={stillOwed === "yes"}
              onChange={() => setStillOwed("yes")}
              disabled={pending}
            />
            Yes — the bill is owed again (for example, a payment that bounced).
          </label>
        </fieldset>
      ) : (
        <p className="empty-hint">
          This is a deposit. If all of it goes back, the deposit is due again on the contract.
        </p>
      )}

      <label className="est-record-check">
        <input
          type="checkbox"
          checked={emailCustomer}
          onChange={(e) => setEmailCustomer(e.target.checked)}
          disabled={pending}
        />
        <span>Email the customer that the money is coming back</span>
      </label>

      {error && <p className="error-note">{error}</p>}

      <div className="est-pay-actions">
        <button className="btn-primary" onClick={save} disabled={pending || !ready}>
          {pending ? "Saving…" : `Record ${moneyCents(cents)} refund`}
        </button>
        <button className="btn-ghost" onClick={onClose} disabled={pending}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * A refund made in Stripe lands here on its own, so nobody has said yet
 * whether the customer still owes it (DECISIONS #155). Until they do, the
 * bill reads owed again and no reminder goes out for it.
 */
export function DecideRefund({ refundId }: { refundId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function decide(stillOwed: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await decideRefund(refundId, stillOwed);
      if (res.error) return setError(res.error);
      router.refresh();
    });
  }

  return (
    <span className="est-row-tools refund-decide">
      <span className="field-label">Still owed?</span>
      <button
        className="btn-ghost est-record-btn"
        type="button"
        disabled={pending}
        title="They don't owe it any more: a credit goes with the refund"
        onClick={() => decide(false)}
      >
        No, credit it
      </button>
      <button
        className="btn-ghost est-record-btn"
        type="button"
        disabled={pending}
        title="The bill is owed again"
        onClick={() => decide(true)}
      >
        Yes, owed again
      </button>
      {error && <span className="error-note">{error}</span>}
    </span>
  );
}

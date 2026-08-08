"use client";

import { useState, useTransition } from "react";
import { moneyCents } from "@/lib/data/types";
import { startDepositCheckout } from "@/lib/actions/portal-payments";
import type { DepositState } from "@/lib/actions/portal-payments";

export function DepositPayment({
  estimateId,
  state,
  justPaid,
}: {
  estimateId: string;
  state: DepositState;
  justPaid: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (state.paid || justPaid) {
    return (
      <div className="portal-card estdoc-result estdoc-result-ok">
        <strong>Deposit received.</strong> Thank you — your contractor has been notified.
        {state.paidAt && ` Paid ${new Date(state.paidAt).toLocaleDateString("en-US")}.`}
      </div>
    );
  }

  // Nothing due yet, or the contractor has not connected a payment
  // account. Either way the customer is shown nothing rather than a
  // button that cannot work.
  if (!state.payable) return null;

  function pay() {
    setError(null);
    startTransition(async () => {
      const res = await startDepositCheckout(estimateId);
      if (res.error) return setError(res.error);
      if (res.url) window.location.href = res.url;
    });
  }

  return (
    <div className="portal-card estdoc-sign">
      <h2 className="portal-card-title">Pay your deposit</h2>
      <p className="estdoc-muted">
        {moneyCents(state.amountCents)} is due to schedule your project. You can pay by card or
        by bank transfer.
      </p>
      {error && <p className="error-note">{error}</p>}
      <div className="estdoc-sign-actions">
        <button className="btn-primary" onClick={pay} disabled={pending}>
          {pending ? "Opening secure checkout…" : `Pay ${moneyCents(state.amountCents)}`}
        </button>
      </div>
      {/* Said plainly because it is true and it reassures: the card never
          touches the contractor's system. */}
      <p className="est-tax-note">
        Payment is handled by Stripe on their secure page. Your card details are never seen or
        stored by {`your contractor's`} system.
      </p>
    </div>
  );
}

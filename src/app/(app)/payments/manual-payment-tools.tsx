"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteManualPayment, markManualPaymentCleared } from "@/lib/actions/manual-payments";

/**
 * Row tools for a hand-recorded payment in the history.
 *
 * Two jobs, both born from the same support case: a payment recorded as
 * "not yet cleared" had no way to become settled, so it was recorded a
 * second time -- and the history showed the money twice. "Mark cleared"
 * settles the pending row in place; "Remove" takes out the duplicate.
 * Stripe rows get neither -- they settle by webhook and are refunded in
 * Stripe -- so this component is only rendered on manual rows.
 */
export function ManualPaymentTools({
  paymentId,
  status,
  canRemove,
}: {
  paymentId: string;
  status: string;
  canRemove: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) return setError(res.error);
      router.refresh();
    });
  }

  return (
    <span className="est-row-tools">
      {status === "pending" && (
        <button
          className="btn-ghost est-record-btn"
          type="button"
          disabled={pending}
          title="The money landed — turn this pending row into the settled payment"
          onClick={() => run(() => markManualPaymentCleared(paymentId))}
        >
          {pending ? "Saving…" : "Mark cleared"}
        </button>
      )}
      {canRemove && (
        <button
          className="btn-ghost est-record-btn"
          type="button"
          disabled={pending}
          title="Remove a mis-keyed or duplicate entry"
          onClick={() => {
            if (window.confirm("Remove this payment from the record? This can't be undone."))
              run(() => deleteManualPayment(paymentId));
          }}
        >
          Remove
        </button>
      )}
      {error && <span className="error-note">{error}</span>}
    </span>
  );
}

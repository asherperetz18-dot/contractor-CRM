"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { emailPaymentReceipt } from "@/lib/actions/manual-payments";

/**
 * Email receipt on a payment that has arrived, online or by hand
 * (DECISIONS #151): the first receipt for one recorded without, or the
 * same again for a customer who lost theirs. On a refund, the same
 * button sends a refund notice (#158).
 */
export function ReceiptButton({
  paymentId,
  sentAt,
  refund = false,
}: {
  paymentId: string;
  sentAt: string | null;
  refund?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const sentLabel = sentAt ? new Date(sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;

  return (
    <span className="est-row-tools">
      <button
        className="btn-ghost est-record-btn"
        type="button"
        disabled={pending}
        title={
          refund
            ? sentLabel
              ? `A refund notice was emailed ${sentLabel}`
              : "Email the customer that this money is coming back"
            : sentLabel
              ? `A receipt was emailed ${sentLabel}`
              : "Email the customer a receipt for this payment"
        }
        onClick={() => {
          const ask = refund
            ? sentLabel
              ? "Email the customer this refund notice again?"
              : "Email the customer a notice of this refund?"
            : sentLabel
              ? "Email the customer this receipt again?"
              : "Email the customer a receipt for this payment?";
          if (!window.confirm(ask)) return;
          setError(null);
          setSentTo(null);
          startTransition(async () => {
            const res = await emailPaymentReceipt(paymentId);
            if (res.error) return setError(res.error);
            setSentTo(res.sentTo ?? null);
            router.refresh();
          });
        }}
      >
        {pending
          ? "Sending…"
          : refund
            ? sentLabel
              ? "Resend refund notice"
              : "Email refund notice"
            : sentLabel
              ? "Resend receipt"
              : "Email receipt"}
      </button>
      {sentTo && <span className="hint-note">Emailed to {sentTo}</span>}
      {error && <span className="error-note">{error}</span>}
    </span>
  );
}

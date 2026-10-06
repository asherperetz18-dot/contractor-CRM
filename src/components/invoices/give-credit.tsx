"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { giveBillCredit } from "@/lib/actions/bill-credits";
import { centsFromInput, moneyCents } from "@/lib/data/types";

/**
 * Give credit on one bill (DECISIONS #154): lowers what the customer owes
 * on it, with a reason they'll see on their statement. Up to what is
 * still owed. Shown only where 0209 has given the bill its credit.
 */
export function GiveCredit({ phaseId, maxCents }: { phaseId: string; maxCents: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (maxCents <= 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        className="btn-ghost est-record-btn"
        title="Take something off what the customer owes on this bill, without money moving"
        onClick={() => {
          setAmount((maxCents / 100).toFixed(2));
          setOpen(true);
        }}
      >
        Give credit
      </button>
    );
  }

  const cents = centsFromInput(amount);
  function save() {
    setError(null);
    startTransition(async () => {
      const res = await giveBillCredit({ phaseId, amountCents: cents, reason });
      if (res.error) return setError(res.error);
      setOpen(false);
      setReason("");
      router.refresh();
    });
  }

  return (
    <div className="est-record">
      <div className="est-record-title">Give credit — up to {moneyCents(maxCents)}</div>
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
          <span className="field-label">Why (the customer sees this)</span>
          <input
            className="est-item-name"
            value={reason}
            placeholder="e.g. Discount for the cabinet delay"
            onChange={(e) => setReason(e.target.value)}
            disabled={pending}
          />
        </label>
      </div>
      <p className="est-tax-note">
        The bill keeps its amount; the credit comes off what&apos;s owed, and shows on the customer&apos;s
        statement. A credit can&apos;t be undone here.
      </p>
      {error && <p className="error-note">{error}</p>}
      <div className="est-pay-actions">
        <button
          className="btn-primary"
          onClick={save}
          disabled={pending || cents <= 0 || cents > maxCents || !reason.trim()}
        >
          {pending ? "Saving…" : `Credit ${moneyCents(cents > 0 ? cents : 0)}`}
        </button>
        <button className="btn-ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </button>
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeBillCredit } from "@/lib/actions/bill-credits";
import { moneyCents } from "@/lib/data/types";

/**
 * Remove a credit given by hand (DECISIONS #160): the bill owes it
 * again. Asks why -- the credit stays on record, marked removed, with
 * the reason.
 */
export function RemoveCredit({ creditId, amountCents }: { creditId: string; amountCents: number }) {
  const [open, setOpen] = useState(false);
  if (!open) return <RemoveCreditButton onClick={() => setOpen(true)} />;
  return <RemoveCreditForm creditId={creditId} amountCents={amountCents} onClose={() => setOpen(false)} />;
}

export function RemoveCreditButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="btn-ghost est-record-btn"
      title="Take this credit back: the bill owes it again"
      onClick={onClick}
    >
      Remove
    </button>
  );
}

/** The question itself, for a page that opens it somewhere of its own --
 *  a table opens it on a row of its own, so it has the table's width. */
export function RemoveCreditForm({
  creditId,
  amountCents,
  onClose,
}: {
  creditId: string;
  amountCents: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await removeBillCredit({ creditId, reason });
      if (res.error) return setError(res.error);
      onClose();
      router.refresh();
    });
  }

  return (
    <div className="est-record remove-credit">
      <div className="est-record-title">Remove this {moneyCents(amountCents)} credit?</div>
      <p className="empty-hint">
        The bill owes it again. The credit stays on record, marked removed, and comes off the
        customer&apos;s statement.
      </p>
      <label className="field">
        <span className="field-label">Why (kept on record)</span>
        <input
          className="est-item-desc"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Given on the wrong bill"
          disabled={pending}
        />
      </label>
      {error && <p className="error-note">{error}</p>}
      <div className="est-pay-actions">
        <button type="button" className="btn-primary" onClick={save} disabled={pending || !reason.trim()}>
          {pending ? "Removing…" : `Remove ${moneyCents(amountCents)} credit`}
        </button>
        <button type="button" className="btn-ghost" onClick={onClose} disabled={pending}>
          Cancel
        </button>
      </div>
    </div>
  );
}

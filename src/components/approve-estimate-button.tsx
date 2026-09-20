"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveEstimate } from "@/lib/actions/estimate-approval";

/**
 * "Approve", offered where an admin actually meets the hold -- beside the
 * "Waiting for admin approval" chip on Estimate Status, and in the hold
 * note on the document itself -- rather than only on the Approvals
 * screen two menus away. The owner read the chip as a dead end: it named
 * the blocker and offered nothing to do about it.
 *
 * Admin-only by the caller's decision (isStrictAdmin); the server action
 * refuses anyone else regardless. On success the page is refreshed so
 * the hold clears in place: the status chip moves on, or the document's
 * Send controls appear.
 */
export function ApproveEstimateButton({
  estimateId,
  label = "Approve",
}: {
  estimateId: string;
  label?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        className="btn-primary small"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError("");
            const res = await approveEstimate(estimateId);
            if (res.error) return setError(res.error);
            router.refresh();
          })
        }
      >
        {pending ? "Approving…" : label}
      </button>
      {error && <span className="error-note">{error}</span>}
    </>
  );
}

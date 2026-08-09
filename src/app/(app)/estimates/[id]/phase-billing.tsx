"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  defaultDueDate,
  phaseState,
  phaseStateLabel,
  type EstimatePayment,
  type PortalPayment,
} from "@/lib/data/types";
import { requestProgressPayment, cancelProgressRequest } from "@/lib/actions/progress-billing";

const BADGE: Record<string, string> = {
  paid: "signed",
  clearing: "sent",
  overdue: "declined",
  billed: "sent",
  unbilled: "draft",
};

/**
 * Billing one phase of a signed contract.
 *
 * Only appears once the contract is signed, because that is the only
 * point at which a phase is a debt rather than a proposal. Billing texts
 * the customer a pay link, so it asks first -- an accidental click here
 * reaches a real person's phone.
 */
export function PhaseBilling({
  phase,
  payments,
  signed,
}: {
  phase: EstimatePayment;
  payments: PortalPayment[];
  signed: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [due, setDue] = useState(defaultDueDate());
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const on = payments.filter((p) => p.estimate_payment_id === phase.id);
  const state = phaseState(phase, on);

  if (!signed) return null;

  function bill() {
    setError(null);
    startTransition(async () => {
      const res = await requestProgressPayment(phase.id, due);
      if (res.error) return setError(res.error);
      setConfirming(false);
      setNote(`Texted ${res.sentTo}`);
      router.refresh();
    });
  }

  function unbill() {
    setError(null);
    startTransition(async () => {
      const res = await cancelProgressRequest(phase.id);
      if (res.error) return setError(res.error);
      setNote(null);
      router.refresh();
    });
  }

  return (
    <div className="est-phase-bill">
      <span className={"est-badge est-badge-" + (BADGE[state] ?? "draft")}>
        {phaseStateLabel(state)}
      </span>

      {state === "unbilled" && !confirming && (
        <button className="btn-ghost" onClick={() => setConfirming(true)} disabled={pending}>
          Bill this phase
        </button>
      )}

      {state === "unbilled" && confirming && (
        <span className="est-phase-confirm">
          <label className="est-phase-due">
            Due
            <input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              disabled={pending}
            />
          </label>
          <button className="btn-primary" onClick={bill} disabled={pending}>
            {pending ? "Texting…" : "Text pay link"}
          </button>
          <button className="btn-ghost" onClick={() => setConfirming(false)} disabled={pending}>
            Cancel
          </button>
        </span>
      )}

      {(state === "billed" || state === "overdue") && (
        <>
          {phase.due_date && (
            <span className="est-phase-due-note">
              due {new Date(`${phase.due_date}T00:00:00`).toLocaleDateString("en-US")}
            </span>
          )}
          <button className="btn-ghost" onClick={unbill} disabled={pending}>
            {pending ? "…" : "Un-bill"}
          </button>
        </>
      )}

      {note && <span className="est-phase-note">{note}</span>}
      {error && <span className="error-note">{error}</span>}
    </div>
  );
}

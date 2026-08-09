"use client";

import { useState, useTransition } from "react";
import { moneyCents } from "@/lib/data/types";
import { startPhaseCheckout, type PortalPhase } from "@/lib/actions/portal-payments";

function dueLabel(due: string | null) {
  if (!due) return null;
  return new Date(`${due}T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Progress payments the contractor has billed.
 *
 * Only billed phases reach here (the server filters them out), so every
 * row is either something to pay now or a receipt for something already
 * paid -- there is no "coming later" noise to read past.
 */
export function PhasePayments({ phases }: { phases: PortalPhase[] }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (phases.length === 0) return null;

  function pay(phaseId: string) {
    setError(null);
    setBusy(phaseId);
    startTransition(async () => {
      const res = await startPhaseCheckout(phaseId);
      if (res.error) {
        setBusy(null);
        return setError(res.error);
      }
      if (res.url) window.location.href = res.url;
    });
  }

  const owing = phases.filter((p) => p.state !== "paid" && p.state !== "clearing");

  return (
    <div className="portal-card estdoc-sign">
      <h2 className="portal-card-title">
        {owing.length > 0 ? "Payments due" : "Your payments"}
      </h2>
      {error && <p className="error-note">{error}</p>}

      <div className="pp-phases">
        {phases.map((p) => {
          const due = dueLabel(p.dueDate);
          return (
            <div key={p.id} className={"pp-phase pp-phase-" + p.state}>
              <div className="pp-phase-main">
                <div className="estdoc-strong">{p.name || "Progress payment"}</div>
                {p.description && <div className="estdoc-muted">{p.description}</div>}
                <div className="estdoc-muted">
                  {p.state === "paid"
                    ? `Paid${p.paidAt ? " " + new Date(p.paidAt).toLocaleDateString("en-US") : ""}`
                    : p.state === "clearing"
                      ? "Bank transfer in progress — nothing more to do."
                      : p.state === "overdue"
                        ? `Was due ${due}`
                        : due
                          ? `Due ${due}`
                          : ""}
                </div>
              </div>
              <div className="pp-phase-side">
                <div className="pp-phase-amount mono">{moneyCents(p.amountCents)}</div>
                {p.state === "paid" ? (
                  <span className="est-badge est-badge-signed">Paid</span>
                ) : p.state === "clearing" ? (
                  <span className="est-badge est-badge-sent">Clearing</span>
                ) : (
                  <button
                    className="btn-primary"
                    onClick={() => pay(p.id)}
                    disabled={pending && busy === p.id}
                  >
                    {pending && busy === p.id ? "Opening…" : `Pay ${moneyCents(p.amountCents)}`}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {owing.length > 0 && (
        <p className="est-tax-note">
          Payment is handled by Stripe on their secure page. Your card details are never seen or
          stored by {`your contractor's`} system.
        </p>
      )}
    </div>
  );
}

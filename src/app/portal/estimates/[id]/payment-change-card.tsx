"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moneyCents } from "@/lib/data/types";
import { signPaymentChange } from "@/lib/actions/portal-estimates";

/**
 * The payment change on a signed contract (DECISIONS #166): the customer
 * asked to pay the rest through the company's lender. Waiting, it's the
 * page to sign; signed, it says how the rest is being paid. The figures
 * are the ones sent, as stored with the change. No rate or monthly
 * payment: only the lender states those.
 */
export function PaymentChangeCard({
  estimateId,
  docNumber,
  companyName,
  signedOn,
  change,
  applyUrl,
}: {
  estimateId: string;
  docNumber: string;
  companyName: string;
  /** When the contract itself was signed. */
  signedOn: string | null;
  change: {
    status: "sent" | "signed";
    lender: string;
    totalCents: number;
    paidCents: number;
    financeCents: number;
    signedName: string | null;
    signedAt: string | null;
  };
  /** The lender's application page, when the company has one set. */
  applyUrl: string | null;
}) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  if (change.status === "signed") {
    return (
      <div className="portal-card estdoc-result payment-change-card">
        <strong>
          The rest of {docNumber}, {moneyCents(change.financeCents)}, is being paid through {change.lender}.
        </strong>{" "}
        {change.signedName && change.signedAt
          ? `${change.signedName} signed the payment change on ${day(change.signedAt)}.`
          : null}{" "}
        {change.lender} decides on your application and sets its terms. If it isn&apos;t approved, the original
        payment schedule applies.
      </div>
    );
  }

  function sign() {
    setError(null);
    startTransition(async () => {
      const res = await signPaymentChange(estimateId, typed);
      if (res.error) return setError(res.error);
      router.refresh();
    });
  }

  return (
    <div className="portal-card estdoc-sign payment-change-card">
      <h2 className="portal-card-title">Payment change for {docNumber}</h2>
      <p className="estdoc-muted">
        You signed {docNumber}
        {signedOn ? ` on ${day(signedOn)}` : ""} to pay {companyName} directly. You&apos;d like to pay the rest
        through financing instead. The work and the price stay the same.
      </p>
      <table className="payment-change-figures">
        <tbody>
          <tr>
            <td>Total</td>
            <td className="mono">{moneyCents(change.totalCents)}</td>
          </tr>
          <tr>
            <td>Paid so far</td>
            <td className="mono">{moneyCents(change.paidCents)}</td>
          </tr>
          <tr>
            <th>To be paid through {change.lender}</th>
            <th className="mono">{moneyCents(change.financeCents)}</th>
          </tr>
        </tbody>
      </table>
      <p className="est-tax-note">
        {change.lender} decides on your application and sets its terms. If it isn&apos;t approved, the original
        payment schedule applies.
      </p>
      {applyUrl && (
        <p className="estdoc-muted">
          Haven&apos;t applied yet?{" "}
          <a href={applyUrl} target="_blank" rel="noopener noreferrer">
            Apply with {change.lender} ↗
          </a>
        </p>
      )}
      <label className="field">
        <span className="field-label">Type your full name to sign</span>
        <input
          className="est-title-input estdoc-sign-input"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          maxLength={120}
          disabled={pending}
        />
      </label>
      {error && <p className="error-note">{error}</p>}
      <div className="estdoc-sign-actions">
        <button className="btn-primary" onClick={sign} disabled={pending || typed.trim().length < 2}>
          {pending ? "Signing…" : "Sign payment change"}
        </button>
      </div>
    </div>
  );
}

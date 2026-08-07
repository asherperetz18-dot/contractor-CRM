"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { declineEstimateAsCustomer, signEstimateAsCustomer } from "@/lib/actions/portal-estimates";
import type { EstimateStatus } from "@/lib/data/types";

export function PortalEstimateActions({
  estimateId,
  status,
  expired,
  canSign,
  signerName,
}: {
  estimateId: string;
  status: EstimateStatus;
  expired: boolean;
  canSign: boolean;
  signerName: string;
}) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (status === "Signed") {
    return (
      <div className="portal-card estdoc-result estdoc-result-ok">
        <strong>Signed.</strong> Thank you — your contractor has been notified and will be in
        touch about scheduling.
      </div>
    );
  }

  if (status === "Declined") {
    return (
      <div className="portal-card estdoc-result">
        You declined this estimate. If that was a mistake, contact your contractor and they can
        send an updated one.
      </div>
    );
  }

  if (expired) {
    return (
      <div className="portal-card estdoc-result">
        This estimate has expired. Contact your contractor for an updated price — costs can move
        after the quoted date.
      </div>
    );
  }

  if (!canSign) {
    return (
      <div className="portal-card estdoc-result">
        This estimate is waiting on another signer.
      </div>
    );
  }

  function sign() {
    // Typing your own name is the signature, so it has to be the name on
    // the document rather than any text at all.
    if (typed.trim().toLowerCase() !== signerName.trim().toLowerCase()) {
      return setError(`Type your name exactly as it appears: ${signerName}`);
    }
    setError(null);
    startTransition(async () => {
      const res = await signEstimateAsCustomer(estimateId, typed);
      if (res.error) return setError(res.error);
      router.refresh();
    });
  }

  function decline() {
    setError(null);
    startTransition(async () => {
      const res = await declineEstimateAsCustomer(estimateId, reason);
      if (res.error) return setError(res.error);
      router.refresh();
    });
  }

  return (
    <div className="portal-card estdoc-sign">
      {declining ? (
        <>
          <h2 className="portal-card-title">Decline this estimate</h2>
          <p className="estdoc-muted">
            A short reason helps your contractor come back with something that works. Optional.
          </p>
          <textarea
            className="est-textarea"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. over budget, going a different direction, timing"
          />
          {error && <p className="error-note">{error}</p>}
          <div className="estdoc-sign-actions">
            <button className="btn-ghost" onClick={() => setDeclining(false)} disabled={pending}>
              Back
            </button>
            <button className="btn-primary" onClick={decline} disabled={pending}>
              {pending ? "Sending…" : "Decline estimate"}
            </button>
          </div>
        </>
      ) : (
        <>
          <h2 className="portal-card-title">Accept and sign</h2>
          <p className="estdoc-muted">
            Type your full name below to sign. This is a legal signature and records the date and
            time.
          </p>
          <label className="field">
            <span className="field-label">Your full name</span>
            <input
              className="est-title-input estdoc-sign-input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={signerName}
              autoComplete="off"
            />
          </label>
          {error && <p className="error-note">{error}</p>}
          <div className="estdoc-sign-actions">
            <button className="btn-ghost" onClick={() => setDeclining(true)} disabled={pending}>
              Decline
            </button>
            <button className="btn-primary" onClick={sign} disabled={pending || !typed.trim()}>
              {pending ? "Signing…" : "Sign estimate"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

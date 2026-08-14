"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { declineEstimateAsCustomer, signEstimateAsCustomer } from "@/lib/actions/portal-estimates";
import { SignaturePad } from "@/components/signature-pad";
import type { EstimateStatus } from "@/lib/data/types";

export function PortalEstimateActions({
  estimateId,
  status,
  expired,
  canSign,
  signerName,
  parentContract,
}: {
  estimateId: string;
  status: EstimateStatus;
  expired: boolean;
  canSign: boolean;
  signerName: string;
  /** Set only on a change order: the contract it was added to. */
  parentContract?: { id: string; doc_number: string } | null;
}) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [mode, setMode] = useState<"type" | "draw">("type");
  const [drawnImage, setDrawnImage] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (status === "Signed") {
    return (
      <div className="portal-card estdoc-result estdoc-result-ok">
        <strong>Signed.</strong> Thank you — your contractor has been notified and will be in
        touch about scheduling.
        {/* A signed change order has no Pay button of its own, and left at
            that the customer is told nothing about how they pay for what
            they just approved. Its amount is a phase on the contract's
            schedule, so this says where it went and links there -- rather
            than adding a second place to pay for one job, which is how a
            customer pays twice. */}
        {parentContract && (
          <p style={{ marginTop: 8 }}>
            This has been added to the payment schedule on your contract{" "}
            <a href={`/portal/estimates/${parentContract.id}`}>{parentContract.doc_number}</a>,
            where you can pay it when it becomes due.
          </p>
        )}
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
    if (mode === "draw") {
      if (!drawnImage) return setError("Draw your signature above before signing.");
      setError(null);
      return startTransition(async () => {
        const res = await signEstimateAsCustomer(estimateId, { type: "drawn", image: drawnImage });
        if (res.error) return setError(res.error);
        router.refresh();
      });
    }

    // Typing your own name is the signature, so it has to be the name on
    // the document rather than any text at all.
    if (typed.trim().toLowerCase() !== signerName.trim().toLowerCase()) {
      return setError(`Type your name exactly as it appears: ${signerName}`);
    }
    setError(null);
    startTransition(async () => {
      const res = await signEstimateAsCustomer(estimateId, { type: "typed", name: typed });
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
            {mode === "type"
              ? "Type your full name below to sign. This is a legal signature and records the date and time."
              : "Draw your signature below. It's recorded along with the date and time as your legal signature."}
          </p>
          <div className="sig-mode-toggle">
            <button
              type="button"
              className={"sig-mode-btn" + (mode === "type" ? " active" : "")}
              onClick={() => {
                setMode("type");
                setError(null);
              }}
            >
              Type
            </button>
            <button
              type="button"
              className={"sig-mode-btn" + (mode === "draw" ? " active" : "")}
              onClick={() => {
                setMode("draw");
                setError(null);
                // The pad remounts blank every time this tab is opened --
                // clear any signature captured on a previous visit so what
                // gets submitted always matches what's actually on screen.
                setDrawnImage(null);
              }}
            >
              Draw
            </button>
          </div>
          {mode === "type" ? (
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
          ) : (
            <SignaturePad onChange={setDrawnImage} />
          )}
          {error && <p className="error-note">{error}</p>}
          <div className="estdoc-sign-actions">
            <button className="btn-ghost" onClick={() => setDeclining(true)} disabled={pending}>
              Decline
            </button>
            <button
              className="btn-primary"
              onClick={sign}
              disabled={pending || (mode === "type" ? !typed.trim() : !drawnImage)}
            >
              {pending ? "Signing…" : "Sign estimate"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

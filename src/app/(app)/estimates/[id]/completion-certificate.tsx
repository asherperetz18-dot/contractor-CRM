"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createCompletionCertificate,
  getCompletionCertificate,
  type CompletionRow,
} from "@/lib/actions/completion";

/**
 * The certificate that closes a job.
 *
 * Shown only on a signed contract, and only one exists per job -- two
 * would each claim to be the moment the warranty started.
 */
export function CompletionCertificate({
  contractId,
  canEdit,
}: {
  contractId: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [cert, setCert] = useState<CompletionRow | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [completedOn, setCompletedOn] = useState(new Date().toISOString().slice(0, 10));
  const [outstanding, setOutstanding] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getCompletionCertificate(contractId);
      if (cancelled) return;
      if (res.error) return setError(res.error);
      setCert(res.certificate ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [contractId]);

  function create() {
    setError("");
    startTransition(async () => {
      const res = await createCompletionCertificate(contractId, completedOn, outstanding);
      if (res.error) return setError(res.error);
      if (res.id) router.push(`/estimates/${res.id}`);
    });
  }

  if (cert === undefined) return null;

  return (
    <section className="est-pay" style={{ marginTop: 18 }}>
      <div className="module-toolbar" style={{ marginBottom: 10 }}>
        <div>
          <strong>Completion</strong>
          <div className="est-tax-note">
            Signed by the customer when the work is done and accepted
          </div>
        </div>
        {canEdit && !cert && !open && (
          <button className="btn-ghost" onClick={() => setOpen(true)}>
            + Completion certificate
          </button>
        )}
      </div>

      {cert ? (
        <table className="data-table est-pay-table">
          <tbody>
            <tr
              className="est-row"
              onClick={() => router.push(`/estimates/${cert.id}`)}
              role="link"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter") router.push(`/estimates/${cert.id}`);
              }}
            >
              <td>
                <span className="mono">{cert.doc_number}</span>
                <div className="est-tax-note">
                  {cert.completed_on
                    ? `Completed ${new Date(`${cert.completed_on}T00:00:00`).toLocaleDateString("en-US")}`
                    : "No completion date"}
                  {cert.completion_notes ? " · has outstanding items" : ""}
                </div>
              </td>
              <td data-label="Status" className="right">
                <span className={"est-badge est-badge-" + cert.status.toLowerCase()}>
                  {cert.status}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      ) : open ? (
        <div className="est-record">
          <div className="est-record-grid">
            <label className="field">
              <span className="field-label">Date of completion</span>
              <input
                type="date"
                value={completedOn}
                disabled={pending}
                onChange={(e) => setCompletedOn(e.target.value)}
              />
            </label>
          </div>
          <label className="field">
            <span className="field-label">Outstanding items (optional)</span>
            <textarea
              className="est-item-desc"
              rows={3}
              placeholder="e.g. Touch-up paint on hallway trim, replace one cabinet handle"
              value={outstanding}
              disabled={pending}
              onChange={(e) => setOutstanding(e.target.value)}
            />
          </label>
          {/* Said plainly, because a customer will not sign a document
              that appears to waive a snag they can still see. */}
          <p className="hint-note">
            Anything listed stays your responsibility and is not waived by signing. Leave it
            blank only if the customer accepts the work in full.
          </p>
          <p className="hint-note">
            The warranty starts on the completion date, and signing marks every unbilled
            phase on this contract as due — no text is sent.
          </p>
          {error && <p className="error-note">{error}</p>}
          <div className="est-pay-actions">
            <button className="btn-primary" onClick={create} disabled={pending || !completedOn}>
              {pending ? "Creating…" : "Create certificate"}
            </button>
            <button className="btn-ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="empty-hint">
          Not issued yet. Raise one when the work is finished — it records the customer&apos;s
          acceptance, starts the warranty, and makes the final balance due.
        </p>
      )}
      {error && !open && <p className="error-note">{error}</p>}
    </section>
  );
}

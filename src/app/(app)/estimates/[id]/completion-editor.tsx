"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SignedOnPaperDialog } from "./signed-on-paper-dialog";
import type { Estimate, EstimateSigner } from "@/lib/data/types";
import { saveCompletionDetails } from "@/lib/actions/completion";
import {
  deleteEstimate,
  markEstimateSent,
  sendEstimateToCustomer,
} from "@/lib/actions/estimates";

/**
 * The completion certificate editor.
 *
 * Deliberately not the estimate builder. A certificate carries no money:
 * it was previously edited through the builder, which meant a document
 * about a finished $5,400 job showed Cost, Price, Margin, Tax, a
 * "Generate priced estimate" button and a $0.00 total, plus a warning to
 * go and set a tax rate. Every one of those controls was either
 * meaningless or actively misleading, and the total invited exactly the
 * wrong conclusion.
 *
 * What a certificate actually has is two facts and a signature: the date
 * the work finished, and anything still outstanding.
 */
export function CompletionEditor({
  estimate,
  signers,
  customer,
  canEdit,
  canSend = true,
  canDelete,
}: {
  estimate: Estimate;
  signers: EstimateSigner[];
  customer: { name: string; address: string | null };
  canEdit: boolean;
  /** The Send Estimates switch -- same meaning as on the estimate builder. */
  canSend?: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [completedOn, setCompletedOn] = useState(estimate.completed_on ?? "");
  const [paperDialog, setPaperDialog] = useState(false);
  const [notes, setNotes] = useState(estimate.completion_notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pending, startTransition] = useTransition();

  const signed = estimate.status === "Signed";
  const locked = signed || !canEdit;
  const customerItems = estimate.completion_customer_items?.trim();

  function save(then?: () => Promise<void>) {
    setError(null);
    setSaved(null);
    startTransition(async () => {
      const res = await saveCompletionDetails(estimate.id, { completedOn, notes });
      if (res.error) return setError(res.error);
      if (then) return void then();
      setSaved("Saved");
      router.refresh();
    });
  }

  async function send(deliver: "manual" | "email" | "text") {
    const res =
      deliver === "manual"
        ? await markEstimateSent(estimate.id)
        : await sendEstimateToCustomer(estimate.id, deliver);
    if (res.error) return setError(res.error);
    setSaved(
      "sentTo" in res && res.sentTo
        ? `${deliver === "email" ? "Emailed" : "Texted"} to ${res.sentTo}`
        : "Marked as sent"
    );
    router.refresh();
  }

  return (
    <div>
      <div className="module-toolbar">
        <div>
          <h1 className="module-title">{estimate.doc_number}</h1>
          <p className="module-sub">
            {customer.name}
            {customer.address ? ` · ${customer.address}` : ""}
          </p>
        </div>
        <div className="est-header-actions">
          <button className="btn-ghost" onClick={() => router.push("/estimates")}>
            Back
          </button>
          <button
            className="btn-ghost"
            onClick={() => router.push(`/estimates/${estimate.id}/preview`)}
          >
            Preview as Customer
          </button>
          <button
            className="btn-ghost"
            onClick={() => router.push(`/estimates/${estimate.id}/preview?print=1`)}
          >
            Print / PDF
          </button>
          {!locked && (
            <button className="btn-save-red" onClick={() => save()} disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </button>
          )}
          {/* Behind the Send Estimates switch, like the estimate builder:
              each of these takes the certificate out of Draft. */}
          {!locked && canSend && (
            <>
              <button
                className="btn-ghost"
                onClick={() => save(() => send("manual"))}
                disabled={pending}
                title="Mark as sent without texting or emailing"
              >
                Mark Sent
              </button>
              <button
                className="btn-ghost"
                onClick={() => save(async () => setPaperDialog(true))}
                disabled={pending}
                title="Record a signature that happened with a pen -- nothing is sent to the customer"
              >
                Signed on paper
              </button>
              <button
                className="btn-ghost"
                onClick={() => save(() => send("email"))}
                disabled={pending}
              >
                Save &amp; Email to Customer
              </button>
              <button
                className="btn-primary"
                onClick={() => save(() => send("text"))}
                disabled={pending}
              >
                Save &amp; Text to Customer
              </button>
            </>
          )}
          {canDelete && estimate.status === "Draft" && (
            <button
              className="btn-ghost est-void-btn"
              onClick={() => setDeleting(true)}
              disabled={pending}
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {deleting && (
        <div className="est-locked-banner">
          <p style={{ margin: "0 0 8px" }}>
            <strong>Delete {estimate.doc_number}?</strong> The certificate goes for good. The
            contract and its payment schedule are untouched, and you can raise a new
            certificate afterwards.
          </p>
          <button
            className="btn-primary small"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await deleteEstimate(estimate.id);
                if (res.error) {
                  setDeleting(false);
                  return setError(res.error);
                }
                router.push("/estimates");
              })
            }
          >
            Delete for good
          </button>
          <button className="btn-ghost small" onClick={() => setDeleting(false)}>
            Cancel
          </button>
        </div>
      )}

      {!locked && !canSend && (
        <div className="est-locked-banner">
          Drafts only: you can fill in and save this certificate, but sending it to the
          customer is done by the office. Ask an Office or Admin user to send it — or to turn
          on Send Estimates for you in Users &amp; Roles.
        </div>
      )}

      {signed && (
        <div className="est-locked-banner">
          <strong>Signed on {fmt(estimate.signed_at)}.</strong> A signed certificate is the
          record of what the customer accepted, so it can no longer be edited.
        </div>
      )}

      <div className="comp-editor">
        <p className="hint-note" style={{ marginTop: 0 }}>
          This certificate has no prices &mdash; it records that the work is finished and
          accepted. The customer signs it, and can add anything they want put right before
          they do.
        </p>

        <label className="field">
          <span className="field-label">Date the work was completed</span>
          <input
            type="date"
            value={completedOn}
            disabled={locked}
            onChange={(e) => {
              setCompletedOn(e.target.value);
              setSaved(null);
            }}
          />
          <span className="est-tax-note">
            The one-year labour warranty in the contract runs from this date.
          </span>
        </label>

        <label className="field">
          <span className="field-label">Outstanding items</span>
          <textarea
            className="est-textarea"
            rows={5}
            value={notes}
            disabled={locked}
            placeholder={"One per line, e.g.\nTouch up paint in the hallway\nReplace cracked switch plate"}
            onChange={(e) => {
              setNotes(e.target.value);
              setSaved(null);
            }}
          />
          <span className="est-tax-note">
            Anything you already know is still to do. Listed items stay your responsibility and
            are not waived by the customer signing. Leave empty if the job is finished in full.
          </span>
        </label>

        {/* The customer's own list, shown back to the office. This is the
            half of the certificate nobody could see before: they could
            sign a document saying they accept the work in full while
            believing they had raised three problems. */}
        {customerItems ? (
          <div className="comp-customer-items">
            <div className="field-label">Raised by the customer when signing</div>
            <p className="comp-customer-text">{customerItems}</p>
            <span className="est-tax-note">
              In the customer&apos;s own words, recorded on the certificate they signed. These
              remain your responsibility.
            </span>
          </div>
        ) : (
          signed && (
            <div className="comp-customer-items">
              <div className="field-label">Raised by the customer when signing</div>
              <p className="estdoc-muted" style={{ margin: "6px 0 0" }}>
                Nothing &mdash; they accepted the work without raising anything.
              </p>
            </div>
          )
        )}

        <div className="comp-signers">
          <div className="field-label">Signature</div>
          {signers.length === 0 ? (
            <p className="estdoc-muted" style={{ margin: "6px 0 0" }}>
              No signer on this certificate. Add the customer&apos;s details on the lead and
              raise it again.
            </p>
          ) : (
            <ul className="comp-signer-list">
              {signers.map((s) => (
                <li key={s.id}>
                  <strong>{s.name || "Customer"}</strong>
                  {s.email ? ` · ${s.email}` : ""}
                  {s.phone ? ` · ${s.phone}` : ""}
                  <span className={s.signed_at ? "comp-signed" : "comp-unsigned"}>
                    {s.signed_at ? `Signed ${fmt(s.signed_at)}` : "Not signed yet"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && <p className="error-note">{error}</p>}
        {saved && <p className="est-saved-note">{saved}</p>}
      </div>
      {paperDialog && (
        <SignedOnPaperDialog
          estimateId={estimate.id}
          leadId={estimate.lead_id}
          docLabel="completion form"
          onClose={() => setPaperDialog(false)}
        />
      )}
    </div>
  );
}

function fmt(value: string | null) {
  if (!value) return "—";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

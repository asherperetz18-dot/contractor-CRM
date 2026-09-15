"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { previewEstimateEmail, type SendEstimateResult } from "@/lib/actions/estimates";

/**
 * Replaces the old 5-button send cluster (Mark Sent, Signed on paper,
 * Save & Email, Save & Text, Save & Send Both) with 2 controls: a "More"
 * menu for the two non-notifying paths, and a "Send Estimate" button that
 * opens a real To/Cc/Bcc compose drawer. Back/Preview/Print/Save/Delete/
 * Void stay where they already were in the parent -- this only touches
 * the actual send flow.
 *
 * No channel picker: every send tries email and text and sends whichever
 * this contact actually has on file (already how `sendEstimateToCustomer`'s
 * "both" channel behaves -- only errors if neither exists) -- a rep no
 * longer has to know or choose which channel is available.
 *
 * Sending itself goes through `onSend`, not a direct call to
 * `sendEstimateToCustomer` -- the parent owns the line-item form state
 * and must save it first (same "Save & Email" semantics the old buttons
 * had: a fresh edit is part of what gets sent, not silently left behind).
 */
export function EstimateSendPanel({
  estimateId,
  docNumber,
  customerEmail,
  secondContactEmail,
  pending,
  onMarkSent,
  onSignedOnPaper,
  onSend,
}: {
  estimateId: string;
  docNumber: string;
  customerEmail: string | null;
  secondContactEmail: string | null;
  pending: boolean;
  onMarkSent: () => void;
  onSignedOnPaper: () => void;
  /** Saves the current draft, then sends. Resolves with the send result
   *  (or a save error surfaced the same shape) -- this component never
   *  calls `router.refresh()` itself, that's the parent's job on success. */
  onSend: (recipients: {
    to: string;
    cc: string;
    bcc: string;
    narrative?: string;
  }) => Promise<SendEstimateResult>;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toInput, setToInput] = useState("");
  const [ccInput, setCcInput] = useState("");
  const [bccInput, setBccInput] = useState("");
  const [showBcc, setShowBcc] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendEstimateResult | null>(null);

  // The message preview: fetched fresh each time the drawer opens (so it
  // reflects the latest saved total/title), editable from there. Only a
  // genuinely edited message is ever sent verbatim -- see `narrativeDirty`
  // below for why an untouched preview is deliberately NOT what gets sent.
  const [subjectPreview, setSubjectPreview] = useState<string | null>(null);
  const [narrativeInput, setNarrativeInput] = useState("");
  const [narrativeDirty, setNarrativeDirty] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  function resetAndClose() {
    setDrawerOpen(false);
    setToInput("");
    setCcInput("");
    setBccInput("");
    setShowBcc(false);
    setResult(null);
    setSubjectPreview(null);
    setNarrativeInput("");
    setNarrativeDirty(false);
  }

  async function openDrawer() {
    setDrawerOpen(true);
    setPreviewLoading(true);
    const preview = await previewEstimateEmail(estimateId);
    setPreviewLoading(false);
    if (preview.error) return; // Leave the message field blank rather than block sending.
    setSubjectPreview(preview.subject ?? null);
    setNarrativeInput(preview.narrative ?? "");
  }

  async function handleSend() {
    setSending(true);
    setResult(null);
    const res = await onSend({
      to: toInput,
      cc: ccInput,
      bcc: bccInput,
      // Deliberately undefined when the rep never touched the preview:
      // the server then builds its own fresh default (from the total
      // *after* the pre-send save), instead of resending a preview that
      // may have gone stale the moment a line item changed.
      narrative: narrativeDirty ? narrativeInput : undefined,
    });
    setSending(false);
    setResult(res);
    const invalid = (res.invalidTo?.length ?? 0) + (res.invalidCc?.length ?? 0) + (res.invalidBcc?.length ?? 0);
    // Close clean only -- a typo'd address still needs to be seen even
    // though the rest of the send went through.
    if (!res.error && invalid === 0) {
      resetAndClose();
    }
  }

  const invalidCount =
    (result?.invalidTo?.length ?? 0) + (result?.invalidCc?.length ?? 0) + (result?.invalidBcc?.length ?? 0);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div className="columns-menu-wrap">
        <button type="button" className="btn-ghost" onClick={() => setMoreOpen((v) => !v)} disabled={pending}>
          More &#9662;
        </button>
        {moreOpen && (
          <>
            <div className="quick-create-backdrop" onClick={() => setMoreOpen(false)} />
            <div className="columns-menu">
              <div
                className="columns-menu-item"
                onClick={() => {
                  setMoreOpen(false);
                  onMarkSent();
                }}
              >
                Mark Sent
              </div>
              <div
                className="columns-menu-item"
                onClick={() => {
                  setMoreOpen(false);
                  onSignedOnPaper();
                }}
              >
                Signed on paper
              </div>
            </div>
          </>
        )}
      </div>

      <button type="button" className="btn-primary" onClick={openDrawer} disabled={pending}>
        Send Estimate
      </button>

      {drawerOpen && (
        <Modal title={`Send ${docNumber}`} onClose={resetAndClose} drawer>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <p className="hint-note" style={{ margin: 0 }}>
              Sends by email and text automatically — whichever this contact has on file.
            </p>

            <div className="field">
              <span className="field-label">To</span>
              {customerEmail && (
                <div className="recipient-chip-row">
                  <span className="recipient-chip">{customerEmail}</span>
                </div>
              )}
              <input
                type="text"
                value={toInput}
                onChange={(e) => setToInput(e.target.value)}
                placeholder="Add another recipient, comma-separated&hellip;"
                disabled={sending}
              />
            </div>

            <div className="field">
              <span className="field-label">Cc</span>
              {secondContactEmail && (
                <div className="recipient-chip-row">
                  <span className="recipient-chip recipient-chip-auto">{secondContactEmail} · co-owner</span>
                </div>
              )}
              <input
                type="text"
                value={ccInput}
                onChange={(e) => setCcInput(e.target.value)}
                placeholder="Add a project manager, spouse, etc.&hellip;"
                disabled={sending}
              />
            </div>

            {showBcc ? (
              <div className="field">
                <span className="field-label">Bcc</span>
                <input
                  type="text"
                  value={bccInput}
                  onChange={(e) => setBccInput(e.target.value)}
                  placeholder="Invisible to every other recipient&hellip;"
                  disabled={sending}
                />
              </div>
            ) : (
              <button
                type="button"
                className="link-add"
                style={{ alignSelf: "flex-start", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                onClick={() => setShowBcc(true)}
              >
                + Add Bcc
              </button>
            )}

            <p className="hint-note" style={{ margin: 0 }}>
              To and Cc recipients can see each other&rsquo;s addresses. Bcc stays hidden.
            </p>

            <div className="field">
              <span className="field-label">Subject</span>
              <input type="text" value={previewLoading ? "Loading…" : subjectPreview ?? ""} disabled readOnly />
            </div>

            <div className="field">
              <span className="field-label">Message</span>
              <textarea
                rows={7}
                value={previewLoading ? "Loading…" : narrativeInput}
                disabled={previewLoading || sending}
                onChange={(e) => {
                  setNarrativeInput(e.target.value);
                  setNarrativeDirty(true);
                }}
              />
              <p className="hint-note" style={{ margin: "4px 0 0" }}>
                This is what the customer reads before the document link. The link, company
                footer and legal notice are added automatically either way.
              </p>
            </div>

            {result?.error && <p className="error-note">{result.error}</p>}
            {result && !result.error && invalidCount > 0 && (
              <>
                {result.sentTo && <p className="cp-saved">Sent to {result.sentTo}.</p>}
                <p className="error-note">
                  {[
                    result.invalidTo?.length ? `Not a valid To address: ${result.invalidTo.join(", ")}` : null,
                    result.invalidCc?.length ? `Not a valid Cc address: ${result.invalidCc.join(", ")}` : null,
                    result.invalidBcc?.length ? `Not a valid Bcc address: ${result.invalidBcc.join(", ")}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </>
            )}
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={resetAndClose} disabled={sending}>
              {result && !result.error && invalidCount > 0 ? "Done" : "Cancel"}
            </button>
            <button type="button" className="btn-primary" onClick={handleSend} disabled={sending || previewLoading}>
              {sending ? "Sending…" : "Send Estimate"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

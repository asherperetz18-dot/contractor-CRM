"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import type { SendEstimateResult } from "@/lib/actions/estimates";

type Channel = "email" | "text" | "both";

/**
 * Replaces the old 5-button send cluster (Mark Sent, Signed on paper,
 * Save & Email, Save & Text, Save & Send Both) with 2 controls: a "More"
 * menu for the two non-notifying paths, and a "Send Estimate" button that
 * opens a real To/Cc/Bcc compose drawer. Back/Preview/Print/Save/Delete/
 * Void stay where they already were in the parent -- this only touches
 * the actual send flow.
 *
 * Sending itself goes through `onSend`, not a direct call to
 * `sendEstimateToCustomer` -- the parent owns the line-item form state
 * and must save it first (same "Save & Email" semantics the old buttons
 * had: a fresh edit is part of what gets sent, not silently left behind).
 */
export function EstimateSendPanel({
  docNumber,
  customerEmail,
  secondContactEmail,
  pending,
  onMarkSent,
  onSignedOnPaper,
  onSend,
}: {
  docNumber: string;
  customerEmail: string | null;
  secondContactEmail: string | null;
  pending: boolean;
  onMarkSent: () => void;
  onSignedOnPaper: () => void;
  /** Saves the current draft, then sends. Resolves with the send result
   *  (or a save error surfaced the same shape) -- this component never
   *  calls `router.refresh()` itself, that's the parent's job on success. */
  onSend: (channel: Channel, recipients: { to: string; cc: string; bcc: string }) => Promise<SendEstimateResult>;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [channel, setChannel] = useState<Channel>("email");
  const [toInput, setToInput] = useState("");
  const [ccInput, setCcInput] = useState("");
  const [bccInput, setBccInput] = useState("");
  const [showBcc, setShowBcc] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendEstimateResult | null>(null);

  function resetAndClose() {
    setDrawerOpen(false);
    setToInput("");
    setCcInput("");
    setBccInput("");
    setShowBcc(false);
    setResult(null);
    setChannel("email");
  }

  async function handleSend() {
    setSending(true);
    setResult(null);
    const res = await onSend(channel, { to: toInput, cc: ccInput, bcc: bccInput });
    setSending(false);
    setResult(res);
    const invalid = (res.invalidTo?.length ?? 0) + (res.invalidCc?.length ?? 0) + (res.invalidBcc?.length ?? 0);
    // Close clean only -- a typo'd address still needs to be seen even
    // though the rest of the send went through.
    if (!res.error && invalid === 0) {
      resetAndClose();
    }
  }

  const showRecipients = channel !== "text";
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

      <button type="button" className="btn-primary" onClick={() => setDrawerOpen(true)} disabled={pending}>
        Send Estimate
      </button>

      {drawerOpen && (
        <Modal title={`Send ${docNumber}`} onClose={resetAndClose} drawer>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="field">
              <span className="field-label">Send As</span>
              <div className="channel-segmented">
                <button type="button" className={channel === "email" ? "active" : ""} onClick={() => setChannel("email")}>
                  Email
                </button>
                <button type="button" className={channel === "text" ? "active" : ""} onClick={() => setChannel("text")}>
                  Text
                </button>
                <button type="button" className={channel === "both" ? "active" : ""} onClick={() => setChannel("both")}>
                  Email + Text
                </button>
              </div>
            </div>

            {showRecipients ? (
              <>
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
              </>
            ) : (
              <p className="hint-note" style={{ margin: 0 }}>
                Texts the customer&rsquo;s phone number on file.
              </p>
            )}

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
            <button type="button" className="btn-primary" onClick={handleSend} disabled={sending}>
              {sending ? "Sending…" : "Send Estimate"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

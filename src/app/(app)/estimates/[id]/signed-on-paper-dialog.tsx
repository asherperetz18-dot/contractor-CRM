"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { markSignedOnPaper } from "@/lib/actions/estimates";
import { uploadLeadFileDirect } from "@/lib/uploads/lead-file-upload";
import { useFileDrop } from "@/components/uploads/file-drop";

/**
 * Records a signature that happened with a pen. The staff member names
 * who signed and when (backdatable -- the paper knows its own date),
 * optionally attaches the scan, and the document then behaves exactly
 * like a portal-signed one. Nothing is sent to the customer, which is
 * the whole point of the flow.
 */
export function SignedOnPaperDialog({
  estimateId,
  leadId,
  docLabel,
  onClose,
}: {
  estimateId: string;
  leadId: string;
  /** "contract", "change order" or "completion form" -- for the copy. */
  docLabel: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [signerName, setSignerName] = useState("");
  const [signedDate, setSignedDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  // The scan can be dragged onto the row, and a picked image shows a
  // thumbnail so the wrong page is caught before Record is pressed.
  const { dragOver, dropProps } = useFileDrop((files) => setFile(files[0]), pending);
  const filePreview = useMemo(
    () => (file && file.type.startsWith("image/") ? URL.createObjectURL(file) : null),
    [file]
  );
  useEffect(() => () => { if (filePreview) URL.revokeObjectURL(filePreview); }, [filePreview]);

  async function confirm() {
    if (!signerName.trim()) return setError("Enter the customer's name as signed.");
    setError("");
    setPending(true);
    try {
      // The scan first, so the note the action writes can name it. Same
      // browser-to-storage path every lead file takes.
      let scanFileName: string | null = null;
      if (file) {
        const uploaded = await uploadLeadFileDirect(leadId, file, { estimateId });
        if (uploaded.error) return setError(uploaded.error);
        scanFileName = uploaded.fileName ?? file.name;
      }

      const res = await markSignedOnPaper(estimateId, {
        signerName,
        signedDate,
        scanFileName,
      });
      if (res.error) return setError(res.error);
      onClose();
      router.refresh();
    } catch {
      setError("Didn't save — check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal title="Signed on paper" onClose={() => { if (!pending) onClose(); }}>
      <p className="module-sub" style={{ marginTop: 0 }}>
        Records this {docLabel} as signed outside the system — status, payment schedule,
        checklists and Projects all behave as if it was signed in the portal.{" "}
        <strong>Nothing is sent to the customer.</strong>
      </p>
      <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="qr-form">
          <label className="field">
            <span>Signed by (name as written)</span>
            <input
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              placeholder="e.g. Chaya Rosenberg"
            />
          </label>
          <label className="field">
            <span>Date signed</span>
            <input
              type="date"
              value={signedDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setSignedDate(e.target.value)}
            />
          </label>
        </div>
        <div
          className={`panel-drop${dragOver ? " drag-over" : ""}`}
          style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, margin: "10px 0" }}
          {...dropProps}
        >
          <input
            ref={fileInput}
            type="file"
            accept="image/*,application/pdf"
            style={{ display: "none" }}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <button type="button" className="btn-ghost small" onClick={() => fileInput.current?.click()}>
            📎{" "}
            {dragOver
              ? "Drop the scan"
              : file
                ? "Change scan"
                : "Attach the signed scan (optional) — or drag & drop"}
          </button>
          {filePreview && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img className="lead-file-thumb" src={filePreview} alt="Scan preview" />
          )}
          {file && (
            <span className="est-tax-note" style={{ wordBreak: "break-all", minWidth: 0 }}>
              {file.name}
            </span>
          )}
        </div>

        {error && <p className="error-note">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={confirm}>
            {pending ? "Recording…" : "Record signature"}
          </button>
        </div>
      </fieldset>
    </Modal>
  );
}

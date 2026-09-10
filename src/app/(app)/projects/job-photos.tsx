"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getJobPhotos, fileDocumentUnderJob } from "@/lib/actions/estimate-files";
import { Modal } from "@/components/ui/modal";
import { leadPhotoThumbUrl, type LeadPhoto } from "@/lib/data/types";
import { uploadLeadFileDirect } from "@/lib/uploads/lead-file-upload";
import { FileDropzone, useUploadQueue } from "@/components/uploads/file-drop";

/**
 * ONE job's photos. A customer with two contracts has one file store,
 * so this view shows what is filed under THIS contract, and offers the
 * customer's unfiled pictures below for one-click filing -- job A's
 * demo photos never appear under job B. New uploads from here file
 * themselves under the job automatically.
 */
export function JobPhotos({
  leadId,
  estimateId,
  jobLabel,
  canUpload,
  canFile,
  onClose,
}: {
  leadId: string;
  estimateId: string;
  jobLabel: string;
  canUpload: boolean;
  /** Moving existing files between jobs: Office/Admin/Production. */
  canFile: boolean;
  onClose: () => void;
}) {
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const [filed, setFiled] = useState<LeadPhoto[] | null>(null);
  const [unfiled, setUnfiled] = useState<LeadPhoto[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    const res = await getJobPhotos(leadId, estimateId);
    if (res.error) setError(res.error);
    setFiled(res.filed ?? []);
    setUnfiled(res.unfiled ?? []);
  }, [leadId, estimateId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getJobPhotos(leadId, estimateId);
      if (cancelled) return;
      if (res.error) setError(res.error);
      setFiled(res.filed ?? []);
      setUnfiled(res.unfiled ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [leadId, estimateId]);

  // Filed under THIS job at birth -- that is what the chip means.
  const uploadOne = useCallback(
    async (file: File) => {
      const res = await uploadLeadFileDirect(leadId, file, { estimateId });
      return res.error ?? null;
    },
    [leadId, estimateId]
  );
  const { queue, pending, errors, progressLabel, start } = useUploadQueue(uploadOne);

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!chosen.length) return;
    setError("");
    await start(chosen);
    await reload();
  }

  async function fileUnder(photoId: string) {
    setBusy("filing");
    const res = await fileDocumentUnderJob(photoId, estimateId);
    setBusy("");
    if (res.error) return setError(res.error);
    await reload();
  }

  const grid = (photos: LeadPhoto[], withFileButton: boolean) => (
    <div className="jp-grid">
      {photos.map((p) => (
        <div key={p.id} className="jp-cell">
          <a href={p.file_url} target="_blank" rel="noopener noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element -- external
                Drive/storage URLs, sizes unknown at build time */}
            <img src={leadPhotoThumbUrl(p)} alt={p.file_name} loading="lazy" referrerPolicy="no-referrer" />
          </a>
          {withFileButton && (
            <button
              type="button"
              className="btn-ghost small"
              disabled={!!busy}
              onClick={() => void fileUnder(p.id)}
            >
              File under this job
            </button>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <Modal title={`Photos — ${jobLabel}`} onClose={() => { if (!busy) onClose(); }} wide>
      {canUpload && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            style={{ display: "none" }}
            onChange={handleFiles}
          />
          <button
            type="button"
            className="btn-primary small"
            disabled={!!busy || pending}
            onClick={() => cameraRef.current?.click()}
          >
            📷 Take photo
          </button>
          <FileDropzone
            onFiles={(f) => {
              setError("");
              void start(f).then(reload);
            }}
            label="🖼 Add from library — or drag & drop"
            accept="image/*"
            disabled={!!busy}
            queue={queue}
            progressLabel={progressLabel}
            className="file-dropzone-grow"
          />
          {busy && <span className="hint-note">{busy}</span>}
        </div>
      )}

      {error && <p className="error-note">{error}</p>}
      {errors.map((msg) => (
        <p key={msg} className="error-note">
          {msg}
        </p>
      ))}

      {filed === null ? (
        <p className="empty-hint">Loading photos…</p>
      ) : (
        <>
          {filed.length === 0 ? (
            <p className="empty-hint">
              No photos on this job yet{canUpload ? " — take the first one." : "."}
            </p>
          ) : (
            grid(filed, false)
          )}
          {canFile && unfiled.length > 0 && (
            <details className="jp-unfiled">
              <summary>
                Other photos on this customer, not filed to a job ({unfiled.length})
              </summary>
              {grid(unfiled, true)}
            </details>
          )}
        </>
      )}
    </Modal>
  );
}

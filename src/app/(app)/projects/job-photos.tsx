"use client";

import { useEffect, useRef, useState } from "react";
import { getLeadPhotos } from "@/lib/actions/estimate-files";
import { createLeadFileUploadUrl, recordLeadFile } from "@/lib/actions/lead-files";
import { Modal } from "@/components/ui/modal";
import { leadPhotoThumbUrl, type LeadPhoto } from "@/lib/data/types";
import { downscaleImage } from "@/lib/images/downscale";
import { createClient as createBrowserClient } from "@/lib/supabase/client";

/**
 * The job's photos, right on the Projects page. Everything here is the
 * lead's one file store -- the same pictures the estimate builder picks
 * from, the client portal shows, and Google Drive files under Photos --
 * so a photo taken on site is instantly everywhere a photo can matter.
 *
 * Upload follows the visit-media pattern: two inputs, one that opens
 * the camera directly and one for the library, because a single input
 * with a capture attribute traps phones in the camera while a single
 * input without it buries the camera behind a picker.
 */
export function JobPhotos({
  leadId,
  jobLabel,
  canUpload,
  onClose,
}: {
  leadId: string;
  jobLabel: string;
  canUpload: boolean;
  onClose: () => void;
}) {
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const libraryRef = useRef<HTMLInputElement | null>(null);
  const [photos, setPhotos] = useState<LeadPhoto[] | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function reload() {
    const res = await getLeadPhotos(leadId);
    if (res.error) setError(res.error);
    setPhotos(res.photos ?? []);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getLeadPhotos(leadId);
      if (cancelled) return;
      if (res.error) setError(res.error);
      setPhotos(res.photos ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!chosen.length) return;
    setError("");

    for (let i = 0; i < chosen.length; i++) {
      const original = chosen[i];
      setBusy(`Uploading ${i + 1} of ${chosen.length}…`);
      // Shrunk in the browser -- the upload itself is the slow part on
      // job-site cellular, and downscaleImage passes video and small
      // files through untouched.
      const file = await downscaleImage(original);

      const signed = await createLeadFileUploadUrl(leadId, file.name, file.size);
      if (signed.error || !signed.path || !signed.token) {
        setError(`${original.name}: ${signed.error ?? "could not start that upload"}`);
        break;
      }
      // Browser straight to storage: a video posted through a server
      // action never arrives -- Vercel rejects the body with a 413
      // before the action runs.
      const { error: uploadError } = await createBrowserClient()
        .storage.from("lead-files")
        .uploadToSignedUrl(signed.path, signed.token, file, {
          contentType: file.type || undefined,
        });
      if (uploadError) {
        setError(`${original.name}: ${uploadError.message}`);
        break;
      }
      const recorded = await recordLeadFile(
        leadId,
        signed.path,
        file.name,
        file.size,
        file.type || null
      );
      if (recorded.error) {
        setError(`${original.name}: ${recorded.error}`);
        break;
      }
    }
    setBusy("");
    await reload();
  }

  const images = (photos ?? []).filter((p) => p.content_type?.startsWith("image/"));
  const docs = (photos ?? []).filter((p) => !p.content_type?.startsWith("image/"));

  return (
    <Modal title={`Photos — ${jobLabel}`} onClose={() => { if (!busy) onClose(); }} wide>
      {canUpload && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: "none" }}
            onChange={handleFiles}
          />
          <input
            ref={libraryRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            style={{ display: "none" }}
            onChange={handleFiles}
          />
          <button
            type="button"
            className="btn-primary small"
            disabled={!!busy}
            onClick={() => cameraRef.current?.click()}
          >
            📷 Take photo
          </button>
          <button
            type="button"
            className="btn-ghost small"
            disabled={!!busy}
            onClick={() => libraryRef.current?.click()}
          >
            🖼 Add from library
          </button>
          {busy && <span className="hint-note">{busy}</span>}
        </div>
      )}

      {error && <p className="error-note">{error}</p>}

      {photos === null ? (
        <p className="empty-hint">Loading photos…</p>
      ) : images.length === 0 && docs.length === 0 ? (
        <p className="empty-hint">
          No photos on this job yet
          {canUpload ? " — take the first one." : "."}
        </p>
      ) : (
        <>
          {images.length > 0 && (
            <div className="jp-grid">
              {images.map((p) => (
                <a key={p.id} href={p.file_url} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- external
                      Drive/storage URLs, sizes unknown at build time */}
                  <img src={leadPhotoThumbUrl(p)} alt={p.file_name} loading="lazy" referrerPolicy="no-referrer" />
                </a>
              ))}
            </div>
          )}
          {docs.length > 0 && (
            <ul className="jp-docs">
              {docs.map((p) => (
                <li key={p.id}>
                  <a href={p.file_url} target="_blank" rel="noopener noreferrer">
                    📄 {p.file_name}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Modal>
  );
}

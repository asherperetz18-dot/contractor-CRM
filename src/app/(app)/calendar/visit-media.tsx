"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { deleteLeadFile } from "@/lib/actions/lead-files";
import { getVisitMedia, type VisitFile } from "@/lib/actions/visit-media";
import { uploadLeadFileDirect } from "@/lib/uploads/lead-file-upload";
import { FileDropzone, useUploadQueue } from "@/components/uploads/file-drop";
import { leadPhotoThumbUrl } from "@/lib/data/types";

function sizeLabel(bytes: number | null) {
  if (bytes == null) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const isImage = (f: VisitFile) => (f.content_type ?? "").startsWith("image/");
const isVideo = (f: VisitFile) => (f.content_type ?? "").startsWith("video/");

/**
 * Photos and video from a site visit.
 *
 * Attached to the appointment as well as the contact, because "what did
 * the roof look like on Tuesday" is a question about a visit, not about
 * a person -- a contact with four visits' worth of photos in one pile
 * answers nothing.
 *
 * Uploads one at a time rather than in parallel: this runs on a phone on
 * site cellular, and six simultaneous uploads on a bad signal is how you
 * get six failures instead of six photos.
 */
export function VisitMedia({
  leadId,
  eventId,
  readOnly,
}: {
  leadId: string;
  eventId: string;
  readOnly?: boolean;
}) {
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<VisitFile[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function reload() {
    const res = await getVisitMedia(eventId);
    setFiles(res.files ?? []);
  }

  const uploadOne = useCallback(
    async (file: File) => {
      const res = await uploadLeadFileDirect(leadId, file, { eventId });
      if (!res.error) {
        // Refresh after each file, so a long batch shows up as it lands.
        const fresh = await getVisitMedia(eventId);
        setFiles(fresh.files ?? []);
      }
      return res.error ?? null;
    },
    [leadId, eventId]
  );
  const { queue, pending, errors, progressLabel, start } = useUploadQueue(uploadOne);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getVisitMedia(eventId);
      if (!cancelled) setFiles(res.files ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!chosen.length) return;
    setError("");
    await start(chosen);
    await reload();
  }

  async function remove(f: VisitFile) {
    setBusy("Removing…");
    const res = await deleteLeadFile(f.id, f.file_path ?? "", f.storage_provider ?? undefined);
    setBusy(null);
    if (res?.error) return setError(res.error);
    await reload();
  }

  return (
    <div className="second-contact-block">
      <div className="second-contact-head">
        <span>Photos &amp; Video</span>
        {files && files.length > 0 && (
          <span className="est-tax-note">{files.length} on this visit</span>
        )}
      </div>

      {!readOnly && (
        <div className="visit-media-actions">
          {/* capture opens the camera straight away on a phone instead of
              a file browser, which is the whole point on site. */}
          <input
            ref={cameraRef}
            type="file"
            accept="image/*,video/*"
            capture="environment"
            multiple
            hidden
            onChange={handleFiles}
          />
          <button
            type="button"
            className="btn-primary small"
            onClick={() => cameraRef.current?.click()}
            disabled={!!busy || pending}
          >
            Take photo / video
          </button>
          <FileDropzone
            onFiles={(f) => {
              setError("");
              void start(f).then(reload);
            }}
            label="Choose from device — or drag & drop"
            accept="image/*,video/*"
            disabled={!!busy}
            queue={queue}
            progressLabel={progressLabel}
            className="file-dropzone-grow"
          />
        </div>
      )}

      {busy && <p className="empty-hint">{busy}</p>}
      {error && <p className="error-note">{error}</p>}
      {errors.map((msg) => (
        <p key={msg} className="error-note">
          {msg}
        </p>
      ))}

      {files === null ? (
        <p className="empty-hint">Loading…</p>
      ) : files.length === 0 ? (
        <p className="empty-hint">
          Nothing from this visit yet. Photos taken here also show on the contact.
        </p>
      ) : (
        <div className="visit-media-grid">
          {files.map((f) => (
            <figure key={f.id} className="visit-media-item">
              <a href={f.file_url ?? "#"} target="_blank" rel="noopener noreferrer">
                {isImage(f) && f.file_url ? (
                  /* Drive-stored files' file_url is the Drive VIEWER page
                     (HTML, not pixels), which renders as a broken icon in
                     an <img> -- leadPhotoThumbUrl returns a real image
                     URL for those, and the file itself for bucket files. */
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={leadPhotoThumbUrl({
                      file_url: f.file_url,
                      file_path: f.file_path,
                      storage_provider: f.storage_provider,
                    })}
                    alt={f.file_name}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="visit-media-file">{isVideo(f) ? "▶" : "📄"}</div>
                )}
              </a>
              <figcaption>
                <span className="visit-media-name" title={f.file_name}>
                  {f.file_name}
                </span>
                <span className="est-tax-note">{sizeLabel(f.file_size)}</span>
                {!readOnly && (
                  <button
                    type="button"
                    className="btn-ghost small"
                    onClick={() => remove(f)}
                    disabled={!!busy}
                  >
                    Remove
                  </button>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}

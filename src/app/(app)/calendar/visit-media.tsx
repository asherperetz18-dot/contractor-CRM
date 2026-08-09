"use client";

import { useEffect, useRef, useState } from "react";
import { uploadLeadFile, deleteLeadFile } from "@/lib/actions/lead-files";
import { getVisitMedia, type VisitFile } from "@/lib/actions/visit-media";
import { downscaleImage } from "@/lib/images/downscale";

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
  const libraryRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<VisitFile[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function reload() {
    const res = await getVisitMedia(eventId);
    setFiles(res.files ?? []);
  }

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

    for (let i = 0; i < chosen.length; i++) {
      const original = chosen[i];
      setBusy(`Uploading ${i + 1} of ${chosen.length}…`);
      // Shrunk here rather than server-side: it saves the upload itself,
      // which is the slow part on a job site.
      const file = await downscaleImage(original);
      const fd = new FormData();
      fd.append("file", file);
      const res = await uploadLeadFile(leadId, fd, eventId);
      if (res?.error) {
        setError(`${original.name}: ${res.error}`);
        break;
      }
    }
    setBusy(null);
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
          <input
            ref={libraryRef}
            type="file"
            accept="image/*,video/*"
            multiple
            hidden
            onChange={handleFiles}
          />
          <button
            type="button"
            className="btn-primary small"
            onClick={() => cameraRef.current?.click()}
            disabled={!!busy}
          >
            Take photo / video
          </button>
          <button
            type="button"
            className="btn-ghost small"
            onClick={() => libraryRef.current?.click()}
            disabled={!!busy}
          >
            Choose from device
          </button>
        </div>
      )}

      {busy && <p className="empty-hint">{busy}</p>}
      {error && <p className="error-note">{error}</p>}

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
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={f.file_url} alt={f.file_name} loading="lazy" />
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

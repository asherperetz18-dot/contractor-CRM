"use client";

import { useRef, useState } from "react";
import type { LeadFile, Profile } from "@/lib/data/types";
import { attachmentIsImage, leadPhotoThumbUrl } from "@/lib/data/types";
import {
  createLeadFileUploadUrl,
  deleteLeadFile,
  recordLeadFile,
} from "@/lib/actions/lead-files";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { downscaleImage } from "@/lib/images/downscale";

function formatSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** One file moving through the upload loop, for the preview strip. */
type QueuedUpload = {
  name: string;
  /** Object URL for a local image preview; null for non-images. */
  previewUrl: string | null;
  status: "waiting" | "uploading" | "done" | "failed";
};

export function LeadFilesPanel({
  leadId,
  files,
  reps,
  readOnly,
  onChanged,
}: {
  leadId: string;
  files: LeadFile[];
  reps: Profile[];
  readOnly?: boolean;
  onChanged: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Counts enter/leave pairs: children of the dropzone fire their own
  // dragleave, and a plain boolean flickers off while crossing them.
  const dragDepth = useRef(0);
  const [pending, setPending] = useState(false);
  const [queue, setQueue] = useState<QueuedUpload[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  function uploaderName(id: string | null) {
    // Files uploaded by the customer through the client portal have no
    // staff uploader, so a null here means "the client sent this in".
    if (!id) return "Client (portal)";
    const rep = reps.find((r) => r.id === id);
    return rep?.name || rep?.email || "Unknown";
  }

  const sorted = [...files].sort((a, b) => b.created_at.localeCompare(a.created_at));

  async function uploadFiles(chosen: File[]) {
    if (!chosen.length || pending) return;
    setPending(true);
    setErrors([]);

    const items: QueuedUpload[] = chosen.map((f) => ({
      name: f.name,
      previewUrl: f.type.startsWith("image/") ? URL.createObjectURL(f) : null,
      status: "waiting",
    }));
    setQueue(items);
    const setStatus = (i: number, status: QueuedUpload["status"]) =>
      setQueue((q) => q.map((item, idx) => (idx === i ? { ...item, status } : item)));

    const failed: string[] = [];
    // One at a time, like the visit uploader: on a weak connection six
    // parallel uploads become six failures. One bad file doesn't stop
    // the rest of the batch.
    for (let i = 0; i < chosen.length; i++) {
      const original = chosen[i];
      setStatus(i, "uploading");
      // Same shrink as the visit uploader: a 12MB phone photo becomes a
      // few hundred KB before it ever leaves the device.
      const file = await downscaleImage(original);

      // Straight to storage, not through the server. A file posted to a
      // server action goes through Vercel, which rejects a body over about
      // 4.5MB with a 413 before the action runs -- so the old path could
      // never carry the video and drawing files this panel is for.
      const signed = await createLeadFileUploadUrl(leadId, file.name, file.size);
      if (signed.error || !signed.path || !signed.token) {
        setStatus(i, "failed");
        failed.push(`${original.name}: ${signed.error ?? "could not start that upload"}`);
        continue;
      }

      const storage = createBrowserClient();
      const { error: uploadError } = await storage.storage
        .from("lead-files")
        .uploadToSignedUrl(signed.path, signed.token, file, {
          contentType: file.type || undefined,
        });
      if (uploadError) {
        setStatus(i, "failed");
        // The storage project's own upload ceiling surfaces here, and it is
        // the one limit this app cannot raise for itself.
        failed.push(
          `${original.name}: ` +
            (/exceeded the maximum allowed size/i.test(uploadError.message)
              ? "larger than the storage limit on this project"
              : uploadError.message)
        );
        continue;
      }

      const result = await recordLeadFile(
        leadId,
        signed.path,
        file.name,
        file.size,
        file.type || null
      );
      if (result.error) {
        setStatus(i, "failed");
        failed.push(`${original.name}: ${result.error}`);
        continue;
      }
      setStatus(i, "done");
      // Refresh after each file, so a long batch shows up as it lands.
      onChanged();
    }

    for (const item of items) {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    }
    setQueue([]);
    setPending(false);
    setErrors(failed);
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    void uploadFiles(Array.from(e.target.files ?? []));
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    if (readOnly || pending) return;
    void uploadFiles(Array.from(e.dataTransfer.files ?? []));
  }

  async function handleDelete(file: LeadFile) {
    if (!confirm(`Delete "${file.file_name}"?`)) return;
    await deleteLeadFile(file.id, file.file_path, file.storage_provider);
    onChanged();
  }

  const uploadingAt = queue.findIndex((q) => q.status === "uploading");

  return (
    <div className="second-contact-block">
      <div className="second-contact-head">
        <span>Files</span>
      </div>

      {sorted.length === 0 ? (
        <p className="empty-hint">No files yet.</p>
      ) : (
        <div className="notes-timeline">
          {sorted.map((f) => (
            <div key={f.id} className="notes-timeline-item">
              <div className="notes-timeline-body lead-file-row">
                {attachmentIsImage(f.content_type, f.file_name) && (
                  <a href={f.file_url} target="_blank" rel="noopener noreferrer">
                    {/* Drive-stored files' file_url is the Drive viewer
                        page (HTML, not pixels) -- leadPhotoThumbUrl
                        returns a real image URL for those. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      className="lead-file-thumb"
                      src={leadPhotoThumbUrl(f, 200)}
                      alt={f.file_name}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  </a>
                )}
                <a href={f.file_url} target="_blank" rel="noopener noreferrer">
                  📎 {f.file_name}
                </a>
              </div>
              <div className="notes-timeline-meta">
                <span>{uploaderName(f.uploaded_by)}</span>
                <span>·</span>
                <span>
                  {new Date(f.created_at).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
                {f.file_size != null && <span>· {formatSize(f.file_size)}</span>}
                {!readOnly && (
                  <button
                    type="button"
                    className="icon-btn notes-timeline-delete"
                    onClick={() => handleDelete(f)}
                    aria-label="Delete file"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!readOnly && (
        <div style={{ marginTop: 10 }}>
          <input
            ref={inputRef}
            type="file"
            multiple
            onChange={handleFileChange}
            style={{ display: "none" }}
          />
          {errors.map((msg) => (
            <p key={msg} className="error-note">
              {msg}
            </p>
          ))}
          <div
            className={`file-dropzone${dragOver ? " drag-over" : ""}`}
            role="button"
            tabIndex={0}
            aria-label="Add files"
            onClick={() => !pending && inputRef.current?.click()}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && !pending) {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              dragDepth.current += 1;
              setDragOver(true);
            }}
            onDragLeave={() => {
              dragDepth.current -= 1;
              if (dragDepth.current <= 0) {
                dragDepth.current = 0;
                setDragOver(false);
              }
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            {pending
              ? `Uploading ${(uploadingAt >= 0 ? uploadingAt : queue.length - 1) + 1} of ${queue.length}…`
              : dragOver
                ? "Drop to upload"
                : "+ Add Files — click to browse or drag & drop"}
            {queue.length > 0 && (
              <div className="upload-queue">
                {queue.map((item, i) => (
                  <div
                    key={`${item.name}-${i}`}
                    className={`upload-queue-item ${item.status}`}
                    title={item.name}
                  >
                    {item.previewUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={item.previewUrl} alt={item.name} />
                    ) : (
                      <span className="upload-queue-doc">📄</span>
                    )}
                    <span className="upload-queue-state">
                      {item.status === "done" ? "✓" : item.status === "failed" ? "✕" : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

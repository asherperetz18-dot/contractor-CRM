"use client";

import { useCallback } from "react";
import type { LeadFile, Profile } from "@/lib/data/types";
import { attachmentIsImage, leadPhotoThumbUrl } from "@/lib/data/types";
import { deleteLeadFile } from "@/lib/actions/lead-files";
import { uploadLeadFileDirect } from "@/lib/uploads/lead-file-upload";
import { FileDropzone, useUploadQueue } from "@/components/uploads/file-drop";

function formatSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
  const uploadOne = useCallback(
    async (file: File) => {
      const res = await uploadLeadFileDirect(leadId, file);
      // Refresh after each file, so a long batch shows up as it lands.
      if (!res.error) onChanged();
      return res.error ?? null;
    },
    [leadId, onChanged]
  );
  const { queue, pending, errors, progressLabel, start } = useUploadQueue(uploadOne);

  function uploaderName(id: string | null) {
    // Files uploaded by the customer through the client portal have no
    // staff uploader, so a null here means "the client sent this in".
    if (!id) return "Client (portal)";
    const rep = reps.find((r) => r.id === id);
    return rep?.name || rep?.email || "Unknown";
  }

  const sorted = [...files].sort((a, b) => b.created_at.localeCompare(a.created_at));

  async function handleDelete(file: LeadFile) {
    if (!confirm(`Delete "${file.file_name}"?`)) return;
    await deleteLeadFile(file.id, file.file_path, file.storage_provider);
    onChanged();
  }

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
          {errors.map((msg) => (
            <p key={msg} className="error-note">
              {msg}
            </p>
          ))}
          <FileDropzone
            onFiles={(f) => void start(f)}
            disabled={pending}
            queue={queue}
            progressLabel={progressLabel}
          />
        </div>
      )}
    </div>
  );
}

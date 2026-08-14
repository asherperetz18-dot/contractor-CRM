"use client";

import { useRef, useState } from "react";
import type { LeadFile, Profile } from "@/lib/data/types";
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  function uploaderName(id: string | null) {
    // Files uploaded by the customer through the client portal have no
    // staff uploader, so a null here means "the client sent this in".
    if (!id) return "Client (portal)";
    const rep = reps.find((r) => r.id === id);
    return rep?.name || rep?.email || "Unknown";
  }

  const sorted = [...files].sort((a, b) => b.created_at.localeCompare(a.created_at));

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = e.target.files?.[0];
    if (!chosen) return;
    setPending(true);
    setError("");
    // Same shrink as the visit uploader: a 12MB phone photo becomes a
    // few hundred KB before it ever leaves the device.
    const file = await downscaleImage(chosen);

    // Straight to storage, not through the server. A file posted to a
    // server action goes through Vercel, which rejects a body over about
    // 4.5MB with a 413 before the action runs -- so the old path could
    // never carry the video and drawing files this panel is for.
    const signed = await createLeadFileUploadUrl(leadId, file.name, file.size);
    if (signed.error || !signed.path || !signed.token) {
      setPending(false);
      if (inputRef.current) inputRef.current.value = "";
      setError(signed.error ?? "Could not start that upload.");
      return;
    }

    const storage = createBrowserClient();
    const { error: uploadError } = await storage.storage
      .from("lead-files")
      .uploadToSignedUrl(signed.path, signed.token, file, {
        contentType: file.type || undefined,
      });
    if (uploadError) {
      setPending(false);
      if (inputRef.current) inputRef.current.value = "";
      // The storage project's own upload ceiling surfaces here, and it is
      // the one limit this app cannot raise for itself.
      setError(
        /exceeded the maximum allowed size/i.test(uploadError.message)
          ? "That file is larger than the storage limit on this project."
          : uploadError.message
      );
      return;
    }

    const result = await recordLeadFile(
      leadId,
      signed.path,
      file.name,
      file.size,
      file.type || null
    );
    setPending(false);
    if (inputRef.current) inputRef.current.value = "";
    if (result.error) {
      setError(result.error);
      return;
    }
    onChanged();
  }

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
              <div className="notes-timeline-body">
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
            onChange={handleFileChange}
            style={{ display: "none" }}
          />
          {error && <p className="error-note">{error}</p>}
          <button
            type="button"
            className="btn-ghost small"
            onClick={() => inputRef.current?.click()}
            disabled={pending}
          >
            {pending ? "Uploading…" : "+ Add File"}
          </button>
        </div>
      )}
    </div>
  );
}

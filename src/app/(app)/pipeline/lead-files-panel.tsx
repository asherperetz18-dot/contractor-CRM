"use client";

import { useRef, useState } from "react";
import type { LeadFile, Profile } from "@/lib/data/types";
import { deleteLeadFile, uploadLeadFile } from "@/lib/actions/lead-files";

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
    if (!id) return "Unknown";
    const rep = reps.find((r) => r.id === id);
    return rep?.name || rep?.email || "Unknown";
  }

  const sorted = [...files].sort((a, b) => b.created_at.localeCompare(a.created_at));

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPending(true);
    setError("");
    const formData = new FormData();
    formData.append("file", file);
    const result = await uploadLeadFile(leadId, formData);
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
    await deleteLeadFile(file.id, file.file_path);
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

"use client";

import { useCallback, useRef, useState } from "react";

/**
 * The one way files enter this app.
 *
 * Every upload surface -- lead files, visit photos, job photos, estimate
 * attachments, the client portal, receipts, scans, the logo -- offers the
 * same three things: pick several at once where several make sense, drag
 * & drop from the desktop, and see what is being uploaded while it
 * happens. This module is that behavior, written once:
 *
 * - useUploadQueue: the sequential upload loop with per-file previews
 *   and statuses. One at a time on purpose -- these run on phones on
 *   site cellular, and six parallel uploads on a bad signal is how you
 *   get six failures. One bad file never stops the rest of the batch.
 * - useFileDrop: drag & drop handlers for wrapping an existing button,
 *   row, or modal without changing its layout.
 * - FileDropzone: the visible click-or-drop target with the in-flight
 *   preview strip, for panels whose whole job is receiving files.
 */

/** One file moving through the upload loop, for the preview strip. */
export type QueuedUpload = {
  name: string;
  /** Object URL for a local image preview; null for non-images. */
  previewUrl: string | null;
  status: "waiting" | "uploading" | "done" | "failed";
};

export function useUploadQueue(
  /** Uploads one file; resolves to an error message, or null on success. */
  uploadOne: (file: File) => Promise<string | null>
) {
  const [queue, setQueue] = useState<QueuedUpload[]>([]);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const start = useCallback(
    async (chosen: File[]) => {
      if (!chosen.length) return;
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
      for (let i = 0; i < chosen.length; i++) {
        setStatus(i, "uploading");
        let message: string | null;
        try {
          message = await uploadOne(chosen[i]);
        } catch {
          message = "didn't upload — check your connection and try again";
        }
        if (message) {
          setStatus(i, "failed");
          failed.push(`${chosen[i].name}: ${message}`);
        } else {
          setStatus(i, "done");
        }
      }

      for (const item of items) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
      setQueue([]);
      setPending(false);
      setErrors(failed);
    },
    [uploadOne]
  );

  const uploadingAt = queue.findIndex((q) => q.status === "uploading");
  const progressLabel = pending
    ? `Uploading ${(uploadingAt >= 0 ? uploadingAt : queue.length - 1) + 1} of ${queue.length}…`
    : null;

  return { queue, pending, errors, progressLabel, start };
}

/**
 * Drag & drop for any element. Spread `dropProps` onto it and add a
 * highlight class while `dragOver` is true.
 */
export function useFileDrop(onFiles: (files: File[]) => void, disabled?: boolean) {
  // Counts enter/leave pairs: children fire their own dragleave, and a
  // plain boolean flickers off while the cursor crosses them.
  const depth = useRef(0);
  const [dragOver, setDragOver] = useState(false);

  const dropProps = {
    onDragEnter: (e: React.DragEvent) => {
      e.preventDefault();
      depth.current += 1;
      if (!disabled) setDragOver(true);
    },
    onDragLeave: () => {
      depth.current -= 1;
      if (depth.current <= 0) {
        depth.current = 0;
        setDragOver(false);
      }
    },
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      depth.current = 0;
      setDragOver(false);
      if (disabled) return;
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length) onFiles(files);
    },
  };

  return { dragOver, dropProps };
}

/** The preview strip shown while a batch uploads. */
export function UploadQueueStrip({ queue }: { queue: QueuedUpload[] }) {
  if (!queue.length) return null;
  return (
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
  );
}

/**
 * The visible click-or-drop upload target, with the preview strip
 * rendered inside it while a batch is going up.
 */
export function FileDropzone({
  onFiles,
  label = "+ Add Files — click to browse or drag & drop",
  accept,
  multiple = true,
  disabled,
  queue = [],
  progressLabel,
  className,
}: {
  onFiles: (files: File[]) => void;
  label?: string;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  queue?: QueuedUpload[];
  /** When set the zone shows it and stops accepting input. */
  progressLabel?: string | null;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const busy = disabled || !!progressLabel;
  const { dragOver, dropProps } = useFileDrop(onFiles, busy);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        style={{ display: "none" }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
      <div
        className={`file-dropzone${dragOver ? " drag-over" : ""}${className ? ` ${className}` : ""}`}
        role="button"
        tabIndex={0}
        aria-label={label}
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !busy) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        {...dropProps}
      >
        {progressLabel ?? (dragOver ? "Drop to upload" : label)}
        <UploadQueueStrip queue={queue} />
      </div>
    </>
  );
}

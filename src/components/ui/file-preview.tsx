"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { fullPreview, peekSrc, type PreviewFile } from "@/lib/files/preview";
import { lockBodyScroll, unlockBodyScroll } from "@/components/ui/modal";
import "./file-preview.css";

/**
 * The one way a stored file renders anywhere in the CRM: hovering
 * shows a peek of the file itself, a click opens the full-screen
 * preview in place. Nobody loses their page to a new tab just to see
 * whether "contract (1).pdf" is the signed copy or the draft.
 *
 * A modified click (ctrl/cmd/shift/middle) keeps the browser's own
 * open-in-new-tab, and the overlay offers it too — the escape hatch
 * for the file types nothing can draw. Touch screens have no hover
 * and tap straight into the full preview.
 */
export function FilePreview({
  file,
  block,
  children,
}: {
  file: PreviewFile;
  /** Grid tiles need a block wrapper so width:100% thumbs fill the cell. */
  block?: boolean;
  children: React.ReactNode;
}) {
  // Where to pin the peek, in viewport coordinates. Position: fixed
  // rather than absolute-in-place, because these triggers live inside
  // scroll containers and anything absolutely positioned in there gets
  // clipped at the edge -- rendered, loaded, invisible.
  const [peek, setPeek] = useState<{ x: number; y: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const src = peekSrc(file);

  return (
    <span
      className={"receipt-peek-wrap" + (block ? " file-preview-block" : "")}
      onMouseEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setPeek({ x: r.left, y: r.top });
      }}
      onMouseLeave={() => setPeek(null)}
    >
      <a
        href={file.url}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => {
          if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          setPeek(null);
          setOpen(true);
        }}
      >
        {children}
      </a>
      {peek && !open && (
        <span
          className="receipt-peek"
          style={{ left: Math.min(peek.x, window.innerWidth - 270), top: peek.y - 8 }}
        >
          {src && !failed ? (
            // Mounted only while hovered, so a page of files does not
            // fetch a thumbnail per row on load.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              referrerPolicy="no-referrer"
              src={src}
              alt="File preview"
              onError={() => setFailed(true)}
            />
          ) : (
            <span className="receipt-peek-fallback">Click to preview</span>
          )}
        </span>
      )}
      {open && <FileLightbox file={file} onClose={() => setOpen(false)} />}
    </span>
  );
}

/**
 * The full-screen preview. A portal, because the trigger sits inside
 * overflow-hidden rows and modals; the overlay must own the viewport.
 */
function FileLightbox({ file, onClose }: { file: PreviewFile; onClose: () => void }) {
  const plan = fullPreview(file);

  useEffect(() => {
    lockBodyScroll();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      unlockBodyScroll();
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const name = file.name || "File preview";

  return createPortal(
    <div className="file-lightbox" role="dialog" aria-modal="true" aria-label={name} onClick={onClose}>
      <div className="file-lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <span className="file-lightbox-name" title={name}>
          {name}
        </span>
        <a className="btn-ghost small" href={file.url} target="_blank" rel="noreferrer">
          Open in new tab ↗
        </a>
        <button type="button" className="icon-btn" aria-label="Close preview" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="file-lightbox-body">
        {plan.mode === "image" && (
          // External Drive/storage URLs, sizes unknown at build time.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={plan.src}
            alt={name}
            referrerPolicy="no-referrer"
            onClick={(e) => e.stopPropagation()}
          />
        )}
        {plan.mode === "frame" && (
          <iframe src={plan.src} title={name} allow="autoplay" onClick={(e) => e.stopPropagation()} />
        )}
        {plan.mode === "video" && (
          <video src={plan.src} controls onClick={(e) => e.stopPropagation()} />
        )}
        {plan.mode === "none" && (
          <div className="file-lightbox-fallback" onClick={(e) => e.stopPropagation()}>
            <p>This file type has no preview.</p>
            <a className="btn-primary small" href={file.url} target="_blank" rel="noreferrer">
              Open it in a new tab ↗
            </a>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

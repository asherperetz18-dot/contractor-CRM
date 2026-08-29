"use client";

import { useState } from "react";

/**
 * Where a receipt's preview image lives, given where the file went.
 *
 * Drive files (receipt_path "drive:<id>") get Drive's thumbnail
 * endpoint -- it renders images AND the first page of a PDF, and the
 * upload already granted anyone-with-link access. Bucket images serve
 * their own public URL. A bucket PDF has no thumbnail anywhere, so it
 * gets the placeholder card instead.
 */
function previewSrc(url: string, path: string | null): string | null {
  if (path?.startsWith("drive:")) {
    return `https://drive.google.com/thumbnail?id=${encodeURIComponent(path.slice("drive:".length))}&sz=w400`;
  }
  if ((path ?? url).toLowerCase().endsWith(".pdf")) return null;
  return url;
}

/**
 * The 📎 Receipt link, with a peek: hovering shows the receipt itself
 * before anyone commits to opening the full file in a new tab. Touch
 * screens have no hover and simply tap straight through, as before.
 */
export function ReceiptPeek({ url, path }: { url: string; path: string | null }) {
  // Where to pin the preview, in viewport coordinates. Position: fixed
  // rather than absolute-in-place, because these links live inside the
  // cost table's scroll container and anything absolutely positioned in
  // there gets clipped at the table edge -- rendered, loaded, invisible.
  const [peek, setPeek] = useState<{ x: number; y: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const src = previewSrc(url, path);

  return (
    <span
      className="receipt-peek-wrap"
      onMouseEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setPeek({ x: r.left, y: r.top });
      }}
      onMouseLeave={() => setPeek(null)}
    >
      <a href={url} target="_blank" rel="noreferrer">
        📎 Receipt
      </a>
      {peek && (
        <span
          className="receipt-peek"
          style={{ left: Math.min(peek.x, window.innerWidth - 270), top: peek.y - 8 }}
        >
          {src && !failed ? (
            // Mounted only while hovered, so a page of receipts does not
            // fetch a thumbnail per row on load.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt="Receipt preview"
              onError={() => setFailed(true)}
            />
          ) : (
            <span className="receipt-peek-fallback">
              {failed ? "No preview — click to open" : "PDF — click to open"}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

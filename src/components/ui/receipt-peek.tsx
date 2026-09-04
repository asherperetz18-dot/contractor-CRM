"use client";

import { useState } from "react";
import "./receipt-thumb.css";

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
 * A link with a peek: hovering shows the file itself before anyone
 * commits to opening it in a new tab. Touch screens have no hover and
 * simply tap straight through. Shared by the receipt links and the
 * per-job document lists.
 */
export function PeekLink({
  url,
  src,
  children,
}: {
  url: string;
  /** The preview image, or null for the "click to open" card. */
  src: string | null;
  children: React.ReactNode;
}) {
  // Where to pin the preview, in viewport coordinates. Position: fixed
  // rather than absolute-in-place, because these links live inside
  // scroll containers and anything absolutely positioned in there gets
  // clipped at the edge -- rendered, loaded, invisible.
  const [peek, setPeek] = useState<{ x: number; y: number } | null>(null);
  const [failed, setFailed] = useState(false);

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
        {children}
      </a>
      {peek && (
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
            <span className="receipt-peek-fallback">
              {failed ? "No preview — click to open" : "PDF — click to open"}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

/** The 📎 Receipt link with its peek, exactly as before. */
export function ReceiptPeek({ url, path }: { url: string; path: string | null }) {
  return (
    <PeekLink url={url} src={previewSrc(url, path)}>
      📎 Receipt
    </PeekLink>
  );
}

/**
 * The receipt itself, small and always visible: a thumbnail of the photo
 * (or the first page of a Drive PDF) that opens the file on click and
 * shows the big peek on hover. A bucket PDF has no image anywhere, so it
 * gets a little "PDF" tile that still opens the file.
 *
 * Same on every screen that lists money going out -- Bills to Pay, the
 * job's bill list, Job costs -- so a bill looks like the same bill
 * wherever it is met.
 */
export function ReceiptThumb({
  url,
  path,
  size = 44,
}: {
  url: string;
  path: string | null;
  size?: number;
}) {
  const src = previewSrc(url, path);
  const [failed, setFailed] = useState(false);
  return (
    <PeekLink url={url} src={src}>
      <span className="receipt-thumb" style={{ width: size, height: size }} title="Open the receipt">
        {src && !failed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            referrerPolicy="no-referrer"
            src={src}
            alt="Receipt"
            loading="lazy"
            onError={() => setFailed(true)}
          />
        ) : (
          <span className="receipt-thumb-pdf">PDF</span>
        )}
      </span>
    </PeekLink>
  );
}

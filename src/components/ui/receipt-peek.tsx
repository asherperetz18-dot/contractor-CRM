"use client";

import { useState } from "react";
import { FilePreview } from "./file-preview";
import { peekSrc, receiptDriveId, type PreviewFile } from "@/lib/files/preview";
import "./receipt-thumb.css";

/**
 * A receipt as the shared preview understands it. Receipts store no
 * file name or content type — the URL's extension carries the kind,
 * and a "drive:<id>" path carries the Drive id (that upload already
 * granted anyone-with-link access).
 */
function receiptFile(url: string, path: string | null): PreviewFile {
  return { url, name: "Receipt", driveId: receiptDriveId(path) };
}

/**
 * The receipt itself, small and always visible: a thumbnail of the photo
 * (or the first page of a Drive PDF) that shows the big peek on hover
 * and opens the full-screen preview on click. A bucket PDF has no image
 * anywhere, so it gets a little "PDF" tile that still previews the file.
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
  const file = receiptFile(url, path);
  const src = peekSrc(file);
  const [failed, setFailed] = useState(false);
  return (
    <FilePreview file={file}>
      <span className="receipt-thumb" style={{ width: size, height: size }} title="Preview the receipt">
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
    </FilePreview>
  );
}

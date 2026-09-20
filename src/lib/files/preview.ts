/**
 * What a hover can show and what a click can open, for any stored file.
 *
 * One place decides, because the answer depends on two things every
 * surface used to re-derive on its own: what the file IS (a browser's
 * content_type claim, backstopped by the extension), and WHERE it lives
 * (a Drive file's file_url is the Drive viewer page -- HTML, not
 * pixels -- while a bucket file serves itself). Getting either wrong
 * shows a broken image or a refused frame.
 */

export type PreviewKind = "image" | "video" | "pdf" | "other";

export type PreviewFile = {
  /** The stored file_url / receipt_url — always the "open it" link. */
  url: string;
  name?: string | null;
  contentType?: string | null;
  /** Drive file id when the file graduated to Google Drive. */
  driveId?: string | null;
};

/**
 * The content type wins when it says something usable; the extension
 * backstops it because content_type is whatever the browser claimed at
 * upload, and some send application/octet-stream for a perfectly
 * ordinary PDF. Receipts store no file name at all, so callers may pass
 * the URL as the name — the regexes only look at how the string ends.
 */
export function previewKind(
  contentType: string | null | undefined,
  fileName?: string | null
): PreviewKind {
  if (contentType && /^image\//i.test(contentType)) return "image";
  if (contentType && /^video\//i.test(contentType)) return "video";
  if (contentType && /^application\/pdf$/i.test(contentType)) return "pdf";
  const name = fileName ?? "";
  if (/\.(jpe?g|png|webp|gif|heic|heif)$/i.test(name)) return "image";
  if (/\.(mp4|mov|webm|m4v)$/i.test(name)) return "video";
  if (/\.pdf$/i.test(name)) return "pdf";
  return "other";
}

/** Drive id from the lead-file shape (storage_provider + file_path). */
export function driveFileId(file: {
  storage_provider?: string | null;
  file_path?: string | null;
}): string | null {
  if (file.storage_provider === "google_drive" && file.file_path) return file.file_path;
  return null;
}

/** Drive id from the receipt shape (receipt_path = "drive:<id>"). */
export function receiptDriveId(path: string | null | undefined): string | null {
  if (path?.startsWith("drive:")) return path.slice("drive:".length);
  return null;
}

/**
 * Content type, then the name's extension, then the URL's. Receipts
 * carry a display label with no extension ("Receipt") while their
 * upload path kept the original file name — the URL must get its say.
 */
function kindOf(f: PreviewFile): PreviewKind {
  const byName = previewKind(f.contentType, f.name);
  if (byName !== "other") return byName;
  return previewKind(null, f.url);
}

/**
 * The hover peek image, or null for the "click to preview" card.
 * Drive's thumbnail endpoint renders images AND the first page of a
 * PDF; a bucket image is its own preview; a bucket PDF has no
 * thumbnail anywhere.
 */
export function peekSrc(f: PreviewFile): string | null {
  if (f.driveId) {
    return `https://drive.google.com/thumbnail?id=${encodeURIComponent(f.driveId)}&sz=w400`;
  }
  if (kindOf(f) === "image") return f.url;
  return null;
}

export type FullPreview =
  | { mode: "image"; src: string }
  | { mode: "frame"; src: string }
  | { mode: "video"; src: string }
  | { mode: "none"; src: null };

/**
 * What the full-screen preview shows. A Drive file frames the
 * embeddable viewer (…/file/d/<id>/preview — the plain viewer page
 * refuses to be framed); a bucket image draws itself, a bucket PDF
 * frames the browser's own PDF viewer, a bucket video plays. A type
 * nothing can draw gets "none" so the overlay offers the new-tab link
 * instead of a broken frame.
 */
export function fullPreview(f: PreviewFile): FullPreview {
  if (f.driveId) {
    return { mode: "frame", src: `https://drive.google.com/file/d/${encodeURIComponent(f.driveId)}/preview` };
  }
  if (!f.url) return { mode: "none", src: null };
  const kind = kindOf(f);
  if (kind === "image") return { mode: "image", src: f.url };
  if (kind === "pdf") return { mode: "frame", src: f.url };
  if (kind === "video") return { mode: "video", src: f.url };
  return { mode: "none", src: null };
}

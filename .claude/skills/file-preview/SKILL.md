---
name: file-preview
description: File and image preview — standing rule (always, automatic). Use whenever adding or touching ANY surface that renders a stored file — a photo thumbnail, a document link, a receipt, an attachment tile — anywhere in the CRM UI. Hover shows a peek of the file itself, click opens the full-screen preview in place; never a bare <a target="_blank"> or a dead thumbnail again.
---

# Every stored file previews: hover to peek, click for the full view

The owner's rule (2026-09-20, estimate attachments): nobody should lose
their page to a new tab — or get nothing at all — just to see whether
"contract (1).pdf" is the signed copy or the draft. Every rendering of
a stored file, on every screen, behaves the same way.

## The one component

Wrap the thumbnail, tile, or file-name link in `FilePreview`
(`src/components/ui/file-preview.tsx`):

```tsx
<FilePreview
  file={{
    url: f.file_url,               // always the stored "open it" link
    name: f.file_name,
    contentType: f.content_type,
    driveId: driveFileId(f),       // lead-file shape; receipts: receiptDriveId(path)
  }}
>
  <img … /> or 📎 {f.file_name}
</FilePreview>
```

- **Hover** shows the peek bubble: the image itself, a Drive file's
  thumbnail (which covers page one of a PDF), or a "Click to preview"
  card when nothing can be drawn. Touch screens have no hover and tap
  straight into the full preview.
- **Click** opens the full-screen lightbox: images draw themselves,
  PDFs frame the browser's viewer, Drive files frame
  `drive.google.com/file/d/<id>/preview` (the raw `file_url` is the
  viewer PAGE — HTML that refuses framing), videos play. Esc, the
  backdrop, and ✕ close it.
- **A modified click** (ctrl/cmd/shift/middle) still opens the new tab,
  and the lightbox offers "Open in new tab ↗" — the escape hatch stays.
- Pass `block` on grid tiles (photo grids), so `width: 100%` thumbs
  keep filling their cell; leave it off inline name-links.
- What-it-is and where-it-lives logic lives in `src/lib/files/preview.ts`
  (`previewKind`, `peekSrc`, `fullPreview`, tested) — never re-derive
  content-type sniffing or Drive URL shapes in a component.
- Receipts keep `ReceiptThumb` (`src/components/ui/receipt-peek.tsx`),
  which is already built on `FilePreview`.

## Exemptions — on purpose, not oversights

- **The customer's document** (`src/components/estimate-document.tsx`)
  and the **client portal**: customer-facing paper keeps plain links —
  the lightbox is a staff tool, and the document also renders to print.
- **Picked-but-not-yet-saved files** (object-URL previews in upload
  forms and `UploadQueueStrip`): nothing is stored yet; they keep their
  local thumbnails.
- **A tile whose click already has a more important job** (the estimate
  photo PICKER, where click attaches) keeps that job — don't steal its
  click for a preview.
- **CSV/spreadsheet imports** are data, not pictures.

## If a new source of files appears

A new storage location (today: Supabase bucket = serves itself, Google
Drive = thumbnail endpoint + `/preview` embed) gets its rules added to
`src/lib/files/preview.ts` with tests FIRST, and the report-only CSP
(`src/lib/security-headers.ts`: `img-src`, `frame-src`, `media-src`)
must name its origins or every preview logs a violation.

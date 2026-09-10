<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# File uploads — standing rule (always, automatic)

Every upload surface in this app uses `src/components/uploads/file-drop.tsx`.
Never write a bare `<input type="file">` flow again. Any new or touched
upload UI must offer, without being asked:

- **Multi-select** (`multiple`) wherever more than one file makes sense
  (photos, documents). Single-by-nature pickers (a logo, one receipt,
  one scan) stay single but still get the rest.
- **Drag & drop** — `FileDropzone` for a visible drop target, or
  `useFileDrop` to make an existing button/row/panel accept drops
  (highlight with `panel-drop` + `drag-over`, or `drop-target-over`).
- **Previews** — `useUploadQueue` + `UploadQueueStrip` show each file's
  thumbnail and per-file ✓/✕ while a batch uploads; picked-but-not-yet-
  saved single files show an object-URL thumbnail (`lead-file-thumb`).
- Uploads run **one at a time** (site cellular), and one failed file
  never stops the rest of the batch.
- Lead files go through `uploadLeadFileDirect` in
  `src/lib/uploads/lead-file-upload.ts` (downscale → signed URL →
  storage → record), never through a server action body.

CSV/spreadsheet imports are data, not pictures — they are exempt.

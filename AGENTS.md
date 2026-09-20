<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

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

# People dropdowns — standing rule (always, automatic)

Never render the raw roster into a `<select>` of people again. Every
dropdown that offers people narrows through `repDropdownOptions`
(`src/lib/data/rep-options.ts`), alphabetical by the name the option
shows. Any new or touched people dropdown gets this without being asked:

- **Assignment fields** (Assigned To, Second Assigned To, Assigned Rep,
  salesperson seats, Closer, task assignee, booking pickers): active
  **Sales-role** members only, passing the field's current value as
  `keep` — a stored assignee must never vanish from its own select, or
  it renders blank and saves as data lost.
- **Rep filters** (schedule, calendar, appointment/call reports,
  pipeline board, commission statement): the same list **plus the ids
  present in the rows being filtered** and the current tick — someone
  with rows must stay reachable, and a tick must stay visible to be
  undone (same idea as `repOptionIds` on the estimates funnel).
- **Role-specific pickers keep their own role** — Dispatcher stays
  Dispatch (`getDispatchers`), production job assignees stay crew. The
  rule is "only the people relevant to the field", not literally Sales
  everywhere.
- Name lookups (`repById`, `repName`) keep reading the **whole** roster
  — narrowing those turns historical assignees into "Unnamed".

# Settings pages — standing rule (always, automatic)

Every page under `/settings/` shows the "⚙ Settings › Page" crumb back
to the Settings grid. It is rendered once by
`src/app/(app)/settings/layout.tsx` (`SettingsBreadcrumb`), never by
the page — never hand-write a `ur-breadcrumb` block in a settings page
again, or it shows twice. The page's name in the crumb is the title of
its tile in `src/lib/data/settings-catalog.ts`, so a new settings page
needs a tile there carrying its `href`; `src/lib/settings-crumb.test.ts`
fails when a page has none. Before finishing any settings work, check
every page under `/settings/` still has its way back.

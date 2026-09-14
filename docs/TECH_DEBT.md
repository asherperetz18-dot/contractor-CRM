# Tech debt

Known shortcuts, deferred work, and things left deliberately unfinished — logged so they're a choice, not a surprise. Format: what/why/impact/where. Remove an entry once it's actually fixed rather than leaving it marked done.

---

**Cobrowse batches ship as uncompressed JSON.**
What: rrweb event batches cross Supabase Realtime as plain JSON chunks (`src/lib/cobrowse/wire.ts`); a full snapshot of a heavy page can be a couple dozen 50KB parts. Why: `CompressionStream` would cut that ~5-8x but adds async plumbing and a base64 step, and the first version favored a wire simple enough to unit-test exactly. Impact: none on wifi/LTE; on very weak site cellular the first snapshot may take a few seconds to land. Where: `src/lib/cobrowse/wire.ts`, `src/lib/cobrowse/recorder.ts`.

**A hard page reload ends a cobrowse share.**
What: the rrweb recorder lives in the (app) layout's React tree, so client-side navigation survives a share, but a full reload (or the browser killing the tab) drops the session without a goodbye; the stale row ages out via the existing 4-hour abandoned-share cutoff and the viewer sees a frozen mirror until they leave. Why: same lifetime the WebRTC share already has (`beforeunload` teardown is best-effort); persisting a session across reloads means rejoin tokens in storage for a rare case. Impact: rare, self-healing, viewer inconvenience only. Where: `src/app/(app)/screen-share.tsx`.

**During a deploy, an old client can join a cobrowse session it can't render.**
What: clients built before `kind` existed treat every share row as WebRTC and send a `viewer-hello` expecting an SDP offer; against a cobrowse sharer they wait on a picture that never comes (and occupy the one viewer slot until they leave). Why: transient deployment skew only — the update popup already nudges stale tabs onto the new build. Impact: minutes-long window per deploy, worst case one confused viewer. Where: resolves itself; remove this entry once the cobrowse release is deployed.

**A CSV import chunk whose response is lost may be re-sent on Resume.**
What: the import uploads 2,000-row chunks and advances its resume cursor only after a chunk's response arrives; if the connection drops after the server inserted a chunk but before the browser heard back, Resume sends that chunk again and duplicates up to 2,000 rows. Why: true exactly-once would need an idempotency key per chunk and a server-side ledger — real plumbing for a narrow window that only opens on a mid-request connection loss. Impact: rare; visible immediately (contact count runs ~2,000 high) and recoverable by deleting the doubled rows or re-running the duplicate check on a fresh import. Where: `src/app/(app)/pipeline/csv-import-panel.tsx` (`runImport`), `src/lib/actions/leads.ts` (`bulkImportLeads`).

**Inbound SMS and the dial queue don't read phone2/phone3.**
What: migration 0150 gave a contact up to three phone numbers, and the caller matcher (`phone-match.ts`, `create_lead_for_unknown_caller`) matches on all of them — but the inbound SMS webhook and outbound-text client-number checks (`src/app/api/sms/webhook/route.ts`, `src/lib/actions/sms.ts`) still match only `phone`/`second_contact_phone`, and the dial queue (`src/app/(app)/dial-queue/dial-queue-view.tsx`) dials/searches only the primary `phone`. Why: kept the phone2/phone3 change to storage, card, import and call matching; texting a cold-list number back is not the current workflow. Impact: a text from a contact's phone2/phone3 threads under the number alone instead of the contact; the dial queue won't fall through to their other numbers. Where: the three files above.

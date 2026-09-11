# Tech debt

Known shortcuts, deferred work, and things left deliberately unfinished — logged so they're a choice, not a surprise. Format: what/why/impact/where. Remove an entry once it's actually fixed rather than leaving it marked done.

---

**Cobrowse batches ship as uncompressed JSON.**
What: rrweb event batches cross Supabase Realtime as plain JSON chunks (`src/lib/cobrowse/wire.ts`); a full snapshot of a heavy page can be a couple dozen 50KB parts. Why: `CompressionStream` would cut that ~5-8x but adds async plumbing and a base64 step, and the first version favored a wire simple enough to unit-test exactly. Impact: none on wifi/LTE; on very weak site cellular the first snapshot may take a few seconds to land. Where: `src/lib/cobrowse/wire.ts`, `src/lib/cobrowse/recorder.ts`.

**A hard page reload ends a cobrowse share.**
What: the rrweb recorder lives in the (app) layout's React tree, so client-side navigation survives a share, but a full reload (or the browser killing the tab) drops the session without a goodbye; the stale row ages out via the existing 4-hour abandoned-share cutoff and the viewer sees a frozen mirror until they leave. Why: same lifetime the WebRTC share already has (`beforeunload` teardown is best-effort); persisting a session across reloads means rejoin tokens in storage for a rare case. Impact: rare, self-healing, viewer inconvenience only. Where: `src/app/(app)/screen-share.tsx`.

**During a deploy, an old client can join a cobrowse session it can't render.**
What: clients built before `kind` existed treat every share row as WebRTC and send a `viewer-hello` expecting an SDP offer; against a cobrowse sharer they wait on a picture that never comes (and occupy the one viewer slot until they leave). Why: transient deployment skew only — the update popup already nudges stale tabs onto the new build. Impact: minutes-long window per deploy, worst case one confused viewer. Where: resolves itself; remove this entry once the cobrowse release is deployed.

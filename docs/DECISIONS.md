# Decisions

Why a non-obvious design/architecture call was made — so it doesn't get re-litigated or accidentally reverted later. Newest at the bottom. Format: Context → Decision → Consequence.

The first entries below were logged retroactively on 2026-09-09 while setting up this file, reconstructed from commit messages and in-code comments that already explained their own reasoning. Going forward, log a decision when you make it, not after.

---

## 001 — Owed-to-you tracked per phase, not per invoice
**Date:** 2026-09-08 (commit `604732a`)

**Context:** "Owed to you" on a project could show a deposit as if it paid down whichever invoice existed, which is wrong once a contract has multiple billing phases — a deposit belongs to the contract, not to one phase's invoice.

**Decision:** Compute what's owed per phase (`phaseReceivableCents` et al. in `src/lib/data/types.ts`), so a deposit is attributed correctly and never silently pays down an unrelated phase's invoice.

**Consequence:** Any future receivable/owed-money calculation must reason per-phase, not by netting a single running total against payments. See `src/lib/data/project-receivable.test.ts` for the guarding tests.

---

## 002 — `selectAll` for any table a company can grow past 1,000 rows
**Context:** A bare Supabase `.select()` stops at 1,000 rows with no error — it just silently returns a partial result. On the Schedule/Calendar pages this meant the newest appointments could quietly vanish once a company's event history passed that mark, with nothing in the UI or logs indicating data was missing.

**Decision:** Wrap any query against a table that can plausibly exceed 1,000 rows in `selectAll()` (`src/lib/data/select-all.ts`), which pages through with `.range()`.

**Consequence:** When adding a new "list everything for this company" query against `events`, `leads`, or similarly unbounded tables, use `selectAll` by default rather than a bare `.select()`. A missing wrapper here is a real, previously-hit bug class, not a hypothetical one — see `docs/TECH_DEBT.md` if you find one.

---

## 003 — Calendar/Schedule fetch only leads with an event, not the whole company
**Context:** The calendar page was loading every lead in the company to render a week of appointments — at 3,573 contacts that was 833kB of response for 72 contacts that actually had an appointment, and was the reason the calendar took seconds to appear while the server itself answered in well under half a second.

**Decision:** Use an inner join on `events` (`leads.select("*, events!inner(id)")`) as a filter rather than fetching everything and filtering client-side, or building an id list (which could outgrow a request URL as history grows). The joined `events` key is dropped before the data reaches any consumer — it's a filter, not data anyone reads.

**Consequence:** When a page only needs "leads that have X," prefer an inner join as the filter over fetch-everything-then-filter. Watch for the same shape of bug (fetching a whole tenant's data for a UI that only needs a small related slice) elsewhere as the CRM grows.

---

## 004 — Dispatcher commission and sales-rep commission are separate pages, never combined
**Context:** They're different schemes paid to different people out of different money — the dispatcher earns a percentage of the gross sale for bringing the lead in, the rep earns a share of what the job actually made after costs. Putting both on one page or one number invited them to be read as the same figure, and would have exposed the dispatcher scheme to reps who shouldn't see it.

**Decision:** Keep `/commissions` (dispatcher) and `/sales-commission` (rep) as fully separate pages/routes/permissions, never merged into one "commissions" view.

**Consequence:** Don't consolidate these into a single commissions module without re-deriving this reasoning first — it isn't accidental duplication.

---

## 005 — Portal access: magic link + passcode challenge + separate revocable grant
**Context:** Customers open portal links hours or days after they're sent, by which point a plain long-lived link alone is a weak gate — most such links arrive functionally dead as a security boundary even before anyone tries to abuse them.

**Decision:** Layer three independent controls: a single-use magic link (can't be replayed once redeemed), a street-number passcode challenge as a second factor for leads that have one on file, and portal access as a separate office-controlled grant that can be revoked instantly regardless of the link's own state.

**Consequence:** Portal auth is intentionally not the same code path as staff auth (`getCurrentProfile()`) — don't assume the two are interchangeable when touching `src/app/portal/*` or `src/lib/portal/session.ts`.

---

## 006 — CI runs lint + test + build on every push/PR
**Date:** 2026-09-09

**Context:** There was no CI at all — nothing ran lint, tests, or a build on push, so any of the three could break on `main` unnoticed. `npm run build` was initially assumed to need Supabase/Stripe/etc. secrets (several `src/lib/*-env.ts` modules read them), which would make CI fail for a reason unrelated to the code being pushed. Verified instead of assumed: ran `npm run build` locally with zero env vars set. It succeeds — every route touching those env vars is server-rendered on demand (`ƒ`, not statically prerendered), so nothing reads them at build time.

**Decision:** `.github/workflows/ci.yml` runs `npm ci`, `npm run lint`, `npm test`, `npm run build` on every push/PR to `main` — no secrets required.

**Consequence:** If a future page is made static (prerendered) and its data-fetching path reads one of those env vars at module scope instead of inside a request-time function, CI's build step will start needing real secrets. If that happens, add the required values as Actions secrets rather than reverting this to lint+test only.

---

## 007 — `main` requires a PR; direct pushes blocked for everyone, including admins
**Date:** 2026-09-09

**Context:** Nothing stopped a direct push to `main` — no branch protection existed. With 5 collaborators and CI now able to gate lint/test/build, a push landing without going through a PR (and without CI having run against it first, since `push` and `pull_request` both trigger CI but a direct push only checks it *after* it's already on `main`) defeats the point of having CI at all.

**Decision:** GitHub branch protection on `main`: require a PR before merging, require the `lint-test-build` check to pass before merge, no required approving reviews (team chose speed over mandatory second-reviewer for now), and no bypass for admins (`enforce_admins: true` — "force PR" means everyone, including the owner).

**Consequence:** Nobody, including repo admins, can `git push origin main` directly anymore — including from this assistant. All work (mine and the team's) goes: branch → PR → CI green → merge. If this ever needs a genuine emergency bypass, an admin must temporarily disable the rule in GitHub Settings → Branches, push, then re-enable it — don't ask to "just force push."

---

## 008 — Global search matches every typed character literally, `%` and `_` included
**Date:** 2026-09-09

**Context:** The `global_search` SQL function (migration 0140) escaped only backslash, leaving `%` and `_` as LIKE wildcards, on the theory that looser SQL matches "only widen recall" ahead of the app's literal re-filter. But each result group is capped (`limit p_limit`, 8) *before* that re-filter, so wildcard false-positives could fill every slot and the app would drop them all — searching `50%` could report "No matches" while a note saying "50% deposit due" sat in the database.

**Decision:** Escape `%` and `_` too (migration 0141), and make the app-side haystacks join fields exactly like SQL's `concat_ws` (skip empty fields, single spaces) so SQL and app agree on what a match is. Pinned by the cross-field test in `src/lib/data/global-search.test.ts`.

**Consequence:** SQL prefilter and app re-filter must stay in lockstep: any change to what the SQL function matches needs the same change in `buildSearchGroups`, and vice versa — the test file is where that agreement is enforced. Nobody gets to reintroduce "SQL can match a superset" without also removing the per-group limit that made it a bug.

---

## 009 — Two SQL functions decide lead visibility, and they must grant the same seats
**Date:** 2026-09-10

**Context:** Migration 0108 introduced `current_visible_lead_ids()` to replace the per-row `lead_visible_to_current_user(id)`, but the old function was never retired: `estimate_visible_to_current_user` still calls it, and through that it gates `estimate_items`, `estimate_signers`, `estimate_payments` and `portal_payments`. When 0134 added the closer seat only to the new function, a sales-scoped closer could open the estimate row (new rule) while every line item on it was filtered out (old rule) — the estimate they had just written appeared empty on reopen, with the data intact in the database the whole time.

**Decision:** Add the closer clause to `lead_visible_to_current_user` too (migration 0143), rather than rewriting the item/signer/payment policies onto the new function — the smaller change, and reversible policy-by-policy later. The agreement is pinned by `src/lib/data/lead-visibility-rules.test.ts`, which reads the migrations and fails if the newest definition of either function stops naming a seat (`assigned_to`, `dispatcher_id`, `closer_id`) the other has.

**Consequence:** Until someone actually consolidates the two functions, any new seat that grants lead access (a second closer, a project manager…) must be added to **both** — the test turns forgetting into a CI failure instead of a support call about vanished line items.

---

## 010 — Funnel card order lives on `profiles`, even though profiles is "identity-only"
**Date:** 2026-09-10

**Context:** The dragged order of the Estimates funnel cards started as a per-browser localStorage preference; the user then asked for it to follow their login across devices. The comment in `src/lib/data/profile.ts` says profiles stays identity-only (name/email/phone) with everything role-shaped on `company_members` — because a person can hold different roles in different companies. But a card arrangement is a personal habit, not a role: the same hands arrange the same screen whichever company they're looking at, so a per-company copy would just reset it on every switch. The alternatives were worse: `company_members` writes are Office-managed (loosening that for a cosmetic column widens a real trust boundary), and a new `user_prefs` table is a table plus policies for one column's worth of data.

**Decision:** `profiles.estimate_funnel_order text[]` (migration 0145), written by its owner through the existing `profiles_update_self` policy. Null means "never arranged"; the browser's localStorage order remains as fallback (and as the pre-migration path — `getCurrentProfile` reads `profiles` with `*`, so the missing column reads as null instead of failing the login select).

**Consequence:** profiles is now "identity plus personal UI preferences" — per-company permissions still never live there. If preferences multiply beyond this one column, fold them into a single jsonb or a real prefs table then, rather than growing a column per whim.

---

## 011 — Content-Security-Policy ships split: enforcing headers now, the real script/style/connect policy Report-Only until verified
**Date:** 2026-09-10

**Context:** A production-hardening pass needed real security headers (CSP, frame protection, HSTS, Referrer-Policy, Permissions-Policy) without guessing anything into a live, breaking change. Three specific unknowns couldn't be resolved from source alone in this environment: (1) whether the in-app Voice dialer's WebRTC signaling (`@twilio/voice-sdk`) actually reaches only the domains this policy allows — Twilio publishes no CSP domain list for the Voice SDK, and there's no way to place a real call here to verify; (2) whether this specific Next.js version's nonce-to-inline-script wiring behaves exactly as documented against this app's actual page mix; (3) whether every subdomain under the production apex domain is HTTPS-only — there is no domain or subdomain configuration committed anywhere in this repo (no `vercel.json` domains, no custom-domain reference in any doc), so that can't be verified from here either. Getting (1) or (2) wrong as an *enforcing* policy means a silently broken dialer or broken hydration in production, discovered by a user, not by CI. Getting (3) wrong under `includeSubDomains` breaks whatever subdomain wasn't actually HTTPS-ready, and wrong under `preload` is worse — browsers refuse plain HTTP to a preloaded domain permanently, until an explicit removal request and months of browser updates catch up.

**Decision:** Split across two mechanisms. `next.config.ts` sets headers that carry zero breakage risk — none of them restrict which scripts/styles/images/connections load: `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` (camera/microphone/display-capture stay on for the dialer and screen-share; everything else this app never uses is off), and a narrow *enforcing* `Content-Security-Policy` (`object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests`). `Strict-Transport-Security` ships too, but deliberately narrower than the usual "2 years + includeSubDomains + preload" recipe — `max-age=15552000` (6 months) only, for the reason (3) above: this app itself has never been served over plain HTTP, so the bare header is genuinely zero-risk, but `includeSubDomains`/`preload` are claims about infrastructure this repo can't see. `src/proxy.ts` (via `src/lib/security-headers.ts`) generates a fresh nonce per request and sends the full strict policy — `script-src`/`style-src` with `'strict-dynamic'` + nonce, `connect-src`/`img-src` scoped to Supabase, Twilio, Google Drive, and Google Maps Street View — as `Content-Security-Policy-Report-Only`, which logs violations to the browser console without blocking a single request.

Verified locally (real `next start`, real curl, not just reasoning): the nonce is correctly stamped onto every script tag on a dynamically-rendered page and matches the response header exactly; the two statically-prerendered pages (`/login`, `/forgot-password`) do *not* get a nonce on their inline framework scripts (expected — Next can't inject a per-request nonce into a page built once at build time) and will show `script-src` violations in Report-Only mode specifically on those two routes until they're forced dynamic or carved out — noted here so it isn't mistaken for a bug when the reports show up.

**Consequence:** Before flipping `Content-Security-Policy-Report-Only` to a real `Content-Security-Policy` in `src/lib/supabase/proxy.ts` (one line — the header key, not the value), someone must: open the app with DevTools console open and exercise the Voice dialer (place a real call), screen-share, the reply-inbox message panel (Supabase realtime), a CSV import, a file upload, a Drive-backed lead photo, and an address with a Street View preview, watching for `[Report Only]` console entries; and decide what to do about `/login`/`/forgot-password` (force dynamic with `await connection()`, or accept a narrower policy on just those two routes). Don't flip it on schedule or by default — flip it once that checklist is actually clear, and update this entry with the date it happened.

Separately, escalating `Strict-Transport-Security` needs its own deliberate steps, in order, each only once actually true: confirm every subdomain in active use under the production apex is HTTPS-only, then add `includeSubDomains`; run that for a while; only then consider `preload` — which additionally requires submitting the domain at hstspreload.org and accepting that removal is slow and not guaranteed to reach every browser install. Don't add either flag "because it's the standard recipe" without redoing this check against whatever the domain setup actually is at the time.

**Correction, 2026-09-10 (see #012, #013): the nonce gap described above as "just `/login`/`/forgot-password`" was verified only against a local `next start` and turned out to be wrong for real production — it's every public page, for a mechanism still under investigation (ruled out: the bundler). Don't rely on the "two known pages" framing above; read #012 and #013 before touching the enforcing/Report-Only split further.**

---

## 012 — The CSP nonce gap isn't two static pages, it's every page (suspected cause later disproven — see #013)
**Date:** 2026-09-10

**Context:** #011 shipped the Report-Only CSP believing (verified against a local `next start`) that only the two statically-prerendered pages (`/login`, `/forgot-password`) would fail to receive a per-request nonce on their framework scripts. Running the new `e2e/public-smoke.spec.ts` suite against real production (`https://crm.aibuildpros.com`) after deploying disproved that directly: fetching the actual HTML for every public route — `/login`, `/forgot-password`, `/register`, `/welcome`, `/get-started` — showed 0 of 10-or-11 `<script>` tags carrying a nonce, on all five, not just the two originally documented. The `x-nonce` header and the `content-security-policy-report-only` header are both present and correctly generated on every request (confirmed via curl) — the header-generation side (`src/lib/security-headers.ts`, `src/proxy.ts`) works exactly as designed. The gap is entirely on Next's own side: it never stamps the nonce it read from the request header onto the rendered script tags, in production.

Suspected root cause at the time this entry was first written: [vercel/next.js#96063](https://github.com/vercel/next.js/issues/96063) — "Nonce-based CSP: no script gets a nonce on Turbopack + `output: 'standalone'`," closed upstream as **not planned**. This repo builds with Turbopack (the default builder in this Next.js version), and Vercel's own production build pipeline packages Next apps as `output: 'standalone'` regardless of what this repo's `next.config.ts` says — a plausible match. **This suspicion was tested and disproven — see #013.** Left here rather than deleted so the reasoning that seemed plausible at the time is still visible.

**Decision:** No code change in response to this yet — logging it accurately is the priority so the next decision (see #013) gets made deliberately, not by someone reading #011's now-incomplete "two pages" framing and concluding the checklist is nearly done. `e2e/public-smoke.spec.ts` was corrected to stop asserting "zero script-src violations on dynamic pages" (true locally, false in production) and instead only hard-asserts on *non*-script-src violations (connect-src/img-src/font-src — genuinely this app's own domain-allowlist correctness, confirmed unaffected by whatever causes the nonce gap) while reporting script-src-elem counts as information rather than a target either direction.

**Consequence:** The CSP must **not** be flipped from Report-Only to enforcing under any of the current conditions — doing so today would break script execution, and therefore hydration, on every single production page, not a two-page edge case. See #013 for what was tried next and the actual recommendation.

---

## 013 — Bundler choice ruled out for the CSP nonce gap; staying Report-Only, not chasing further right now
**Date:** 2026-09-10

**Context:** #012 suspected Turbopack + Vercel's `output: 'standalone'` packaging (vercel/next.js#96063) as the cause of the nonce gap. Tested directly rather than assumed further:

| Where | Bundler | Nonce on `<script>` tags |
|---|---|---|
| Local (`git worktree`, `output: 'standalone'`, `node server.js`) | Turbopack | ✅ Works — every script tag nonce'd |
| Local (same rig) | Webpack (`next build --webpack`) | ✅ Works — every script tag nonce'd |
| Real Vercel production (`crm.aibuildpros.com`) | Turbopack (the app's normal build) | ❌ Fails — 0 of 10-11 tags nonce'd |
| Real Vercel Preview (PR #141, one-line experimental `build` script change, checked manually through Vercel SSO) | Webpack | ❌ Fails — 0 of 8 tags nonce'd |

Both bundlers work identically locally; both fail identically on real Vercel deployments. **This rules out the bundler as the differentiator** — #012's specific suspicion (Turbopack + standalone) is disproven: webpack hits the exact same failure on a real Vercel Preview, and Turbopack does not fail locally under the same `output: 'standalone'` packaging that supposedly triggers it. vercel/next.js#96063 may still be a real bug for whoever filed it, but it is not what's happening in this app's deployment.

**What actually differs between "works" and "fails" is the deployment target (local single-process vs. real Vercel), not the bundler.** The most likely explanation, based on Next's own documentation of how Proxy is meant to run — *"Proxy is meant to be invoked separately of your render code and in optimized cases deployed to your CDN for fast redirect/rewrite handling, you should not attempt relying on shared modules or globals"* (`node_modules/next/dist/docs/.../file-conventions/proxy.md`) — is that Vercel's actual production/preview topology runs Proxy and the page-render function as genuinely separate invocations, and the request-header mutation this app's nonce mechanism depends on (`NextResponse.next({ request: { headers } })`, read back via `parseRequestHeaders` during SSR) does not reliably cross that boundary in Vercel's real infrastructure, even though a local `next start` or standalone `node server.js` handles Proxy and rendering in one process where the same mutation trivially works. **This is the leading explanation, not a confirmed mechanism** — it has not been verified against Vercel's own internal architecture docs or support, only inferred from Next's own warning and the pattern of exactly where the behavior does and doesn't reproduce. Don't state it more strongly than that if this gets referenced later.

**Decision:** Stay Report-Only. Do not add `'unsafe-inline'`. Do not change the narrow enforcing CSP or the HSTS configuration — neither was in question here and both continue to work correctly (confirmed via `e2e/headers.spec.ts` against real production throughout this investigation).

One real alternative technical path exists and is worth naming without committing to it: Next.js has an **experimental, hash-based CSP mode via Subresource Integrity** (`experimental.sri.algorithm` in `next.config.ts`) that computes a static `integrity="sha256-..."` hash per script *file* at build time, rather than depending on a per-request nonce read from a request header. Because the hash comes from the build manifest rather than anything Proxy has to pass through at request time, it plausibly sidesteps this exact failure mode entirely. Not attempted here: Next's own docs mark it experimental and App-Router-only ("may change or be removed"), and confirming it actually works on Vercel's real topology would mean repeating this same investigation cycle (local test, then a real Preview deployment) for a feature explicitly flagged as unstable. Given the CSP is already safely Report-Only with zero user-facing impact either way, spending another investigation cycle on an experimental feature is not a good trade right now.

**Recommendation:** Keep the CSP Report-Only. This is not a "temporarily stuck, resume soon" state — it's a reasonable stopping point: the enforcing headers (frame protection, HSTS, Permissions-Policy, the narrow CSP) and the Report-Only policy's actual domain allowlist (Supabase/Twilio/Drive/Maps) are all confirmed correct and doing real, live work today. What's missing is the last mile (enforcement), and every reasonable low-risk path to it has now been checked: bundler swap (ruled out, evidence above), `'unsafe-inline'` (explicitly rejected — it would mean the nonce mechanism is protecting nothing, the opposite of the goal), waiting on vercel/next.js#96063 (no longer relevant — it wasn't the actual cause). The one remaining path (SRI) is experimental, would cost another full investigation cycle, and gates on Next.js's own team maturing an unstable feature — not something to chase now. Revisit if: Next.js SRI support leaves experimental status, or a specific Vercel-support answer clarifies the actual Proxy request-header propagation behavior in a way that suggests a real fix.

## 014 — Cobrowse is DOM mirroring on the screen-share plumbing, not a second system

**Date:** 2026-09-11

**Context:** The ask was "add cobrowse." The app already had teammate screen sharing (WebRTC capture over a Supabase Realtime signaling channel, #0112/#0116 rows for discovery and invites), with one structural hole the code itself documents: Apple bars every iPhone/iPad browser from `getDisplayMedia`, so the people most often in the field could watch but never share. True cobrowse — mirroring the page's DOM rather than capturing pixels — needs no capture API, so it fills exactly that hole. The build options were a cobrowse SaaS snippet, a parallel self-built feature, or a second *transport* inside the existing feature.

**Decision:** Second transport. A `kind` column on `screen_shares` (`'screen' | 'cobrowse'`, migration 0149) tells a joining viewer which protocol to speak; the row, token capability, invite targeting, RLS, discovery poll, and admin request flow are shared unchanged. The sharer records the tab with rrweb and ships event batches over the same `share:<token>` channel the WebRTC handshake would have used, chunked to fit Realtime's payload cap (`src/lib/cobrowse/wire.ts` — the pure, tested part); a viewer's hello answers with a fresh full snapshot instead of an SDP offer. Supporting calls: rrweb loads only at the moment of use (dynamic import) so the layout bundle every page loads stays clean; input masking is passwords-only, because the precedent surface (full screen share) already shows teammates everything and cobrowse strictly narrows that to one tab; one-viewer-at-a-time is kept for parity with the WebRTC busy semantics even though broadcast could fan out; the mirror renders in rrweb's sandboxed iframe with `pointer-events: none`, so it is structurally a picture, not a controllable surface.

**Consequence:** iPhone/iPad users now share (the CRM view) and answer admin screen requests instead of auto-declining; desktop users get a "Just the CRM" privacy option next to "Entire screen." Cobrowse sessions carry no audio/camera lanes — talking goes by phone, same as the no-mic screen-share case. Anyone touching the signal protocol must keep the two transports' handshakes distinct: `viewer-hello` means "send an offer" on a screen session and "send a snapshot" on a cobrowse one.

## 015 — A change order's mirror row is linked by doc number, not a new column

**Date:** 2026-09-11

**Context:** Signing a change order appends one mirror row to the parent contract's `estimate_payments` (name = the change order's doc number, amount = its total — `src/lib/estimate-signing.ts`). Money collected on the change order's own schedule settles the change order's rows, so the mirror row read "Not billed" while thousands had already been paid (reported on EST-1097-CO1: $15,000 of $30,000 collected, parent row unbilled). Rolling that billing back onto the mirror row needs a link from the row to its change order, and no foreign key exists.

**Decision:** Match at read time on `estimate_payments.name === change order doc_number` (exact, trimmed — `src/lib/data/change-order-rollup.ts`) instead of adding a `source_estimate_id` column. The name is written by signing onto a schedule that is already locked (the parent must be Signed before a change order can exist, and a signed contract's schedule editor is read-only), so nothing in the app can rename the row afterwards and the match cannot silently break. A column would be more explicit but costs a migration plus a backfill for existing rows, for a fact the name already states.

**Consequence:** If a future feature ever makes locked schedule rows renamable, the rename must either be blocked on mirror rows or this link must move into a real column at that point. The rollup is display-side only — button-gating on the estimate page, and status read-through on the project report's printed schedule (`src/lib/data/report-schedule.ts`); aggregate views (Money to Collect, collections summary) still count the change order's own phases, which is where the billing truth lives.

## 016 — Sentry over self-hosting/Datadog for observability; manual instrumentation, not the SDK's automatic build-time wrapping

**Date:** 2026-09-11

**Context:** Debugging an intermittent Twilio Voice SDK `31000 UnknownError` ("General Error") surfaced a bigger gap: this app had zero observability tooling anywhere — no error monitoring, no structured logging, no correlation ids, no `global-error.tsx`, no release tagging. `31000` is Twilio's own documented catch-all code; diagnosing it for real requires cross-referencing what the app was doing against Twilio's own debugger logs, which isn't possible after the fact without some record of "what the app was doing."

**Decision:** Adopt Sentry (`@sentry/nextjs`) as the durable record for faults (exceptions, tags, breadcrumbs, alerting, release tracking), backed by cheap structured JSON logs (`src/lib/observability/logger.ts`, captured by Vercel's Runtime Logs) for live-tailing, and two nullable columns on `call_logs` (`correlation_id`, `sentry_event_id`) linking a business record to its trace — explicitly not a new logging database. Full design in `docs/features/observability.md`. Built the Twilio voice-dialer path first as the proving case rather than a synthetic example.

Two things were verified directly rather than assumed, both load-bearing for how the instrumentation is written:

1. **This repo builds with Turbopack** (confirmed in #012/#013). `@sentry/nextjs`'s own documentation states its webpack-based build-time instrumentation and source-map upload "no longer apply" under Turbopack. Checked the installed SDK's type definitions (`autoInstrumentServerFunctions`/`autoInstrumentMiddleware`/`autoInstrumentAppDirectory` in `node_modules/@sentry/nextjs/build/types/config/types.d.ts`) to confirm this is real, not a version-specific quirk. **Consequence:** every capture point in this app (`withRouteObservability`, `withActionObservability`, `voice-dialer.tsx`'s explicit `captureError` calls, `instrumentation.ts`'s `onRequestError`) is manual by design. `withSentryConfig` is still applied in `next.config.ts` (harmless, and would start working automatically if the build ever moves off Turbopack), but nothing relies on it.
2. **`@sentry/nextjs`'s named exports (`captureException`, `setTags`, etc.) resolve to `undefined` under plain `node --test`** (no bundler) — the package's `exports` map lists the `"node"` condition (a CJS build) before `"import"`, and Node's CJS/ESM interop (`cjs-module-lexer`) can't statically detect those exports from that build, even though `require()`-ing the same file directly proves they exist at runtime. This only affects the test runner; Next's actual bundler resolves the real ESM build correctly. **Consequence:** `src/lib/observability/sentry.ts`'s exported functions (`captureError`, `addBreadcrumb`, `setRouteScope`) are wrapped in a `safely()` guard that swallows any throw from the underlying SDK call. This was written as a genuine production safety property, not just a test workaround — observability code must never be able to crash the business logic it's wrapping, whatever the reason (a bad build, a missing DSN, this exact resolution quirk). The corresponding unit tests (`sentry.test.ts`) test the pure tagging/redaction logic (`buildErrorContext`) directly and only assert "never throws" on the actual SDK calls, rather than mocking `Sentry.*` — a mocked reference silently wouldn't have been the function actually called, which would have been a false-negative-shaped test, not a real one.

**Consequence:** Don't attempt to unit-test `captureError`/`addBreadcrumb`/`setRouteScope` by mocking `@sentry/nextjs` directly under `node --test` — it doesn't observe what's actually being called. Verify those end-to-end instead (a real call through the dialer, checked in the Sentry dashboard). Don't rely on Sentry's automatic middleware/route/action wrapping to catch anything in this app — if a new route or action needs coverage, it needs an explicit `withRouteObservability`/`withActionObservability` call or a manual `captureError`, the same way the Twilio routes do it.

## 017 — Spreadsheet-scale CSV import: the browser chunks the upload, and duplicate matching moved client-side

**Date:** 2026-09-14

**Context:** A 73,546-row spreadsheet froze the import modal on both buttons. Three stacked causes: (1) the whole mapped file went up as one server-action call — Vercel caps a serverless request body at 4.5MB regardless of `next.config.ts`'s `serverActions.bodySizeLimit: "25mb"`, which only raises Next's own check; (2) even under the cap, one invocation inserting 73k rows (148 sequential 500-row inserts) outlives the function timeout; (3) both `runImport` and `checkDuplicates` awaited with no try/finally, so the rejected promise left `pending`/`dupeChecking` true forever — a frozen button with no error. The duplicate check had a fourth, silent problem: its whole-table select stopped at PostgREST's default 1000-row page, so it only ever compared against the first 1000 existing contacts.

**Decision:** Keep `bulkImportLeads` dumb and make the browser the batcher: `runImport` slices the mapped rows into 2,000-row chunks (`src/lib/import-batching.ts`, ~1MB each — margin under the 4.5MB cap, a few inserts of work per call) and sends them sequentially with live progress; a failed chunk keeps a resume cursor so the next click continues instead of re-importing from row one (the cursor resets on any change that re-shapes the row list — new file, mapping change, skip-duplicates toggle). The duplicate check flips direction: `getExistingContactKeys` pages through the company's contacts server-side and returns every normalized phone/email key once (via the `selectAll` pager from decision #002), and the rows are matched in the browser (`matchDuplicateIndexes`) — the payload no longer scales with the spreadsheet at all. Every await sits in try/catch/finally so a failure surfaces as an error and re-enables the buttons.

**Consequence:** Chunks commit independently, so a run that dies mid-way has really imported its finished chunks — Resume (not re-click-and-hope) is the recovery path, and a lost response can re-send at most one chunk (logged in TECH_DEBT). The key download grows with the contact table, not the file; at ~100k contacts it's a few MB, and if that ever hurts, the next step is a normalized-phone column plus targeted `in ()` queries, not a return to uploading the spreadsheet.

## 018 — Migration drift is checked by probing PostgREST, not by an information_schema RPC

**Date:** 2026-09-14

**Context:** Code deploys automatically on merge (Vercel), but every SQL migration is a manual paste into the Supabase SQL editor. On 2026-09-14 that gap produced two production incidents in one day: `0150_lead_phone2_phone3.sql` was never run, so every lead save failed with `Could not find the 'phone2' column of 'leads' in the schema cache`; `0151_call_logs_observability_correlation.sql` was never run, so every dialer call ended with "That call wasn't logged" and no call history. Nothing surfaced either until reps hit them live.

**Decision:** A "Database Health" settings page (`/settings/schema-health`, Admin-only) probes the live database for the columns recent migrations add — one service-role `SELECT <col> ... LIMIT 0` per column through PostgREST — and names the exact migration file to run for anything absent. The manifest lives in code (`EXPECTED_COLUMNS` in `src/lib/schema-drift.ts`) and gets a row appended whenever a migration adds a column or table. Probe-based on purpose: an `information_schema` RPC would itself need a migration to exist, and a checker disabled by the very unapplied migration it should report is no checker at all. Error classification is strict (42703/42P01/PGRST204/PGRST205 or their message shapes) so a flaky probe can never masquerade as drift and send someone re-running SQL that already ran.

**Consequence:** The check sees columns and tables only — a migration that changes just a policy, constraint, or function (0146, 0148) is invisible to it, and the manifest must actually be appended to as part of shipping such a migration (now part of the Definition of done for schema changes). It answers when visited, it does not alert; wiring it into a cron/notification is a possible next step if a missed migration recurs.

## 019 — Power Dialer list building: a filter is a query plan, not an array scan

**Date:** 2026-09-15

**Context:** The dial queue page shipped every lead in the company (all 40+ columns, notes included) plus every call log to the browser and filtered there. At 79k imported contacts that meant ~80 sequential database pages server-side and a payload in the tens of megabytes — the page took minutes to open. The call-log fetch was also silently capped at PostgREST's 1000-row page, so the Call Attempts filter was already computing from a truncated log.

**Decision:** Same direction as #003 and `searchBookableLeads`: the payload must not scale with the table. `listDialContacts` returns the 50 rows on screen plus a total; every filter/search/page change asks the server. The interesting part is the Call Attempts × Disposition combination, which joins leads to call_logs — solved without SQL functions by observing that attempts and disposition are facts about *called* leads, a small set next to the whole book: `contactQueryPlan` (pure, tested) reduces any combination to either a small id list to include (`.in()` chunks) or a small id list to exclude from everyone-with-a-phone (scan-and-skip, with the total as base-count minus excluded-matching-count — both sides described by the same filter builder so they can't disagree). Call stats now read the full log via `selectAll` (fixing the 1000-row truncation). Full `Lead` rows are fetched only for a session's selected ids; CSV matching sends the file's normalized phone keys up and matches server-side.

**Consequence:** Deep pagination in exclusion mode scans forward page by page (page 1 — the load that was slow — is one range read). No RPC migration was added on purpose: the day after two unapplied-migration outages, a dialer that breaks when SQL isn't run by hand was the wrong trade; if the exclusion scan ever hurts, the next step is a SQL function returning the joined page, added to the Database Health manifest once it can probe functions. The pipeline board still ships all leads the old way — tracked in TECH_DEBT.

## 020 — Bulk-email activity is logged into `sms_messages`, not a new table

**Date:** 2026-09-14

**Context:** The only prior "email a client" affordance was a `mailto:` link (one contact at a time). Adding a real send-to-many compose flow (`src/lib/actions/bulk-email.ts`, via the existing Resend `sendEmail()` pipeline) raised the question of where to record that an email went out, for the same "did they ever get anything?" activity trail the portal-link send already relies on.

**Decision:** Reuse `sms_messages` (`channel: "email"`, `direction: "outbound"`, `body: "[Bulk email] <subject>"`) instead of a new `email_messages`/`bulk_email_log` table — the exact same table and shape `sendPortalLink` already writes to for its own outbound email (`src/lib/actions/portal.ts`). One outbound-contact-activity table beats two overlapping ones, and it costs no migration.

**Consequence:** Anything that later needs to distinguish "a portal link" from "a bulk email" in this trail must parse the `body` prefix (`[Bulk email]` vs the portal-link subject text) — there's no dedicated column for message type. If a third outbound-email surface appears, or the two need querying apart at scale, that's the point to add a real `kind`/`source` column instead of a third string prefix.

## 020 — Pipeline board: windows and numbers travel, never the book

**Date:** 2026-09-15

**Context:** The pipeline page shipped every lead in the company (all columns, notes included), every task, every note, and the file list to the browser, then reduced the stat tiles and grouped the columns there. Post-import (79k contacts) that was tens of megabytes and minutes of load — the same disease #019 cured on the dial queue, on the app's most central page. The board had already virtualized its DOM (memoized columns, scroll-in cards); the payload was the remaining, dominant cost.

**Decision:** Same direction, adapted to a board: `getPipelineBoardData` returns each stage column's first window of cards with an exact count (one indexed query per stage, sort pushed into SQL), the stat tiles as numbers computed server-side from a slim scan (`computeBoardAggregates`, pure and tested — the scan reads five columns and never notes), the Won breakdown as the 50 biggest deals plus true totals, and the attention digest computed exactly (warnings need notes text and open tasks) over the 1,000 newest open leads rather than the whole book — a bounded, labeled window, since a digest listing 70k dormant imports is noise and their notes would be a 100MB read. Scrolling a column fetches its next window; opening a card fetches that lead's full row, tasks, notes, and files (`getLeadCard`); a drag moves the card optimistically and then refetches. Name sort became the three name columns ordered in SQL — the closest the database comes to display-name order.

**Consequence:** Filter changes cost a server round trip (the slim scan dominates, ~80 range queries at 79k leads) instead of being instant against an in-memory book — acceptable against a page that took minutes to open; if it hurts, the next step is SQL aggregates (an RPC, or PostgREST aggregate functions once confirmed enabled), not a return to shipping the book. The digest's counts now mean "within your newest 1,000 open leads" and say so on the panel. Remaining ship-everything callers of `selectAll` over leads are tracked in TECH_DEBT.

## 021 — Report pages fetch the leads their rows reference, never the book

**Date:** 2026-09-15

**Context:** After #019/#020 cured the dialer, board, and contacts pages, seven report/analytics pages still shipped every lead in the company (full rows, notes included) to the browser — five of them only to print a name next to a call, text, appointment, or assignment; two to reduce funnel numbers. Worse, the duplicate-merge tool expanded every shared phone/email into pairwise combinations of full lead rows: one junk number shared by 500 imported contacts is 124,750 pairs, and opening the tool after the 73k import froze the tab ("Page Unresponsive").

**Decision:** A `LeadLite` slice (name fields, phones, address) and two fetchers (`src/lib/data/lead-lite.ts`): `leadsLiteByIds` for rows that reference leads by id (call/appointment reports, setter assignments), and `leadsLiteForMessages` for SMS lists, which also resolves the caller-ID-style phone matching server-side (`counterpartyPhoneKeys`, pure and tested) so only matched contacts travel. Salespeople tallies are reduced server-side from a three-column scan (`repLeadStats`, tested); the two marketing pages fetch exactly the columns their math reads. The setter page's "add a contact" picker searches server-side via `searchBookableLeads` (which gained `address`). The merge tool scans slim rows and pairs through `buildDuplicatePairs` (tested) with two rails: a value shared by more than 8 contacts is reported as a bad-data cluster instead of exploded into pairs, and the list is capped at the 200 strongest matches with an exact total. Text Reports' bare message select also moved to `selectAll` — it was silently counting only the newest 1,000 texts.

**Consequence:** Report payloads are proportional to the report, not the book. The merge tool shows at most 200 pairs per scan (resolve and rescan for more) and names oversized clusters rather than pretending they are mergeable pairs. The SMS phone-match walks the book server-side only when unlinked messages exist; if that scan ever hurts, the next step is a normalized-phone column with an index, not shipping the book again.

## 022 — Estimate send is one real email with To/Cc/Bcc, not a loop of private sends

**Date:** 2026-09-15

**Context:** Decision was made minutes earlier (see the now-superseded shape of `sendEstimateToCustomer`) to CC extra estimate recipients by sending each of them a separate, private email — same document, same link, but each recipient's own solo message. Building a real compose UI (a "Send Estimate" drawer with To/Cc/Bcc fields) surfaced that this doesn't actually behave like Cc/Bcc at all: nobody could see who else was included, which is indistinguishable from every recipient being Bcc'd. Investigation also confirmed the data model has a hard ceiling of exactly 2 named people per lead (primary + "Second Contact") — no array field, no multi-contact join table — so "send to several/all contacts" has to mean the primary, the second contact, and whoever gets typed in at send time.

**Decision:** `sendEmail` (`src/lib/email-env.ts`) now accepts real `cc`/`bcc` arrays and a `to` that can itself be an array, passed straight through to Resend's own `to`/`cc`/`bcc` fields. `sendEstimateToCustomer` (`src/lib/actions/estimates.ts`) resolves one To/Cc/Bcc set via `resolveEstimateRecipients` (`src/lib/estimate-recipients.ts`, pure and tested) — lead's email plus free-typed extras in To; second-contact plus free-typed extras in Cc; free-typed only in Bcc; each bucket excludes addresses already claimed by an earlier one — and sends it as **one** message. To/Cc recipients now genuinely see each other's address, the way any other mail client's Cc behaves; Bcc stays hidden from all of them, which the old loop could never express since every send was already private.

**Consequence:** This is a real trade-off, not a free upgrade: the old loop's per-address isolation is gone — one atomic Resend call now covers every recipient, so a delivery-time failure (not a malformed address; those are already rejected by `resolveEstimateRecipients` before the call) can no longer fail alone while the rest go through. Accepted because the alternative (fake Cc/Bcc) actively misrepresented what recipients would see. If per-recipient delivery isolation is ever needed again, it would mean going back to N calls and giving up real Cc/Bcc visibility — don't do both at once without re-deciding this trade-off. The single-use portal link is still shared across every recipient in the message (decision in `docs/TECH_DEBT.md` — "CC'd estimate recipients share one single-use portal link"), unchanged by this rewrite.

## 023 — Estimate send: no channel picker, and an unedited message preview is never what gets sent

**Date:** 2026-09-15

**Context:** Two follow-ups landed on the same Send drawer at once. First, the channel picker (Email / Text / Email + Text) was pure UI ceremony — `sendEstimateToCustomer`'s `"both"` channel already sends whichever of email/text a contact has on file and only errors if neither exists, so the picker made a rep choose something the system would already do correctly for them. Second, "see and edit the email body" meant showing the actual default message (not a blank box) and letting a rep rewrite it — but the drawer opens, and Send saves the draft, *before* the send itself runs, so a rep who edits a line item's price and then hits Send without touching the message preview would otherwise ship a message that quoted the pre-edit total.

**Decision:** Dropped the picker entirely — every send now calls `sendEstimateToCustomer(id, "both", ...)`, no rep choice involved. For the message: a new read-only action `previewEstimateEmail` (mints no token, sends nothing) computes the same default text the real send would build, via a shared pure function `defaultEstimateNarrative` (`src/lib/estimate-email-copy.ts`) — the drawer fetches it fresh every time it opens and prefills an editable textarea. The drawer tracks a `narrativeDirty` flag, set only on an actual edit; on Send, the client passes its edited text **only when `narrativeDirty`** — an untouched preview sends `narrative: undefined`, so the server rebuilds its own fresh default from the just-saved (post-edit) total inside `buildEstimateEmail`, rather than resending a preview that may have gone stale the moment the rep changed a price.

**Consequence:** A rep who never opens the message field always gets the current, correct total in the default copy, no matter what they changed on the line items first. Only a genuinely rewritten message is ever sent verbatim — which is correct, since a hand-written note has no dependency on the estimate's total to begin with. Anyone changing the drawer's send flow must preserve this: never pass the client's cached preview text as `narrative` unless the rep actually edited it, or this staleness guard silently breaks.

## 024 — Closer workflow: reps draft, the closer sends, and the closer holds their own seat

**Date:** 2026-09-16

**Context:** A closer-led job actually involves three or four people: the rep who owns the lead, sometimes a second rep on the appointment (`events.second_assigned_to`, 0039), the closer (`leads.closer_id`, 0134), and the office. Three things didn't line up with how the team works. (1) Any rep holding the Users & Roles Send Estimates switch could send an estimate on a closer-led lead, so nothing made the closer's review actually happen before the customer saw a price. (2) The second appointment rep could see the visit they were booked onto but not the lead it belongs to — the exact hole 0134 closed for closers. (3) The closer was seeded into rep seat two (`sales_rep_2`, 0135), so a job with two reps *and* a closer had nowhere to put the third person, and whoever lost the seat lost their commission line.

**Decision:** Three moves, one per gap. (1) A **closer hold on sending**: on a lead with a closer, only the closer, Office or Admin can take a document out of Draft (send, Mark Sent, signed on paper — completion certificates exempt, the sale is already closed). Enforced in the server actions (`closerHoldError` in `src/lib/actions/estimates.ts`, pure rule in `src/lib/estimate-closer-gate.ts`) rather than a trigger like the approval gate (0136), because the send path updates status through the service-role client where `auth.uid()` is null — a trigger cannot tell a rep from the closer there, while every path out of Draft already runs through these guards. The hold **narrows** the existing permissions and never replaces them: the per-user Estimates switches in Users & Roles keep their full say (a closer still needs Create + Send to send; a rep with Send off stays drafts-only everywhere), and Office/Admin are never held, same as `canSendEstimates`. (2) **Appointment seats grant the lead** (0152): either chair on any of a lead's appointments joins `current_visible_lead_ids()`, `lead_visible_to_current_user()` and `leads_select`, pinned by the same test that keeps those rules level (#009). (3) **The closer gets their own contract seat** (0153): `estimates.closer_id` + `closer_pool_bp`, seeded at signature from the lead; their cut comes off the pool first (`computeRepCommission`'s `closerPoolBp`) and the two rep seats split the remainder, so the office can seat a second rep without touching what the closer was promised. The closer's line appears on `/sales-commission` under the same holds as everyone's.

**Consequence:** Contracts signed before 0153 keep their closer in seat two with the converted share already stamped — `closer_pool_bp` stays null there and computes as zero, so nothing already earned is restated; `getEstimateTeam` reads the frozen closer as `closer_id ?? sales_rep_2` for the same reason. The one behavior an office may notice: a rep with the Send switch can no longer send on a closer-led lead — that is the feature, and the escape hatches are deliberate (the closer sends, the office sends, or the office clears the closer from the lead).

## 025 — Every people dropdown offers reps only, plus whoever it already points at

**Date:** 2026-09-16

**Context:** Every dropdown that picks a person — Assigned To / Second Assigned To on an appointment, Assigned Rep on a lead, the booking pickers on schedule/dial-queue, task assignee, the salesperson and closer seats on a contract, and the rep filters on schedule, reports, the pipeline board and the commission statement — offered the entire active roster: the shared phone account, bookkeepers, dispatchers, nineteen names where ten could ever run an appointment. The calendar's *filter* had already been narrowed once (Sales role OR already on the calendar), and the estimates funnel had independently invented the same idea for its salesperson filter (`repOptionIds`: people with a document here, plus whoever is ticked) — but each assignment dropdown was still the whole roster, and each future one would be too, because there was no shared rule to reach for.

**Decision:** One pure helper, `repDropdownOptions(members, keep)` in `src/lib/data/rep-options.ts` (tested beside it), is now the rule: active **Sales-role** members, alphabetical by the name the option shows, **plus every id passed as `keep`** regardless of role or status. Assignment fields pass their current value as `keep`; filters pass the ids present in their rows plus the current tick. The `keep` escape is the load-bearing half: a stored assignee the list refuses to show renders as a blank select and saves back as silently un-assigning them, and a ticked filter that no longer renders cannot be undone. Role-specific pickers keep their own role (Dispatcher → Dispatch, production job assignees stay crew); the closer seat counts as a rep's seat (the closer runs the appointment and writes the estimate — 024). Name-resolution maps (`repById`, `repName`) keep reading the whole roster. Standing rule recorded in `AGENTS.md`.

**Consequence:** `getCommissionReps` now returns each member's roles so the contract seats can narrow client-side while still resolving any frozen historical seat to a name, and the closer picker's options query moved from `profiles` to `company_members` (roles live on the membership row). A company whose salespeople lack the Sales role in Users & Roles will see near-empty assignment dropdowns — that is the role data being wrong, and the fix is granting the role, not widening the list back out.

## 026 — Sales-team edits on a signed contract leave an append-only trail

**Date:** 2026-09-16

**Context:** The commission seats on a contract (`sales_rep_1/2`, `closer_id`, the shares and rates — 0086, 0135, 0153) stay editable after signature by design: the office corrects a wrong seat and settles mid-job handoffs. But the commission statement computes live from whoever currently holds the seats, so swapping a rep or closer restates the whole line — the old rep's line vanishes from `/sales-commission` as if it never existed — and nothing recorded that it was ever anyone else's. The office asked for exactly this move (switch rep/closer after signing) and the honest answer was "possible, but silent."

**Decision:** An append-only table, `sales_team_changes` (0154): one row per `saveSalesTeam` call that changed anything, holding raw before/after JSONB snapshots of the eight team columns plus `changed_by`/`changed_at`. Snapshots, not prose — a pure, tested function (`describeSalesTeamChange`, `src/lib/data/sales-team-changes.ts`) renders them into panel-vocabulary lines ("Salesperson: A → B", "Share split: 100% / 0% → 60% / 40%") at read time, so wording can improve without restating stored history; the same function decides whether anything changed at all, so the trail can never hold an empty entry. Append-only is enforced by RLS, not convention: Office/Admin get select and insert (insert additionally requires `changed_by = auth.uid()`), and **no policy grants update or delete to anyone**. Capture lives in the server action rather than a DB trigger because `saveSalesTeam` is the only path that edits these columns after signature and the app's guards already live there (024's reasoning); the known bypass is logged in TECH_DEBT. A null rate snapshots as null and reads as "unset" — a contract nobody has saved has not chosen 0% (same distinction `getSalesTeam` draws). If the audit insert fails after the update stood, the admin is told the history is short — not that saving failed, which would invite a retry that double-applies nothing but confuses everyone.

**Consequence:** The trail starts at the first save after 0154 runs; earlier edits are unrecorded and nothing pretends otherwise. The panel shows the history to admins only (`getSalesTeamChanges` gates like the save — this is pay history, not team info), resolving names through the whole roster so a seat somebody held before leaving still names them (025). The recommended way to handle a mid-job handoff remains seating both people with a split rather than a swap — the trail makes a swap visible, not fair.

## 027 — Global search matches word by word on whitespace-folded text

**Date:** 2026-09-16

**Context:** A client stored as first name `"PETER "` (trailing space) + last name `"BAHGAT IBRAHIM"` renders clean everywhere — HTML collapses the doubled space the trailing space produces — but search matched the typed query as one contiguous substring of the raw stored text, so "PETER BAHGAT" reported "No matches" while the client sat in plain sight on his own estimate. Imports and copy/paste plant the same landmines constantly: doubled spaces, trailing spaces, non-breaking spaces from email. The same contiguous-substring rule also failed honest queries whose words differ in order from the stored rendering ("bahgat peter") or skip a middle name ("peter ibrahim").

**Decision:** Both halves of search (008's lockstep pair) now fold every whitespace run — non-breaking space included — to one space, split the query into words, and match a row when *every* word appears somewhere in its folded haystack, in any order, across field boundaries. Migration 0155 for the SQL prefilter, `matchesEveryWord` in `src/lib/data/global-search.ts` for the app re-filter, both pinned by the whitespace/word-order tests in `global-search.test.ts`. Per-word LIKE escaping keeps `%`/`_`/`\` literal (008). Phone digit matching is unchanged.

**Consequence:** Search is forgiving about word order and whitespace, not about content — a query word that appears nowhere still kills the match ("peter jackson" finds nothing). Dirty stored whitespace no longer hides records, but it's still dirty; if it ever bothers a display surface, clean the data, don't loosen matching further. The 008 rule stands: SQL and app matching change together or not at all.

## 028 — Moving a seat on a signed contract is the Admin's alone, and says what it does first

**Date:** 2026-09-16

**Context:** The seats on a signed contract stay editable so the office can fix a wrong one (026), but a swap does two things at once that nothing on the panel said: the old rep's commission line leaves `/sales-commission` and moves to the new person, while the Estimates list and the document keep naming whoever sold the job (`effectiveEstimateRepId` freezes at signature, deliberately). An owner swapped a seat expecting a rename and got a pay restatement plus two screens that now disagree about the same contract — then asked for exactly this: leave the frozen column alone, restrict the swap. There was also a quiet gap: the panel's UI already gated editing to strict Admin (`canVoid`), but `saveSalesTeam` accepted Office (`isAdminRole`), so the API boundary was wider than the screen.

**Decision:** A pure gate, `seatChangeError` (`src/lib/data/sales-team-changes.ts`, tested beside), holds in `saveSalesTeam`: on a **Signed** contract, a save that changes *who* holds any seat (`sales_rep_1`, `sales_rep_2`, `closer_id` — filling one from empty counts, adding someone to the pay is a pay decision) requires strict Admin (`isStrictAdmin`); Office keeps shares and rates. Unsigned documents are not held. It is a hold on top of the existing Office-or-Admin gate, never a widening, enforced in the action for 024's reason — this is the only in-app path that edits these columns. In the panel, Save now asks first when seats would move (`window.confirm`), in plain words: pay moves to the new person, the document keeps its original salesperson, the change lands in history. The confirm compares against the team as last loaded/saved, so first-stamping an unseeded contract does not prompt.

**Consequence:** An Admin can still fix a genuinely wrong seat (someone must — including unwinding a swap), but now on purpose and on the record; Office cannot move pay through the API any more than through the screen. The audit fetch carries `status` for the gate and strips it before writing `old_team`, so snapshots stay the eight team columns. The recommended handoff is unchanged: seat both people with a split (026), don't swap.

## 029 — Background polls leave the Server Action path

**Date:** 2026-09-16

**Context:** Four components the `(app)` layout mounts on every page poll forever: popup alerts (20s), screen-share discovery (20s), the device heartbeat riding the activity tracker (30s), and the notification bell (60s) — a server round-trip roughly every 6 seconds per open tab. Each was a Server Action, and an action is not a cheap fetch: it re-runs the whole request pipeline including the layout (~1.5s, measured in `live-users-button.tsx`), and Next dispatches actions through a queue, so the user's own Save or Send sat behind an in-flight poll. With users keeping several CRM tabs open, this was the app-wide "keeps freezing" — separate from the 79k-lead payload that froze `/estimates` specifically. Two precedents had already left the action path for exactly this reason: `/api/activity/ping` (0-payload route handler) and the live-users button (poll only while its panel is open, seeded by the layout).

**Decision:** The four polls now ask thin GET/POST route handlers — `/api/popup-alerts`, `/api/screen-shares`, `/api/notifications`, `/api/device-touch` — that call the very same action functions server-side, so auth and RLS scoping are unchanged and the logic lives in one place. Additionally, the bell and share-discovery polls skip their turn while the tab is hidden and refresh on `visibilitychange` (a badge nobody sees and an offer nobody can accept don't need freshness); the popup watcher deliberately keeps polling hidden — it owns the tab-title unread count and the audible ding, which exist precisely for hidden tabs. The rule for future features: a recurring poll never ships as a Server Action; actions are for user-initiated mutations.

**Consequence:** A background tab now costs one cheap request every 20 seconds (popups) instead of four layout renders a minute, and a visible tab's polls no longer contend with the user's clicks for the action queue. The trade: a device revocation is noticed by a hidden tab on its next popup-poll-driven heartbeat rather than instantly — same one-heartbeat lag the feature always had.

## 030 — A dead portal link explains itself, and the co-owner can ask for their own

**Date:** 2026-09-17

**Context:** A sent estimate mails one real message to every recipient (#022) carrying one single-use portal link — so on a two-owner job, whoever opens it second gets "already been used" and, until now, a dead end: the verify route redirected to `/portal?error=<why>` and the login page dropped the param on the floor, showing the plain form with no explanation. Worse, the form's self-serve "email me a sign-in link" matched only `leads.email`, so the co-owner typing their own address was told "a link is on its way" and nothing ever arrived — the enumeration-safe reply masking a silent miss. The obvious alternative, minting a link per recipient, would mean one email per recipient, un-doing #022's deliberate single message where To/Cc see each other; and access is per-lead anyway (#005), so separate links buy no isolation.

**Decision:** Two small moves instead. (1) The login page now shows the dead link's reason with a pointer at the form below it (`portalLoginNotice`, pure and tested — "This sign-in link has already been used. Enter your email below and we'll send you a fresh link."). (2) `requestPortalLink` matches the second contact's email as a fallback after the lead's own, greeting the co-owner by their own first name; two indexed lookups rather than one `or()`, since the or-string syntax would need the typed email escaped against its own separators. The enumeration-safe posture is unchanged: every outcome that isn't a send failure reads "if that address matches a project, a link is on its way," and self-service still cannot reopen lapsed access — that stays the office's call.

**Consequence:** The two-owner "link already used" phone call becomes: read the sentence, type your email, click the fresh link — street-number challenge and per-lead access exactly as before. Free-typed extra recipients are deliberately not matched (they're not on the lead); the rep's Copy link / Send again covers them, noted in TECH_DEBT.

## 031 — Observability rolls out to the external-facing routes, and only those

**Date:** 2026-09-17

**Context:** `withRouteObservability`/`runObserved` existed with one real caller (`logCall`, the dialer's proving case — TECH_DEBT). Meanwhile a Stripe webhook, an inbound text or email, a leadgen POST, or a nightly cron could fail with nothing but a stray `console.error`: no timing, no correlation id, no Sentry event — "payments stopped posting" would have been an afternoon of guessing.

**Decision:** Wrap every external-facing route: both Stripe webhooks (the per-company one calls `runObserved` directly — the wrapper's signature can't pass a dynamic segment through), the SMS and inbound-email webhooks, the leads and Meta leadgen webhooks (verify handshake included), and all six cron jobs. `sendEmail` logs and captures its own failures, since callers turn them into a quiet on-screen note or, on a cron, into nothing. Deliberately excluded: the poll routes (`popup-alerts`, `notifications`, `screen-shares`, `device-touch`, `activity/ping`, `version`) — they fire every few seconds per open tab, and a "completed" log line per poll buries every signal worth reading; they stay observable the way `/api/activity/ping` chose at birth, by doing almost nothing. Server actions beyond `logCall` are the next slice, logged in TECH_DEBT.

**Consequence:** Every webhook and cron run now has a duration, a correlation id, and — when it throws — a Sentry event with the redaction guarantees of `src/lib/observability/redact.ts`. The known soft spot is routes that catch their own failure and answer 200 so the sender stops retrying: those report "completed" and keep their inner `console.error` for now.

---

## 032 — Chip colors state money direction, not document type

**Date:** 2026-09-17

**Context:** The Projects row chips all wore one teal "document" color — Bills, Contract, Change orders, Permits & contracts and Report alike — so a row read as a wall of identical pills. The owner asked for colors that carry meaning ("$ in green, $ out red") and a shape that's scannable.

**Decision:** Chips are colored by what they mean, with green and red reserved for money direction: the contract and its change orders are green because they *are* the money coming in (not "documents"), + Bill and Bills are red (money out), and every other idea keeps one color — blue checklist, indigo paperwork pile, purple photos, rose client, slate report. Chips cluster by meaning (progress → money in → money out → records) in a wrapping flex row, replacing the dot-separated text line. The mapping is one pure, tested module (`src/lib/job-chips.ts`) that both the office table and the crew cards read; the standing rule for any future chip row lives in `.claude/skills/semantic-chips/SKILL.md`.

**Consequence:** A future chip picks its meaning before its color: money-touching chips take their direction's green or red, nothing else may take those two (the checklist's done fill and overdue alarm stay the grandfathered exception), and new chip surfaces read `jobChipClass` instead of hardcoding classes so the views can't drift.

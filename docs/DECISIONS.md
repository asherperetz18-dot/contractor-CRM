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

## 032 — Commission payouts are a ledger, netted per rep

**Date:** 2026-09-17

**Context:** The rep commission report computes earned and payable live from the contracts (0086/0153), but nothing recorded that a rep was actually *paid* — a qualified commission read "payable" forever, and the only thing separating paid from unpaid was the statement's date range, which breaks the moment pay runs late, partial, or early. Advances — money handed over before a job settles, routine on long jobs — had no home at all, so at settlement the statement asked for the full share again: a double payment waiting to happen.

**Decision:** One ledger, `rep_commission_payouts` (0158): every payment to a rep is a row — amount, the day it moved, an optional job, `kind` payout|advance, `recorded_by`. An advance is deliberately just a payment with a label, not its own scheme: it deducts like any payment, and the label exists because a statement must be able to say "less advance". Balance due is computed **per rep** — payable less paid, floored at zero, any excess shown as "advanced ahead" and netting against that rep's next qualifying job — and **never across reps**: `balanceTotals` sums per-rep dues, because netting one rep's advance against another's wages prints a payroll short (pinned in `commission-payouts.test.ts`). The statement closes like a bank statement — carried in + came due − paid = balance — per rep, with the same no-cross-netting rule on the all-salespeople print. Rows are insert-and-delete only (no update policy; a mis-key is removed and re-recorded, the manual-customer-payments discipline). Until the migration runs, the ledger reports itself not ready via a probe query — `selectAll` flattens errors into an empty list, and a missing table must read as "not set up", never "no payments" — and the page and statement render exactly as before.

**Consequence:** `/sales-commission` now answers the payroll question it is opened for — Paid out and Balance due cards, a per-salesperson balance table, and a Payments & advances ledger — and the printable statement ends in the number to actually write the check for. The trades: removing a ledger row leaves no trail, and the dispatcher scheme still has no payment tracking (both in TECH_DEBT).

## 033 — A partial payment leaves the rest of the invoice owed, everywhere

**Date:** 2026-09-17

**Context:** `phaseState` called a phase "paid" the moment ANY settled payment was filed to it, whatever the amount. Recording a partial payment — which `recordManualPayment` deliberately allows (warnings, not refusals) — made the remainder vanish from the Payments page: the phase moved to the Paid list and "Billed, Unpaid" dropped it entirely, while Projects' "Owed to you" and Money to Collect (per-phase remainders, #001) kept counting it. On the live book that read $61,400 against $66,000 with nothing explaining the $4,600 — a real invoice remainder nobody was being told to chase. The customer portal told the customer the same lie: "Paid" on an invoice they still owed money on.

**Decision:** `phaseState` is amount-aware, with a new `partial` state ("Partially paid"): paid means the settled money covers the amount; clearing means money in flight covers the remainder (a token pending payment no longer hides lateness); a partially paid phase past its due date is overdue, because the remainder is late. The Billed, Unpaid and Overdue cards sum `phaseOwedCents` — the identical per-phase remainder `phaseReceivableCents` sums for Projects — pinned equal in `src/lib/data/phase-state.test.ts`, so the two pages can only ever say the same number. Money still clearing stays on Billed, Unpaid until it lands (the Clearing card names what is in flight). Billed phases on documents that are no longer live signed contracts are dropped from the page, matching Projects' refusal to count a cancelled job's bills.

**Consequence:** A partly paid invoice reads "Partially paid" with its remainder on Payments, the contract schedule and the customer portal, and the remainder stays on the cards until settled. The portal shows no Pay button on such a phase — checkout only knows how to charge the full face amount (see TECH_DEBT: portal remainder checkout).

---

## 034 — Chip colors state money direction, not document type

**Date:** 2026-09-17

**Context:** The Projects row chips all wore one teal "document" color — Bills, Contract, Change orders, Permits & contracts and Report alike — so a row read as a wall of identical pills. The owner asked for colors that carry meaning ("$ in green, $ out red") and a shape that's scannable.

**Decision:** Chips are colored by what they mean, with green and red reserved for money direction: the contract and its change orders are green because they *are* the money coming in (not "documents"), + Bill and Bills are red (money out), and every other idea keeps one color — blue checklist, indigo paperwork pile, purple photos, rose client, slate report. Chips cluster by meaning (progress → money in → money out → records) in a wrapping flex row, replacing the dot-separated text line. The mapping is one pure, tested module (`src/lib/job-chips.ts`) that both the office table and the crew cards read; the standing rule for any future chip row lives in `.claude/skills/semantic-chips/SKILL.md`.

**Consequence:** A future chip picks its meaning before its color: money-touching chips take their direction's green or red, nothing else may take those two (the checklist's done fill and overdue alarm stay the grandfathered exception), and new chip surfaces read `jobChipClass` instead of hardcoding classes so the views can't drift.

## 035 — Project net cash counts the rep's cut — the cash actually paid

**Date:** 2026-09-17

**Context:** The Projects page said a complete job "kept" collected minus spent, with the salesperson's money still inside that figure. The first cut of this decision subtracted the *projected* commission (the live share-of-net-profit calculation) — and the owner immediately hit its failure mode: a $20,000 job with $221 of costs recorded showed $8,389 of "commission" and a net cash of −$7,618, because a projection on a barely-costed job is a share of the whole contract, not of its margin. The owner's correction, same day: "only commission paid or advanced paid should be here."

**Decision:** Projects is a cash view, and its commission figure follows the page's own rule (the one that keeps unpaid bills beside Spent rather than in it): the **Commission paid** column and the net-cash deduction count only money that actually left — payouts and advances recorded in the payout ledger (`rep_commission_payouts`, 0158) against that job, summed by `paidCommissionByEstimate`. `computeProjectRollup` keeps its optional `commissionCents` input (null = caller doesn't track it, e.g. the single-project report with its client view, where pay never prints), and `netCashCents` subtracts it. What is merely *owed* stays on `/sales-commission`, whose whole job is owed-vs-paid per rep. A ledger payment tied to no job appears on no project row — it cannot honestly land on one — and a cancelled job's advance still shows, because that cash is still gone. If migration 0158 hasn't run, the ledger select errors, `selectAll` returns `[]`, and every row shows a dash and deducts nothing — the pre-ledger page.

**Consequence:** Net cash on Projects means "cash in minus cash out" all the way through — a job reads negative only when more money has actually left than arrived. The trade: a finished job whose commission is due but unpaid shows full net cash here until the payment is recorded; recording it (Sales Commission → Record payment, tied to the job) is what moves both pages at once.

## 036 — Projects shows both bases: net cash beside net accrual, and the red fires on accrual

**Date:** 2026-09-17

**Context:** With commission moved to cash basis (#035), the Projects page was purely "money that moved" — and its red warning only fired once cash had actually left. The owner's next call, on the live book: unpaid bills should get their own column next to Spent, an accrual net should sit next to net cash, and a job should "still get the red warning even if bills are not paid yet" — while unpaid rep commission stays out of the accrual figure, "since its just estimate till all expenses are put in project".

**Decision:** Two additions, one rule. The "Bills unpaid" column promotes what was a note under Spent into its own figure (money committed, not yet out — still never inside Spent). "Net accrual" = net cash − unpaid bills (`netAccrualCents`), and deliberately nothing else: bills are committed numbers, a projected commission is not — commission only ever enters either net when actually paid (the 0158 ledger, #035). Everything red now keys off the accrual figure: the Bleeding chip (relabeled "Negative net"), the triage order (`projectTriageOrder` now takes the rollup plus unpaid bills), the warning panel, the accrual cell's red, and the Net accrual total card — which, by the owner's follow-up call, took the "New this month" card's seat beside Net cash (that count stays on its chip); the Net cash card goes red on cash alone, since each card now carries its own basis. The printable projects report prints the same accrual line per job and in its totals. `project-filters.ts` gained its first runtime import and therefore imports `types.ts` by relative path with extension — node's test runner resolves no `@/` aliases.

**Consequence:** A job sitting on $700 of collected cash and $6,000 of filed-but-unpaid bills reads red today, not on the day the bills get paid; a rep's not-yet-paid commission never fakes a loss. The trade: the single-project report and Profit & Loss still know neither figure (TECH_DEBT, unchanged).

## 037 — The AI assistant streams from a route handler and reads only what its viewer could

**Date:** 2026-09-18

**Context:** The assistant chat was a Server Action that saw leads, two weeks of appointments and open tasks — nothing else — and returned its whole answer in one lump, so the person watched "Thinking…" for the full generation. The ask: let it answer about estimates, projects, money and calls, stream the reply, and get cheaper on follow-up questions.

**Decision:** The chat moved to `POST /api/ai-assistant`, a streaming route handler — an action buffers its whole return and re-runs the layout per call (#029's reasoning, applied to a chat turn). The wire is NDJSON, one JSON event per line (text delta, proposals, error, done): SSE was out because EventSource can't POST a chat history, and a bare text stream was out because proposals and errors are data, not prose. Context sections follow the same gates as the pages they mirror — estimate figures behind `canViewEstimates`, receivables behind `canViewFinancials`, project rows dollar-free without estimate access — layered on top of the caller's own RLS session, which every query runs under (no service role anywhere on the path). Project figures come from `buildProjectCards`, the same rollup the Projects board and the printable reports read, so the assistant cannot quote a third version of a number. Every summary is computed over all rows while detail lines stay capped — the 1000-row lesson, already relearned once on lead counts. The Anthropic call carries two prompt-cache breakpoints (static instructions, then the data block), so a follow-up in the same conversation re-reads the unchanged prefix at cache price instead of paying the full input rate per turn; the section building itself is a pure module (`assistant-context.ts`) so the gating and the totals-vs-caps rules are pinned by tests without a database.

**Consequence:** Replies render as they generate; a Field user's assistant is exactly as money-blind as their screens; three questions in a row cost roughly one question's input plus deltas. The trade: the whole context is re-fetched from Postgres on every question (see TECH_DEBT).

## 038 — Assistant voice rides the browser's own speech engines

**Date:** 2026-09-18

**Context:** Step 2 of the AI chat & voice plan: a rep in the truck should be able to ask the assistant "what's my next appointment" without typing, and optionally hear the answer — at no per-minute cost and with no new vendor account, per the owner's plan discussion.

**Decision:** Both directions use what the browser already carries. Input is the Web Speech API — feature-detected, so a browser without it never renders the mic and the typed chat is unchanged; a tap toggles listening rather than press-and-hold (hold fights both phone screens and accessibility); the interim transcript fills the input as it's heard so the person sees what the mic thinks; and the question auto-sends on the final transcript, because hands-free is the entire point — while typing or a manual Send aborts capture, keeping the keyboard the path that always wins. Output is `speechSynthesis` behind an explicit 🔊 opt-in, off by default and remembered per browser through the same external-store shape as the funnel-order prefs (the lint rule against setState-in-effect pushed the honest design). Replies are reshaped for the ear first (`speakableReply`: bullets to sentences, blank lines collapsed). Recognition failures never show a raw code: a blocked mic names its fix, silence and a self-tapped stop say nothing (`micErrorMessage`, tested). The transcript-assembly, error-wording and speech-reshaping logic is a pure module (`src/lib/voice-input.ts`) with the browser glue typed there too, since TypeScript's dom lib carries SpeechSynthesis but not SpeechRecognition.

**Consequence:** Voice works today in Chrome, Edge and Safari (iOS included) for $0 and zero setup; recognition accuracy and engine privacy are the browser's own (Chrome's engine may process audio server-side, as with dictation anywhere in the browser). If job-site noise proves too much for it, the upgrade path is a server-side transcription service behind the same `mergeTranscript` seam — logged in TECH_DEBT.

## 039 — A policy never subqueries another RLS table inline — cross-table grants go through security definer helpers

**Date:** 2026-09-18

**Context:** The day 0152 ran, every appointment save died with `infinite recursion detected in policy for relation "events"` — nobody could change a time, drag a visit, or confirm one; booking and deleting still worked, which made it look like a form bug rather than what it was. 0152 had written the appointment-seat grant into `leads_select` as an inline subquery on `public.events`. A subquery inside a policy expression runs under the referenced table's own RLS, and `events` has carried the mirror image since 0090: `events_update_dispatch` reads `public.leads` inline. Expanding an events UPDATE therefore opened leads, whose policy opened events again — a cycle Postgres refuses at rewrite time, before any row is touched, for every role including Admin (all permissive policies expand regardless of which branch would pass).

**Decision:** Cross-table reads inside a policy go through `security definer` functions, never inline — the rewriter treats the function as opaque, so no cycle can form. 0159 applies that to the edge 0152 created: the events clause moves into `current_appointment_lead_ids()` (the exact shape of `current_setter_lead_ids`, 0108), and `leads_select` is restated verbatim otherwise. The events-side inline read (`events_update_dispatch`) is deliberately untouched: those policies carry hand edits made in the live database (0148's lesson), one broken edge is all a cycle needs, and with every leads policy function-routed it is inert (logged in TECH_DEBT). The invariant is pinned by `lead-visibility-rules.test.ts`: the newest `leads_select` statement must name no raw `events` and must go through the helper, and the helper must stay security definer with both chairs.

**Consequence:** Appointment saves work again once 0159 is pasted; the grant itself is unchanged — same two chairs, same leads. The standing rule for every future policy: a grant that needs another table's rows gets a `security definer` function, even when inline "works today" — whether it recurses depends on the *other* table's policies, which the migration adding the clause never sees.

## 040 — The AI receptionist is turn-based on the company's own Twilio, not a voice-agent vendor

**Date:** 2026-09-18

**Context:** Step 3 of the AI chat & voice plan: a missed call is a lead dialing the next roofer, so when nobody can pick up, an AI should answer, collect the details, and file the lead. The two obvious builds both wanted new infrastructure: voice-agent platforms (Vapi/Retell) mean a second vendor account and per-company setup that fights the bring-your-own-Twilio model, and Twilio's full-duplex ConversationRelay needs a WebSocket server Vercel cannot host.

**Decision:** Turn-based on what already exists: Twilio `<Gather input="speech">` transcribes the caller, Claude (claude-opus-5, effort low) writes the next line, `<Say>` with a Polly neural voice speaks it — plain signature-validated webhooks on Vercel, per-company Twilio accounts, no new vendor, no new server. It takes over exactly where voicemail lived: the no-forwarding-number branch and the nobody-answered dial callback, gated by a per-company toggle that defaults off (0160), so no company's phone changes until its owner flips it. The conversation policy is a pure tested module: the model must answer in one-line JSON and a hardened parser turns anything else into a polite re-prompt, a turn budget (10 replies) bounds every call, silence gets one nudge then a goodbye, and the fixed first sentence always discloses the AI and the transcription — no setting removes it. Pricing and firm appointment times are hard-refused by prompt; the callback promise is the product. Filing reuses the house plumbing end to end: caller matched by number (`leadForPhoneNumber`) or created through the same race-guarded `create_lead_for_unknown_caller` RPC as CallRail (plain-insert fallback until 0129 runs), a 🤖 `lead_notes` transcript note, the `call_logs` row flipped to "AI Receptionist", and the confirmation SMS from the company's own number. Because Twilio sends no webhook when a caller hangs up mid-`<Gather>`, finalize has three layers: `after()` on the goodbye turn (instant), a sweep on every inbound call, and a 2-hourly GitHub-Actions cron as the floor — not a tighter schedule, because each Actions run bills a full minute and a */15 sweeper alone would eat the plan.

**Consequence:** A pilot is one toggle on one company, $0/month idle and pennies per answered call, and every failure mode degrades to today's voicemail or a spoken apology — never a dead line. The trades, logged in TECH_DEBT: two-to-three-second pauses between turns and no barge-in (the ConversationRelay/WS build is the upgrade when the pilot proves out), a mid-call hangup's lead can wait up to ~2 hours on a quiet line, one fixed English voice, and Twilio ASR quality on bad connections.

## 041 — The leads webhook answers GET, because dialer web-form buttons can't POST

**Date:** 2026-09-18

**Context:** The owner runs ViciDial for cold-call campaigns and wanted its agents to push a live call into the CRM as a lead. ViciDial's integration surface is a URL, not a request builder: the campaign "Web Form" button opens the configured address in the agent's browser with the lead's fields appended to the query string (`phone_number`, `first_name`, `last_name`, `address1`/`city`/`state`/`postal_code`, `comments`, …), and the background "Dispo Call URL" fires the same shape when a call is dispositioned. Both are plain GETs. The existing `/api/leads/webhook` was POST-only, so there was no URL that ViciDial could be pointed at.

**Decision:** The same endpoint now exports a GET handler — a deliberately non-RESTful mutating GET, gated by the same `?key=` company-secret lookup as the POST, so an unkeyed crawler hitting the bare path changes nothing and learns nothing. Field mapping moved out of the route into a pure tested module (`src/lib/webhook-lead.ts`) shared by both methods, extended with ViciDial's field names as aliases (`phone_number` already existed; `comments` → notes; `address1`+`address2`+`address3`+`city`+`state`+`postal_code` compose into `address` when no `address` is given, empty strings skipped since ViciDial sends blanks as `""`). The POST's JSON contract (`ok`/`id`/`alerted`, same error codes) is unchanged; the GET answers small HTML pages because its reader is the call-center agent whose browser just opened it, not a program. Source isn't inferred — the printed recipe appends `&source=Vicidial` explicitly.

**Consequence:** Any URL-only integration (ViciDial web form/dispo, other dialers, QR-style links) can now inject leads with zero middleware, and the new-lead SMS alert fires the same as for POSTed leads. The trade: a GET that writes means a preview-fetcher given a full keyed URL with lead fields would file a lead — acceptable because the URL is a secret to begin with, and the alternative (a bridge server to turn ViciDial's GET into a POST) is exactly the infrastructure this app keeps refusing to run.

## 042 — The web-form button gets a check-and-save form; the dispo URL keeps saving on sight

**Date:** 2026-09-19

**Context:** #041 made the ViciDial web-form button inject leads by GET, saving the instant the agent's browser opened the link. That leaves the agent no moment to use what the call just surfaced — the real spelling of the name, a second number, the project type, a dollar figure — even though they are the one person looking at the lead while it is still a conversation. But the same GET is also what ViciDial's Dispo Call URL fires in the background, where nobody is present to press anything: making the GET always render a form would have silently ended dispo injection.

**Decision:** The mode is the caller's choice on the URL, not a guess: `&review=1` renders a check-and-save form pre-filled from whatever ViciDial appended, and without it the GET saves on sight exactly as before (the settings page prints the `review=1` recipe for the Web Form field and the plain one for Dispo Call URL). The form is deliberately dumb HTML — no script, inline styles — because it renders inside ViciDial's iframe under the app's CSP, and it submits through the same POST door as every other source with `respond=html` switching that door's answer from JSON to a page; one insert path, no second writer. Its project-type dropdown is the company's own `project_types` list (fetched by the already-authenticated admin client; a failed or empty read degrades to a free text input). Alongside, the mapper now fills the columns the lead form always had: `postal_code`→`zip` (its own column, no longer glued into the address string), `alt_phone`→`phone2`, and `phone3` — cold-list contacts carry multiple numbers, and the caller matcher reads them.

**Consequence:** Agents shape the lead while the call is live instead of office staff re-editing "Unsorted" strays later, and dispo-fired injection keeps working unchanged. The trade: the form is one fixed set of fields, not the CRM's whole lead form — stage, assignment, and costs stay office work by design — and a browser with the form left open can save the same lead twice, same as clicking WEB FORM twice today; the webhook has never deduplicated.

## 043 — The AI receptionist books in pencil: a real event, unassigned and unconfirmed

**Date:** 2026-09-19

**Context:** The receptionist collected a callback window and stopped there — booking was deliberately out of v1, because at 9pm the AI cannot see which crew is free Thursday and a promised slot nobody can honor is worse than none. The owner asked for direct booking on the call.

**Decision:** It books, but only in pencil, and only through the machinery that already exists. When the caller agrees to a concrete day (resolved against the company's own timezone — the prompt and the extraction both carry "today is …", because at 11pm Pacific the server and the company disagree about what day it is), finalize creates a normal `events` row: `event_type` "Estimate", status left at New, `customer_confirmed` false, **`assigned_to` null** — the dispatcher assigns who drives out, exactly like a hand-booked visit — and the lead advances to Appointment Scheduled from the same `PRE_APPOINTMENT_STAGES` rule as `bookAppointmentForLead`. The confirmation text says "penciled you in … reply YES to confirm", a promise the SMS webhook already keeps: it matches a YES from the lead's number to their appointment and `applyCustomerConfirmation` flips status to Confirmed. On the call the AI still never claims to have checked a calendar; `appointmentFromExtraction` (pure, tested) refuses the past, anything past 60 days, and parks absurd hours at 10:00 — the day is the commitment, the clock is a suggestion the office confirms anyway. No availability check on purpose: that needs per-crew calendars, hours and slot rules, and the pencil-plus-confirm loop makes a wrong guess cost one text instead of a double-booked crew.

**Consequence:** A missed after-hours call can end as lead + appointment on the calendar + confirmation text with zero human touches; the office's whole job is assigning the rep. The trades, in TECH_DEBT: reminder texts only start once a rep is assigned (the reminder cron requires `assigned_to`), and a company that never works Sundays can still be penciled for one — the confirm step is the net for both.

## 044 — Transfer-to-a-human resumes the AI on no-answer; pickup time reuses the column that already existed

**Date:** 2026-09-20

**Context:** The owner wanted two receptionist controls: how long a call rings his phone before the AI picks up, and a way for a caller to reach a live person once the AI has answered. The ring time already existed as `company_profile.call_forward_timeout` — it is the `<Dial timeout>` on the forwarded leg, and the AI takes over precisely when that Dial rings out — so inventing a second column would have created two numbers fighting over one behavior.

**Decision:** Pickup time is the same column surfaced on a second page (the social-links precedent: one source of truth, two doors) — the AI Receptionist panel shows it with an "≈ N rings" hint (`approxRings`, ~5s per ring) and names Company Profile as the other door. Transfer is one new nullable column, `ai_receptionist_transfer_number` (migration 0161, blank = off). Mid-call the model's turn JSON gains `"transfer": true` — the prompt offers it only when the number is configured, proactively on emergencies — and `<Gather input="speech dtmf">` also accepts a pressed 0 as the same intent, no AI judgment needed. Either path returns `<Say>` + `<Dial timeout=25 action=/api/voice/ai/transfer>`; the action webhook is the safety net: answered means a human finished the call (hang up, file the session), anything else re-`<Gather>`s with "couldn't reach anyone — let me take your details", so a failed transfer lands the caller back with the AI, never on a dead line. Both branches append plain-text markers to the session turns so the filed 🤖 note shows the hand-off attempt.

**Consequence:** An urgent caller can reach a person when one is reachable, and still ends as a filed lead when one isn't; the owner tunes rings-before-AI from either page and both stay in sync because there is only one number. The trades: DialCallStatus "completed" is trusted as "a human handled it" — a transfer answered then instantly hung up still ends the AI session (the transcript note shows the attempt, and the caller can ring back); and the transfer number is dialed as given, with no is-it-really-a-human validation beyond E.164 normalization.

## 045 — The dashboard is one reduced call, and its clock arrives as parameters

**Date:** 2026-09-20

**Context:** The old dashboard paged every open lead through the server on every load (~72k rows) just to sum one headline figure, and showed no trends, no money, no team — while Dashboard 2.0 needs a dozen aggregates (KPIs with deltas, a 12-month series, funnel, stages, sources, receivables aging, team, calls, production) over a user-picked date window. Computing "today", the window, the comparison window and the touch cutoffs in two places (SQL and TypeScript) is how two halves of one feature drift apart.

**Decision:** One `dashboard_rollup` function (0162, `security invoker` so RLS scopes it exactly like the page's own fetches), returning everything as jsonb — with **every clock-dependent edge passed in as a parameter**: `rollupBoundaries` computes today, from/to, the previous window, the 30/60/90-day cutoffs, the month floor and the 14-day call strip start once in TypeScript, and both the SQL and its pure, tested mirror (`buildDashboardRollup`, the 0156/0157 posture — also the fallback until the migration is pasted) consume the same dates. Deltas compare month-to-date against the same span of last month, and any other window against the equal span right before it (`prevWindow`, pinned in tests). The funnel is the window's cohort — of leads created in it, who got an appointment, saw a contract, signed — and a sale everywhere means a signed true contract, the Marketing Analytics rule. The receivables buckets run the Payments page's own phase math (`phaseState`/`phaseOwedCents` imported, not re-implemented). Panel arrangement rides `profiles.dashboard_panel_order`, the #010 pattern exactly.

**Consequence:** Once 0162 runs, the dashboard costs one aggregate call instead of a book scan, and every graph agrees with the page it links to because the rules were imported rather than approximated. Until then the fallback computes identical numbers the slow way (TECH_DEBT). The SQL can never disagree with its mirror about what day it is, because neither owns a clock.

## 046 — Dashboard pipeline-by-stage counts leads worked recently, with the cutoff a visible choice

**Date:** 2026-09-20

**Context:** The old headline pair — "72,412 open leads / $4.4M pipeline" — counted every lead ever imported that wasn't Won or Lost. At a 79k-contact book that number never moves and means nothing, yet it read as the state of the business.

**Decision:** The stage panel buckets open-stage leads by `updated_at` (maintained by the leads trigger, so any edit or stage move counts as "worked") under a dropdown the owner asked for: worked in the last 30 / 60 / 90 days (default 90) or all open. All four buckets come back in the same rollup, so switching is instant with no refetch. The old open-leads/pipeline-value headline cards are gone in favor of this panel plus the window-scoped KPI row.

**Consequence:** The pipeline figure can finally be believed — and the old reading is still one dropdown away under "All open leads". The trade: `updated_at` is a proxy (a bulk edit "works" a lead; a call logged without touching the row doesn't), accepted for being trigger-maintained and index-cheap rather than inventing a new activity column.

## 047 — The receptionist's live turns run on the fast model; the paperwork keeps the big one

**Date:** 2026-09-20

**Context:** The owner test-called the receptionist and found the pause after each thing he said noticeably long. The pause has three parts — Twilio finalizing speech-to-text (~a second, a floor), the model turn, and TwiML/TTS start (negligible) — and the model turn was the only big, controllable part: every live turn ran on claude-opus-5, whose adaptive thinking and generation speed are priced for depth, not for someone standing in a kitchen holding a phone.

**Decision:** Split the one MODEL constant in the engine. `TURN_MODEL` is `claude-haiku-4-5` — the live turns are exactly the guardrailed, short-JSON work a small fast model handles (strict turn contract, hardened parser, fixed disclosure, turn budget), and Haiku takes no effort/thinking parameters, so the turn request sends none (`output_config.effort` is an API error on Haiku). `EXTRACT_MODEL` stays `claude-opus-5` (effort low): extraction runs at finalize, after the hangup, where nobody is waiting and getting the name/address/appointment right matters most. Nothing else changed — same prompts, same parsers, same budgets.

**Consequence:** The between-turns pause drops by roughly the model's share of it (the Twilio STT second remains), and on-call tokens cost about a fifth of before. The trade: a smaller model on the conversation. If call quality ever reads as less sharp, the dial is one line — `TURN_MODEL` to `claude-sonnet-5` buys most of the quality back while staying far faster than Opus; going all the way back to Opus is the same one line.

## 048 — Emptying a pipeline stage is a hard delete with the CSV as the backup

**Date:** 2026-09-20

**Context:** The imported cold-call book sits in one staging stage ("Rows Incoming", 66k+ contacts), and the owner wants to clear it out and keep a copy. The app's existing delete is per-contact and snapshots everything into `lead_trash` first — at one contact that's the safety net; at 66k it's copying the whole book into a second table one row at a time, and a single `DELETE` statement for the lot would blow the API's statement timeout anyway.

**Decision:** Settings → Pipeline Stages gets a per-stage contact count with two actions that belong together: "⬇ CSV" streams every contact in the stage as a download (a route handler, not an action — an action buffers its whole answer, and 66k rows is ~15MB; the headers match the CSV importer's so an export re-imports as-is), and "Delete all…" hard-deletes in id-batches through a resumable route (`/api/leads/stage-purge` deletes what fits in a ~20s budget, answers `{deleted, remaining}`, and the browser keeps calling until zero, with a progress line). No trash snapshots; the confirm says the contacts will NOT go to the Trash and points at the CSV button as the copy to take first. Both routes run as the signed-in user, so tenancy and the `leads_delete` policy are enforced by RLS on every batch — and a batch that deletes zero rows (RLS refusing quietly) stops the loop with an error instead of spinning. No migration: pure app code, nothing to paste into the SQL editor.

**Consequence:** An admin can clear a 66k-row stage in a couple of minutes from the same screen that manages stages, and the recovery story is the exported file, not the trash. The trade is real: someone who skips the export and confirms has no undo. That's why the action lives behind the Admin gate, spells out the exact count in the confirm, and sits right next to the export button it tells you to press first.

## 048 — A signed contract puts its job on the Production Board by itself

**Date:** 2026-09-20

**Context:** The Production Board starved while Projects filled up: a job only existed if somebody ran the pipeline's "convert to job" or typed one in by hand, so the board showed 1 job against a book of signed contracts. The moment work actually becomes real — a customer signing — created nothing.

**Decision:** `finalizeSignedEstimate` (shared by portal e-signature and signed-on-paper, so both doors behave alike) now creates a production job for a newly signed top-level contract: name and address prefilled from the lead (the convert-to-job naming), status Not Started, crew left unassigned — assignment stays a human call. One job per lead, checked before insert: a re-signed revision, a completion certificate, a change order, or a second contract on the same customer never stacks a duplicate card. The decision of *whether* a job is due and its shape is pure and tested (`src/lib/production-job.ts`); the wrapper never throws, because by then the signature is committed and a board hiccup must not read back to the customer as a failed signing — a create failure is logged server-side and the job can still be added by hand.

**Consequence:** The board reflects the real book from signature day forward with no new tables and no migration. Two boards deliberately coexist: Projects stays the money view (a signed contract and its rollup), Production stays the crew/schedule view (the `jobs` row that Calendar and Schedule already read), bridged by the card's "Open project" link and the `?focus=` deep link on Projects. Board summary cards follow the search and crew filters but not the clicked quick-card itself — the four cards must keep counting one shared list, or each would describe a different board.

## 049 — The Contract Board is a view, and its cards don't drag

**Date:** 2026-09-20

**Context:** The Contracts placeholder under Production needed to become a real module. The obvious build was a new `contracts` table and a drag-and-drop kanban like the leads pipeline. But a contract already exists in the schema — it is an `estimates` row with `kind='contract'`, and migration 0059's own comment on the `Signed` status says "this is a contract". The Estimates funnel and the Projects page already read those rows.

**Decision:** The board (`/contracts`) is a read-only view over the same rows: five columns (Draft / Sent / Viewed / Signed / Closed) derived with the funnel's `effectiveEstimateStatus`, no new tables, no migration. And unlike the leads pipeline, cards do not drag between columns. A lead's stage is an opinion, so dragging it is honest; a contract's status is evidence — `sent_at`, a customer's portal open, a signature with IP and timestamp — and a drag to "Signed" would fake a legal record. Status changes stay where the evidence is made: the document page (send, mark signed on paper, void).

**Consequence:** The board can never disagree with Estimates or Projects, and it shipped as pure app code. The trade: people who expect every board to drag will find these cards fixed; the card click opens the document where the real action lives, which is the explanation.

## 050 — Partnership sales: two reps hold the sale, the closer only ever follows it

**Date:** 2026-09-20

**Context:** A two-rep job had no honest shape. The second rep existed only as an appointment seat (`events.second_assigned_to`) — since 0152 they could open the lead, but the sale was never theirs: `leads.assigned_to` holds one name, the Salespeople grid tallies by that one name, and the 0153 seeding seats that one name on the contract's money. Meanwhile "Assigned To" confused the owner precisely because it was quietly doing three jobs (visibility, sale credit, commission seat one) while the appointment's "Second Assigned To" looked like it should do the same and did none of them. The user's rule, confirmed on a rendered mockup before any code: the sale lands on rep 1 + rep 2 as a partnership; the closer keeps the job on their record as a follower with their cut, never as their sale.

**Decision:** The partnership lives where ownership lives — on the lead. `leads.partner_rep_id` (0163) is the second salesperson, wired into the three places a seat means anything. (1) **Visibility:** partner joins both SQL lead-visibility rules and `leads_select` (pinned by the same test as every seat; the policy keeps the appointment grant behind `current_appointment_lead_ids()` — never an inline events subquery, which is the 0159 recursion). (2) **Sale credit:** `rep_lead_stats` and its TS fallback `repLeadStats` credit a partnership lead to both reps — each gets the lead and the Won notch, the value enters each row at half, so the grid's total never overstates what the company sold. Full-value-on-both was considered and rejected for exactly that reason. (3) **Money:** at signature the partner takes rep seat two at an even 50/50 split of the rep share (adjustable on the Sales Team panel after; `getSalesTeam` previews the same split pre-signature), and the closer's cut (0153) stays off the top, untouched. Seats stay mutually exclusive in both directions — a partner can't be named closer nor the closer partner (`setLeadPartner`/`setLeadCloser`), because one person in both rows would be paid from two different rules. The partner picker sits beside the closer's and offers the latest appointment's second chair as a one-click suggestion — suggested, never auto-set: a partnership moves money, so a person confirms it.

**Consequence:** The closer's distinction is now structural: partner = holds the sale (visibility + credit + rep seat), closer = follows it (visibility + own cut, zero sale credit) — and "Assigned To" reads as what it is, rep seat one. Won counts can sum across reps to more than the company's job count (one sale, two notches — deliberate); won *value* never does. The rep-report funnel still attributes leads by owner only (partner credit there is open, in TECH_DEBT); the appointment's second chair remains a per-visit seat that grants visibility but never money.

## 051 — One file preview for the whole app: hover peeks, click opens in place

**Date:** 2026-09-20

**Context:** Every screen that showed a stored file answered "what is this file?" differently: estimate attachments weren't clickable at all, lead files and job photos threw the user into a new tab, receipts had a hover peek (`PeekLink`) but its click also left the page, and each surface re-derived on its own what a file IS (a browser's `content_type` claim, backstopped by the extension) and WHERE it lives (a Drive file's `file_url` is the Drive viewer page — HTML, not pixels — while a bucket file serves itself). The owner's ask, from the estimate attachments panel: hover shows a preview, click shows the full thing, on any file or image in the CRM.

**Decision:** One component (`FilePreview`, `src/components/ui/file-preview.tsx`) wraps every rendering of a stored file: hover peek, click opens a full-screen lightbox in place — images draw themselves, bucket PDFs frame the browser's own viewer, Drive files frame `drive.google.com/file/d/<id>/preview` (the only embeddable form), videos play. A plain left click is hijacked on purpose; the browser's new tab survives as every modified click and as the lightbox's "Open in new tab ↗" link, so the escape hatch is never more than one gesture away. The what-and-where logic is pure and tested (`src/lib/files/preview.ts`); `PeekLink`/`ReceiptPeek` are deleted, `ReceiptThumb` rebuilt on the shared component. The report-only CSP gains `frame-src`/`media-src` for exactly these origins, so the previews are violation-free the day it enforces. Customer-facing paper — the estimate document the customer signs, the portal — keeps plain links: the lightbox is a staff tool, and that document also renders to print. The standing rule for future surfaces lives in `.claude/skills/file-preview/SKILL.md`.

**Consequence:** A rep deciding what the customer sees can check "contract (1).pdf" without losing the estimate they're editing, and every file behaves the same wherever it is met. The trade: a left click no longer opens a tab where it used to; people with that habit have the modifier click and the header link. Touch screens, which never had the hover, tap straight into the full preview instead of a tab.

## 052 — The P&L graphs reduce the statement's own ledger, and never draw a month that hasn't happened

**Date:** 2026-09-20

**Context:** The Profit & Loss page was five cards and two tables — correct, but it could not show a trend, where the money went, or which jobs carried the year. Adding graphs the obvious way (a second pass over payments, expenses and bills with its own date logic) is how a bar ends up disagreeing with the total printed under it, which is the fastest way to get a financial page distrusted. And on the sample data every job but three showed a 100% margin — not because the jobs were free, but because nobody had entered the receipts.

**Decision:** `profitLoss` was split into a `ledger` (every counted dollar, classified once by basis and window) and reducers over it; the statement reduces the ledger into jobs and vendors, and `profitLossByMonth` reduces the same ledger into month buckets. The basis rules live in the ledger and nowhere else, pinned by a test that every month bucket reconciles with the statement for that month. The month chart caps at the current month even when the window ("this year") runs to December — an empty bar for a month that hasn't happened reads as profit collapsing — and a single-month period shows no trend chart at all rather than one lonely bar. Chart colors are the app's own tokens (blueprint blue for money in, safety orange for money out, success green for what was kept), validated for color-blind separation on the white card; the green/orange pair sits in the warn band, so every panel also carries a legend, direct labels or a 2px surface gap, and net profit is a line while income and spend are bars. Red appears only for a genuine loss, never for an expense — the statement's existing rule. The job panel counts jobs with income and no cost and says so in plain words, because a perfect-looking chart of untracked costs is worse than no chart.

**Consequence:** A graph on this page cannot show a number the tables don't; adding a fourth reading of the ledger (say, by salesperson) is one more reducer, not a new date engine. The nudge about uncosted jobs is the page telling the owner the truth about its own inputs. Commissions are still not on the statement (TECH_DEBT), so net profit remains overstated by payouts until that line is added.


## 053 — The Settings crumb comes from the layout, not from each page

**Date:** 2026-09-20

**Context:** Eighteen settings pages carried a hand-written "⚙ Settings › Page" link back to the grid and twenty did not, Commission & Lead Cost Defaults among them — the owner landed on one and had no way back but the sidebar. A rule that says "remember the crumb" had already been forgotten twenty times.

**Decision:** `src/app/(app)/settings/layout.tsx` renders the crumb once for every route under `/settings/`, and nothing for the grid itself. The page name is read from the page's tile in `settings-catalog.ts` (the first tile when two share a route), so the crumb says exactly what was clicked and there is one list of settings pages, not two. A test walks the settings route folders and fails when one has no tile — the only thing a new page still has to remember.

**Consequence:** The eighteen hand-written crumbs are gone, and adding one by hand now shows two. A settings page missing from the catalog is unreachable from the grid *and* fails the suite, so it cannot ship quietly. The standing rule is in `AGENTS.md`.

## 054 — A send asks every gate before the message leaves

**Date:** 2026-09-20

**Context:** The approval gate (0136) is a database trigger on the status change, which is the right backstop: every path out of Draft hits it. But the email/text send changes the status *after* the message goes out, through the service-role client, and never read the result. With approval switched on and a document unapproved, the trigger refused the change, the customer already had the link, the sender's signature was recorded, and the document stood in Draft on the Contract Board as if nobody had sent it — twice, from two people, leaving two "Contractor" signatures on one contract. The link the customer held was turned away by the portal, which refuses Drafts.

**Decision:** The rule is asked in the server action first — `approvalHoldsSend`, a pure mirror of the trigger's condition, same as the closer's hold (#024) — before a message is sent or a signer row is written, and the estimate page hides the send controls behind the same hold note. The status write is checked, and a refusal is reported to the sender in words. The trigger stays. A send also replaces any earlier send-time contractor signature: one contractor stands behind one document.

**Consequence:** A held document can't be half-sent any more; the held person is told who approves. Existing half-sent documents need no SQL: approving and sending them again replaces the stray signatures and moves them to Sent. The trade is two extra reads on every send, on an action that already sends email.

## 055 — Signature evidence prints in the company's clock, labelled

**Date:** 2026-09-20

**Context:** The evidence line under each e-signature ("Signed Sep 20, 2026, 5:57 PM UTC · IP …") was deliberately UTC: the server cannot know what timezone the signer's browser was in, and an unlabelled local-looking time on a contract invites a dispute about which clock it was. In practice the owner read "5:57 PM UTC" under a contractor signature made at 10:57 AM in Los Angeles as simply wrong, and every party to these contracts is in the company's own market.

**Decision:** The line prints in the company's timezone — `company_profile.timezone` ("Pacific") resolved to an IANA zone with `companyIanaZone`, Pacific being the column's default — and always carries the zone label (PDT / PST), so the "which clock" question keeps its answer. The same clock drives the "signed 9/20/2026" date beside the party. Only the zone conversion is left to Intl; the label is still assembled by hand so an ICU upgrade can't reword evidence. UTC, labelled, remains the fallback when no zone resolves.

**Consequence:** The stored instant (`signed_at`, timestamptz) is untouched — presentation moved, the evidence did not. A customer signing from another timezone sees the company's clock with its label, which is unambiguous, rather than their own, which the server still cannot know.

## 056 — Marketing Analytics reads one revenue rule, attributes by cohort, and claims spend by the day

**Date:** 2026-09-20

**Context:** The analytics page carried two definitions of money on one screen: the headline tiles summed the pipeline value of leads at stage "Won" ($1.25M, 18 deals) while the source table credited only signed contracts ($498k, 8 sold). Ten "won" leads — a $600,000 one among them — had no contract behind them, and nothing on the page said so. Cost per lead read $375 on 96% of rows because migration 0089 stamps every new lead with the company default, so the two cost columns measured nothing; the one source that sold sat at row nine under a 2,871-lead cold list; and nothing showed direction, because the presets only re-sliced a total.

**Decision:** Money on this page is a signed true contract, everywhere, and the stage-based figure survives only as the count of Won leads with no contract — a flag on the win-rate tile that opens the list, because the gap is a to-do, not a second total. Attribution is the window's cohort (leads created in it, whatever happened since) for the tiles, sources, stages and latest contracts — the marketing question is what this period's leads turned into — while the team panel keeps the rep report's definitions (appointments, estimates and contracts dated in the window, credit by `effectiveEstimateRepId`), stated in its sub-line, so the three pages that describe a rep agree. Every range is served by one SQL function (`marketing_analytics_rollup`, 0164) with a tested TypeScript mirror as the fallback and the contract, the same shape as 0157/0162. Cost comes from entered spend per source per month (`marketing_spend`, 0165), which a window claims in proportion to the days it covers and never past today; without spend the page falls back to `lead_cost`, and when every priced lead carries the default it says "default" instead of a number posing as a measurement. Sources are ranked by signed dollars, then appointments, and the tail that produced nothing folds under one line; a per-source bought-list flag lets one chip remove purchased lists from every number at once.

**Consequence:** The tiles no longer match the old "Won value" figure, by design — the number that dropped was hope, not revenue, and the page now says where it went. Cost per lead and per sale are only as good as the spend entered in Settings › Lead sources; until then the tile shows an honest empty state. The `marketing_funnel_rollup` function from 0157 is no longer called by the app and can be dropped in a later cleanup migration. Changing an attribution rule means changing the builder, its test and the SQL together — never one of them.

## 057 — Lead cost by source is priced in the insert trigger, matched by name, in dollars

**Date:** 2026-09-20

**Context:** Every new lead was priced at the one company default ($375, 0089) unless somebody typed a figure, so a referral or a website enquiry carried the same lead cost on its contact card as a bought Facebook lead — and that figure feeds the card's Est. Margin, Lead Refunds, and the analytics fallback when no monthly spend is entered (056). The owner asked where to control what each source costs. There was nowhere — the company default itself had no screen and lived only in SQL.

**Decision:** `lead_sources.default_lead_cost` (nullable) is edited per row on Settings › Lead Sources, with the company default on the same page. The pricing stays in the 0089 trigger, extended to try the source's figure first: leads arrive by five paths and the trigger is the one place they all pass through, so no call site has to remember. Matched by source *name* (case- and space-insensitive) because `leads.source` stores the name, not an id, and renaming a source already repoints its leads. Blank and 0 are different answers — blank is "no figure of its own, use the company default", 0 is "free" — and `lead-source-cost.test.ts` pins that. The column is dollars, not cents, because it feeds `leads.lead_cost`, dollars since 0023 (TECH_DEBT). This is the per-lead figure; what a source cost in a month is `marketing_spend` (0165), which Marketing Analytics prefers — the two answer different questions and neither replaces the other.

**Consequence:** No code path prices a lead; the app only edits the two figures, and every intake path is covered including ones added later. Changing a source's price affects new leads only — what an existing lead cost is a recorded fact. Until 0166 is pasted the page still loads (the column reads blank) and a save says which migration to run.


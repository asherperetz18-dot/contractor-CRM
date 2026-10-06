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

**Consequence:** A partly paid invoice reads "Partially paid" with its remainder on Payments, the contract schedule and the customer portal, and the remainder stays on the cards until settled. The portal shows no Pay button on such a phase — checkout only knows how to charge the full face amount (see TECH_DEBT: portal remainder checkout). Since #144 the portal charges the remainder instead.

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

## 058 — Touch screens get buttons where a mouse gets a drag, and the no-zoom rule is `!important`

**Date:** 2026-09-20

**Context:** A phone-and-tablet pass over every route. Five settings tables (project types, lead sources, pipeline stages, call dispositions, calendars) could only be reordered by HTML5 drag-and-drop, which a finger on Android Chrome — and on an iPhone before iOS 15 — never triggers; the handle just scrolled the page and the order was frozen. Separately, the app-wide rule that sets fields to 16px on touch screens (so iOS Safari does not zoom in on focus and stay zoomed) used bare `select` and `textarea` selectors, which lose to `.field select` and `.field textarea` in `globals.css` and to the inline `fontSize` on the call-script and quick-text textareas — so most dropdowns and text areas in the forms were still zooming, and the rule stopped at 900px, missing every iPad in landscape.

**Decision:** Reorder buttons (▲/▼) go in the same cell as the grip and are shown only under `(pointer: coarse)`, where the grip is hidden; with a mouse nothing changes. They call the table's existing reorder action with the swapped id list (`moveInList`, pure and tested), never a second code path. The no-zoom rule is gated on `(pointer: coarse)` alone, with no width cap, and carries `!important` — the one place in the app it is the right tool, because the rule has to beat any selector and any inline style, and a form that zooms and stays zoomed is worse than a stylesheet purist's objection. Page-specific phone rules stay in `globals.css` next to the page; only app-wide rules go in `mobile.css`, as its header says.

**Consequence:** Order is editable from any device; desktop tables look the same. Every text field, dropdown and text area is 16px on a touch screen regardless of nesting or inline styles, so nothing zooms on focus. Anyone adding an inline `fontSize` to a field will not reintroduce the zoom.

## 057 — A sale is credited to the contract's Sales team seats, on every page that counts sales per rep

**Date:** 2026-09-20

**Context:** The office reported an $8,000 job sold by Frank showing under Simon on the new analytics team table. The contract's Sales team panel said Frank 100%, Simon in the second seat at 0%. Three answers to "who sold this" existed in the code: the rep stamped on the document at creation (`estimates.assigned_to` — whoever held the lead when the draft was raised, Simon here), the lead's current holder, and the panel's seats (`sales_rep_1/2` with their shares), seeded from the lead at signature and corrected by the office afterwards. Marketing Analytics, the rep report and the dashboard's team panel all read the first; commission is paid on the third.

**Decision:** A signed contract is credited to its Sales team seats: every seat with a share gets the sale, the dollars split by share (the Salespeople grid's partnership rule, #050); seats named without a share anywhere fall to seat one; a contract with no seats at all (signed before the panel existed) falls back to the stamped rep; the closer never takes the sale. One pure module, `src/lib/data/sale-credit.ts`, states this and is pinned by its test; migration 0167 re-creates `marketing_analytics_rollup` and `dashboard_rollup` with the same rule, and the rep report reads the module directly. Unsigned documents still follow whoever holds the lead, and voided ones stay with their stamped rep (`effectiveEstimateRepId` is unchanged). The Salespeople grid stays lead-based by design (#050): it answers "whose leads sold", the seats answer "who sold this contract", and at signature the two agree until the office says otherwise.

**Consequence:** Correcting a seat on the panel now moves the sale on the analytics table, the rep report and the dashboard the same way it already moved the commission line — and leaves the audit trail (#026). A rep's signed total can now be a share of a contract rather than a whole one, so per-rep totals still add up to what the company sold. `estimates.assigned_to` remains a fallback for pre-panel contracts only. Until 0167 is run, the two served functions keep the old credit while the TypeScript fallbacks already use the new one — one more reason the paste is not optional.

## 059 — The recording proxy passes byte ranges through, and the player is the app's own

**Date:** 2026-09-22

**Context:** A call recording on Call Reports could only be played from the start. The row rendered the browser's built-in `<audio controls>`, and beyond play its only control was volume: the timeline sat greyed out, and dragging it did nothing. The cause was the proxy at `/api/voice/recording/[id]`, which fetched the whole file from Twilio or CallRail and streamed it back as a plain 200 with no length. A browser seeks by asking for a slice (`Range: bytes=…`) and expecting a 206 with a `Content-Range`; given a 200 and no length instead, Chrome reports the file as unseekable and disables the bar, and Safari refuses to play it at all. The owner asked for a way to move forward in a call.

**Decision:** The proxy forwards the browser's `Range` header to the provider and returns the provider's status, `Content-Range` and `Content-Length` as-is, always advertising `Accept-Ranges: bytes` (`src/lib/recording-range.ts`, tested). `Content-Length` is dropped when the upstream body is compressed, because `fetch` inflates it and the count would lie. The row then renders the app's own player (`src/components/recording-player.tsx`): play/pause, explicit −10s/+10s buttons (a drag alone is hard with a thumb), a bar whose drag only moves the clock until release (the native `change` event is the seek, so a drag is one request, not one per pixel), a speed toggle and a download link, with the pure arithmetic in `src/lib/recording-controls.ts`. It keeps `preload="none"` — Call Reports renders thousands of rows and each player is a live fetch from the provider — and uses the logged call length to size the bar until the file's own metadata arrives, so a skip on an unplayed recording still lands ten seconds in.

**Consequence:** Seeking, skipping and speed work on both providers and on phones; a seek costs one small range request rather than a re-download. Anyone simplifying the proxy back to "fetch and stream" will grey the timeline out again — the range test is what says so. The volume slider is gone with the native control (the device's volume covers it). The contact card's Call History uses the same player, so the two places a recording plays behave the same.

## 060 — A rep's AI chat covers only their own book; desk roles keep the company

**Date:** 2026-09-22

**Context:** The owner asked whether the AI chat limits what it tells each role — specifically whether a rep sees only his own info. It didn't: every fetch was company-wide (faithful to the app, where Field reads the shared book), with only the money sections role-gated. A rep asking "what leads came in this week" got the whole company's answer, correctly but uncomfortably.

**Decision:** A viewer whose only roles are Sales/Field — or none at all, least data being the safe direction — now chats about their own records. `assistantRepScope` (pure, tested) makes the call; the route filters every fetch by it at the query, not after: the lead roster AND the every-row totals pass, events, tasks, estimates, checklist steps, and calls (by `rep_id`). Project cards can't filter at fetch (the rollup is one company-wide pass), so a rep keeps the cards behind their own documents or their own checklist steps — covering both a salesperson and a crew member with steps but no document access. The context opens with a VIEWER SCOPE banner naming the rep, the lead Summary stops claiming "company-wide", and the model is told to say the chat covers only their assigned records when asked beyond them. Any desk role — Office, Admin, Dispatch, Call Center, Bookkeeping, Production — keeps the full company view; proposal tools were already Office/Admin-only. Filtering at the query means the caps and summaries describe the rep's book, never a truncated company view (the "counted two thirds while sounding certain" lesson, applied per person).

**Consequence:** A rep's chat talks about their pipeline, their appointments, their calls — and says so out loud instead of posing as the company's books. The trade, filed in TECH_DEBT: this is a chat-scope rule, not a data wall. The app's pages still show a Field rep the shared book (RLS is unchanged), so the chat is deliberately stricter than the screen beside it; a real wall would be an RLS redesign of the shared-book model, done only if the owner ever asks for it app-wide.

## 061 — The server's "today" is the company's calendar day, never the machine's

**Date:** 2026-09-22

**Context:** The owner kept hitting timezone bugs and asked whether the Company Profile's six-zone dropdown needed more specific options. It didn't. Every option already mapped to a real IANA zone with correct daylight saving. The cause was that the app runs on Vercel, whose clock is UTC, and roughly three dozen server files asked that clock what day it was (`new Date().toISOString().slice(0, 10)`): the dashboard, daily brief, production and projects pages, project reports, the bell, the CSV import's fallback date, "due today" tasks from call logs and the portal, the AI assistant's windows, note stamps from CallRail and inbound email, the new-lead alert's daily cap. From 5pm Pacific every one of them was a day ahead of the office, so a task due today read as overdue after dinner and "today's appointments" moved a day. Only the reminder crons, the AI receptionist and rain alerts had been taught the company zone, one at a time, and the production board had been patched by letting the browser correct the date after load. Nothing recorded the rule, so each session rediscovered the bug.

**Decision:** One rule, in one place. `src/lib/company-clock.ts` (pure, tested) turns an instant into the company's calendar: `isoDateInZone`, `addDays`, `wallClockIn`, `localClockIn` (a Date whose local getters read the office wall clock, for the date-range helpers written against local time), `utcClockIn` (the naive-as-UTC encoding the crons already compared against), and `dayLabel` (a document or report date: a plain YYYY-MM-DD prints as itself, a timestamp prints on the zone's day). `src/lib/data/company-today.ts` knows which company is asking: `companyToday()` / `companyNow()` / `getCompanyZone()` for pages and actions with a signed-in user (one cached profile read per request), `todayForCompany()` / `zoneForCompany()` for webhooks, the portal and anything holding only a company id. Every server-side "today" now goes through these; `hasFollowUpDue` takes the day as a parameter rather than reading a clock. Server-rendered documents (the estimate document, its PDF, the project reports) print timestamps on the same calendar. `lib/timezone.ts` keeps its cron-facing API on top of the same primitive. The one real gap in the dropdown was Arizona, which keeps standard time all year and was an hour off under "Mountain" for eight months; it is now its own option (`America/Phoenix`), the list lives in `TIMEZONE_OPTIONS` beside `TIMEZONE_IANA` so the two cannot drift, and "Detect from address" maps AZ to it. `company_profile.timezone` stays a free-text label with the same default, so no migration.

**Consequence:** After 5pm Pacific the dashboard, brief, boards and reports agree with the reminders about what day it is. Adding a zone is one row in each of two lists in `types.ts` and nothing else. The rule for new code: a server file never slices `new Date()` to a date; it asks `companyToday()` (or `todayForCompany()` when there is no signed-in user), and N-days-out dates come from `addDays` on that. Client components keep the browser's clock, which is the company's in practice; the date-range helpers still read local time on purpose, because the browser is where most of them run. Follow-up, same day: Team Activity now runs on the company's clock end to end -- the page's first fetch starts at the company's own midnight (`dayStartInZone`), the view's presets, day buckets, fetch bounds and printed times all use the zone the page hands it (`isoDateInZone`, `dayEndInZone`, `localClockIn`) -- so an evening's work no longer files under tomorrow and the "Today" view opened after 5pm no longer starts at 5pm; and every "N days from now" date (progress-payment default, estimate expiry on send and revision, the receivable and completion-acceptance net-7 due dates) is now `addDays` on the company's today, so a bill sent after dinner is net 7, not net 8 (`defaultDueDate` takes the day rather than reading a clock). What remains, in TECH_DEBT: client components format in the browser's zone, which is the company's for an office team.

## 062 — Every poll is off the action path, a test says so, and the text badge is reduced in SQL

**Date:** 2026-09-22

**Context:** The owner reported the CRM "keeps freezing" again, six days after #029 moved the four always-mounted pollers to route handlers. Next runs every server action through a single queue in the browser — `dispatchAction` in `app-router-instance` appends to `actionQueue.last` and `runAction` only starts the next one when the previous resolves (a navigation jumps the queue; a click that is itself an action does not). Three timers and one keystroke path were still on that queue: the lead card's Texts tab asked two actions every 12 seconds while open, the topbar search asked one on every pause in typing on every page, and the presence panel refreshed through one while open. Separately, the one poll that had left the action path was the heaviest query in the app: the popup watcher's incoming-text count walked every `sms_messages` row of the last 30 days out of Postgres in 1000-row pages, every 20 seconds, per open tab — a cost that grows with every text the company sends and lands on the database every page shares.

**Decision:** The three remaining readers ask thin route handlers (`/api/lead-messages`, `/api/search`, `/api/live-users`) that call the same action functions server-side, so auth and RLS are unchanged; only sends and saves stay actions. The rule from #029 is now enforced rather than remembered: `src/lib/poll-routes.test.ts` reads every client component and fails on a `setInterval` whose callback — or a function it calls directly — invokes anything imported from `@/lib/actions/`. The text count moves into the database: `text_alert_rollup` (0168) returns the badge count, the watermark and the five newest popups in one round trip, `security invoker` so the caller's RLS scopes it, with a `(company_id, created_at desc)` index to serve it. Its reduction is a pure module (`src/lib/data/text-alert-rollup.ts`) whose tests pin both the buckets and the SQL's own text (the channel rule, the phone key, the cap), and which doubles as the fallback: until the migration is pasted, the action catches the missing-function error and walks the window through that same module — slower, identical numbers, the 0156/0157 pattern.

**Consequence:** No timer in the app can put a person's Send or Save behind it, and a new one written as an action fails the suite before it ships. Once 0168 runs, the most frequent query the app makes costs one indexed aggregate instead of a paged walk. The trade: the search and thread routes are two more thin files that exist only to be off the queue — the price of Next's action model, paid deliberately. What this does not cover, if freezing persists: opening a lead card still fires several panel loads as actions in sequence (view trail, duplicates, closer and partner context, then the tab's own load), and the Reply Inbox page ships every text ever sent (TECH_DEBT); those are the next candidates.

## 063 — Signed the paper, keep the paper: contract seats grant visibility that survives a reseat

**Date:** 2026-09-22

**Context:** A returning client's second job gets a new team — the office reseats the contact's Assigned Rep / Partner / Closer. The first contract's *money* was already safe (its Sales team is stamped at signature and reseating never restates it, #026/#028), but its *visibility* was not: a sales-scoped user's access to a contract rides on holding the contact, so the old team lost sight of their own signed contract, its payment progress, and the commission line still owed to them. Reps with an old appointment kept access through the 0152 appointment grant; a closer with no appointment seat lost everything. The alternative — per-job seats on every document — was considered and deferred: it would move send-gating, pickers and access onto each document, and sequential re-jobs (the actual case) don't need it.

**Decision:** A seat stamped on a contract's own Sales team (`sales_rep_1`, `sales_rep_2`, or its closer seat) grants the contract's customer exactly like a lead seat does (0169). One security definer helper, `current_contract_seat_lead_ids()`, added to both SQL visibility rules and `leads_select` — the 0159 pattern, so `leads_select` never subqueries another RLS-governed table inline and the policy rewriter cannot recurse. Pinned by the same test that keeps every seat level across the two rules.

**Consequence:** Reseating a contact for a new job is now free of side effects: the new team takes the contact forward, and the old team keeps the customer, their contract, and their commission line in their own portals for as long as the paper exists. The grant reads the contract's stamped seats, so an Admin seat correction (audited, #028) moves visibility with the pay, as it should. Per-job teams remain unbuilt on purpose — if overlapping jobs on one contact ever become real, that is its own design with its own requirements.

## 064 — Search reads a stored, trigram-indexed haystack; "no matches" and "search failed" are different answers

**Date:** 2026-09-22

**Context:** The owner reported that "Search for Anything" still could not find names, last names, or the start of an address — clients visibly on the calendar. The function was correct and slow: 0155 rebuilt every contact's haystack on every search (`lower(concat_ws(...))` then a `regexp_replace` whitespace fold, inside a correlated subquery that re-ran per query word) across all ~79k leads, then did the same over every note body. Measured locally on 80k contacts and 40k notes: 3.2 s for one word, 5.7 s for two, 8.2 s for "10525 w pico". On Supabase's shared CPU, under RLS, that runs past the statement timeout; the action logged the error and returned `[]`, and the topbar rendered `[]` as "No matches across contacts, estimates…" — so a database timeout read, to the owner, as the client not existing. Multi-word queries (a full name, the start of an address) were the slowest and failed first, which is exactly what was reported.

**Decision:** `leads.search_text` (0170) is a stored generated column: the lowercased haystack of every field a person might type — display name, each name part (so a Company contact's person is findable), phones as typed *and* as bare digits (so a digits-only query matches a formatted stored number with a plain LIKE), emails, address, zip, the second contact's name and phone. A pg_trgm GIN index on it, and one on `lower(body)` for notes, let Postgres jump to the rows containing the query's longest word; `LIKE ALL` over the per-word patterns filters the rest. The whitespace fold is gone because per-word matching made it redundant: a word contains no whitespace, so "does it appear" reads the same whether the text has one space or three. Locally the same searches now take ~100 ms. The app-side re-filter reads the same widened field list (#008's lockstep rule, pinned by the new tests in `global-search.test.ts`). Because migrations are pasted by hand and lag (0155 itself shipped unrun — the "half-fixed" search the owner saw), the action probes for the column once and, until it exists or whenever the RPC fails, runs the same per-word search through PostgREST `ilike` filters in parallel — the `searchEstimateLeads` pattern, ~90 ms at 80k rows — with `ilikeAnyColumn` building the filters (quoted, LIKE-escaped, tested). And a search that could not run at all is now a 503 the topbar shows as "Search didn't answer", never as "No matches".

**Consequence:** Search is fast at the current scale and stays so as the book grows (the index does the work). Estimates and appointments still scan their own tables (8k / 20k rows, plain LIKE, tens of milliseconds) and join the client's name — the next thing to index if document volume ever makes it slow. Accents are not folded: "Muñoz" is found by "muñoz", not "munoz" (TECH_DEBT). The fallback finds a client's contract only through the contact it matched (no join), so "type a client's name, see their contract" is slightly narrower until 0170 runs — one more reason to paste it. The `search_text` column is derived, never written; a new lead field that should be searchable is added to the generated expression (a migration), to `buildSearchGroups`, and to the fallback's column list together.

## 065 — Two cards, one team: paid seats live on the contact, visit seats on the appointment

**Date:** 2026-09-22

**Context:** The Edit Appointment window had grown six people boxes — Assigned To, Second Assigned To, Customer's Rep, Dispatcher, Partner Rep, Closer — four of them duplicating fields the contact card already edits. Two of everything read as two sources of truth, and the owner flagged it as confusing. The tempting fix (edit the closer/partner per appointment) recreates the exact problem the dispatcher seat was designed against: one customer with three appointments must not have three windows disagreeing about who is owed the commission, and the paid team exists from lead arrival, before any appointment does.

**Decision:** The appointment window keeps only the visit seats (Assigned To / Second Assigned To — who drives out) and shows everything else as one read-only "Customer's team" line (Rep · Partner · Closer · Dispatcher, `customerTeamSegments`, whole-roster names) with an "Edit on contact card" button. The contact card stays the single editing home for the paid team, including dispatcher claim/release. Automatic reminder texts follow the same split: both visit seats get them (`reminder-recipients.test.ts`), and the paid team never does unless someone on it is also booked into a visit seat.

**Consequence:** One place to change who gets paid; every appointment's team line updates itself. Booking still shows the whole team, so nobody drives out blind. Nothing about pay, send-gating, portals or stored appointments changed — the window just stopped duplicating the contact card. A dispatcher now claims a lead from the contact card rather than the appointment window.

## 066 — Every PR is a version, and every version announces itself on screen

**Date:** 2026-09-22

**Context:** The update popup (#029-era plumbing: `/api/version` polled by every tab, a modal when the deployed version differs from the loaded one) only works when the version changes, and nothing made it change. `package.json` was bumped once — 1.131.0 at PR #194 on 2026-09-17 — and 54 PRs merged after it without a bump, so for five days of daily deploys no tab was ever told to refresh, people ran stale bundles against new server code, and the sidebar's version number said the same thing about every build. The owner's instruction: "always update version and give notification screen on CRM of any update."

**Decision:** Two halves. The habit: every PR bumps `package.json` (minor if a user can see it, patch for a fix) and adds that version's plain-language entry to `RELEASE_NOTES` in `src/lib/release-notes.ts` — a standing rule in `AGENTS.md` and `.claude/skills/release-notes/SKILL.md`, enforced twice: `release-notes.test.ts` fails when the newest note and `package.json` disagree, and a "Version bumped" CI step fails any PR whose version equals the base branch's. The screen: `/api/version` now returns the notes with the version, the update popup lists them under "What's new" before asking for the refresh, and a new `WhatsNewNotice` shows the loaded build's notes once per version per browser (localStorage, "Got it") — because the popup only reaches tabs that were open at deploy time, and a fresh open or the refresh itself would otherwise arrive with no explanation. Notes live in code, not a table: they ship with the build they describe, need no migration (which lag here), and the test can hold them to the version.

**Consequence:** No deploy is silent again: stale tabs are prompted and told why, fresh loads are told once, and the sidebar version is a real answer to "which build are you on". The costs: every PR carries a two-file bump (and parallel sessions must re-check main's version before opening, the same way they re-check migration numbers — a PR that lands with main's version deploys silently, the old failure); a browser with blocked storage sees What's new on every load (fails in the noisy direction, on purpose); and a first deploy of this feature shows the screen once to everyone, which is the point.

## 067 — Linked cards: the visit fills the contact's empty seats, and never a held one

**Date:** 2026-09-22

**Context:** After #065 split the two cards (paid seats on the contact, visit seats on the appointment), the owner's next ask was the link between them: fill the appointment and the contact should learn its team. The obvious version — appointment always wins — silently moves a sale: send a helper to one visit and the customer, with the commission, changes hands through a field nobody thought of as a pay decision.

**Decision:** Saving an appointment fills the contact's **empty** seats only: Assigned To → Assigned Rep, Second Assigned To → Partner Rep (never the same person as the rep, never the closer — the pickers' own exclusivity, #050), and the closer seat is never written from an appointment at all. The rules live in `leadTeamFills` (tested); `applyLeadTeamFills` applies them best-effort after every appointment write (createEvent, updateEvent, bookAppointmentForLead), with the empty-seat guard in the UPDATE statement itself so racing saves cannot double-fill, and a timeline note for every fill that lands. The reverse link: bookings pre-pick the customer's rep, empty visit seats offer a one-tap "Use customer's rep / partner" button, and reminder texts fall back to the customer's rep only when a visit has nobody booked.

**Consequence:** One save books the visit and staffs the customer — the three-step dance (book, then open the contact, then set the rep) collapses to one. Taking a customer off a rep stays a deliberate act on the contact card, so no appointment edit can restate pay. An RLS-refused fill (a dispatch-scoped user on a colleague's lead) degrades to exactly the old behavior: the appointment saves, the contact stays.

## 068 — Sidebar groups are named after the people in them and each wears a department color

**Date:** 2026-09-22

**Context:** The dialer and its call/text/appointment reports sat under "Your Sales Center". The role that lives in those pages is called Call Center, and the Sales role's real home is the pipeline and the estimates — so a Call Center user's own section read as somebody else's. The Salespeople leaderboard sat in the same group although it reports on people, not on calling. And every group header was the same grey text with the same orange marker, so finding "the money" or "the phones" meant reading the labels.

**Decision:** The group is "Call Center" (no "Your"; no other group has it). Salespeople moves into a new "Staff" group, the people section, which opens with that one page on purpose rather than as a loose top-level link — it is where any later people report (dispatchers, appointment setters) lands. Page keys and routes do not change, so Role Visibility ticks and every URL survive. A saved Menu Order that still names the old group key places both new groups at its spot (`LEGACY_NAV_KEYS` in `sortNavEntries`, tested) instead of dropping them to the bottom of a menu somebody already arranged. Each collapsible group carries a color (`GROUP_TONES`, one hue per department, `nav-tones.test.ts` fails on a group without one or two sharing one): the icon, a rail down its left edge that continues beside its open pages, and a tint on the current-page highlight. Dispatch blue, Call Center teal, Staff rose (the "a person" color the project chips use), Production orange, Accounting gold. Green and red are deliberately absent — across the CRM they mean money in and money out — so the books are gold, not green. Top-level links keep the plain orange "you are here" marker, so orange no longer means both "current page" and "Production".

**Consequence:** The Call Center role's section is named after them; the leaderboard stops looking like a call report; a section can be found by color before it is read. A new group needs a color in `GROUP_TONES` before the suite passes, and one that reads as money is refused by the test. The Staff group is thin (one page) until the next people report ships.

## 069 — Sidebar labels fit on one line, and nothing renders there without a page behind it

**Date:** 2026-09-22

**Context:** At the sidebar's 220px (a 260px drawer on phones) three labels wrapped to two lines: the "Dispatch (Leads Mgmt.)" header beside its unread badge, the "Dispatch Dashboard · Soon" placeholder, and "Appt. Setter Assignments". A wrapped menu row reads as a mistake, and the placeholder was the one row in the menu that went nowhere when tapped — it had been "Soon" long enough to read as broken.

**Decision:** The group is plain "Dispatch" (the pages inside already say leads, and its blue rail from #068 identifies it), the setter page's menu label is "Setter Assignments" (the page keeps its full title), and the placeholder row is removed along with the machinery that rendered it (`PLACEHOLDERS`, `comingSoon`, the disabled sub-item styling) — a group item now always has an `href`. Sidebar labels and group names stay at 21 characters or fewer, pinned by `nav-groups.test.ts` ("Estimates & Contracts" is exactly that and fits). The old "Dispatch (Leads Mgmt.)" menu-order key maps to the new group (`LEGACY_NAV_KEYS`), so a saved order keeps it in place. Page keys and routes are unchanged.

**Consequence:** Every sidebar row is one line and every row opens a page. A future "coming soon" entry has to come back as a real page in the registry, not as a label; a label longer than 21 characters fails the suite rather than wrapping in production.

## 070 — The Dispatch Dashboard measures speed and the board, and reads the first touch from what was actually done

**Date:** 2026-09-22

**Context:** The main Dashboard answers "how is the business doing". The desk — the people who take new leads, call and text them, book visits for reps and chase confirmations — needs "what do I do in the next hour", and had no page for it. The obvious speed-to-lead number needs a "first contacted at" per lead, and `leads` has no such column; the only recency stamps are `notes_updated_at` and `updated_at`, which move for reasons that are not contact.

**Decision:** A separate page (`/dispatch-dashboard`, its own top-level sidebar link under Dashboard so Menu Order can place it — the owner's call the same day, after a first cut put it inside the Dispatch group — on by default for the Dispatch role) built on the main Dashboard's contract: one `security invoker` RPC (`dispatch_rollup`, 0171) with a tested TS mirror as the fallback and every clock edge passed in. A lead's first touch is derived, not stored: the earliest of a call logged, an outbound customer text (channel other than `rep`) or a note on the lead — the three things the desk actually does — so no write path has to remember to stamp anything and history is covered. "Reached within the hour" is that touch within 60 minutes of `created_at`. "Booked" is an appointment created in the window, credited to `events.created_by` (the column existed in the schema and was written on insert but was absent from the TS type until now); "showed" is Showed or Won on a visit dated in the window. Three floors keep every read bounded on a 79k-contact book: untouched new leads look back 7 days, missing results 14, and "waiting for a first appointment" 90 — a pre-appointment lead older than that is dead, not waiting. Money and commission stay off the page (dispatcher pay is on signed contracts, #004) and lead refunds stay on their own page (off by default for Dispatch). Confirmation reads `customer_confirmed`, the calendar's own reading, not the `Confirmed` status.

**Consequence:** The desk gets live problems, then pace, then the board, from one call. The first-touch derivation is the one expensive piece of the SQL (three correlated mins per cohort lead), which is why the cohort is a window and never the book. A text cannot be attributed to a person (no sender column), so the desk table has no per-person text count until one exists. The panels are not drag-arrangeable yet — the main Dashboard's order lives in a dashboard-specific profile column — noted in TECH_DEBT.

## 071 — Invite history is a view over `signup_invites`, and Resend rotates the row instead of adding one

**Context:** The Platform Admin page could send a setup link but never show what had been sent. Every invite already lived in `signup_invites` (0130/0131) with its send time, expiry, redemption and the company it became; nothing read it back, and nothing recorded which admin clicked Send.

**Decision:** No audit table and no new page. The history is a card on the Platform Admin page reading `signup_invites` through the service-role client (the table has RLS on with no policies by design; the page gate is the guard, as for `listPlatformAdmins`) and returning display fields only, never `token_hash`. Status is derived, not stored, by `inviteStatus` in `src/lib/signup/invite-history.ts` (pure, tested): redeemed beats everything, then "email never went out", then expiry. Resend mints a fresh token on the **same** row (`rotateInviteToken`, pinned to `consumed_at is null`) so the list stays one line per person invited and a stale click can never reopen a redeemed link; the rotation also clears `invite_sent_at`, so a failed resend honestly shows as Send failed. `sent_by` (0172) answers "who sent it"; both the insert and the loader fall back to the pre-0172 shape when the column is missing, because migrations are pasted by hand and lag. The list is capped at 300 rows rather than paged — invites arrive a few a week.

**Consequence:** Paid signups show "Signup page" as the sender. Rows are judged against a single clock read in the server page (the client view may not call `Date.now()` in render), so a tab left open for hours can be minutes stale on a status that has days of granularity. If invite volume ever makes 300 rows a real cap, page it then.

## 072 — Google Calendar sync is a polled mirror with the CRM as the source of appointments

**Context:** Reps live in Google Calendar on their phones; the office wanted appointments there and wanted moves and cancellations made there to count. Events are written from seven places (calendar, wizard, SMS confirmations, the AI receptionist, reassignment, calendar renames, merges), times are stored as a local date + time in the company's zone with no timezone or external id, and `deleteEvent` is a hard delete.

**Decision:** Two tables (0173): a connection per rep or per company (tokens service-role only, like Drive's 0027) and a link per appointment per connection carrying Google's event id, its etag and the CRM `updated_at` at the last sync. Sync is a 15-minute cron (plus Sync now), not hooks in the write paths — `events.updated_at` already changes on every write, so one runner covers all seven writers and a Google outage never blocks saving an appointment. Push: `planPush` (pure, tested) creates live appointments from 7 days back, updates linked ones whose `updated_at` moved, and removes dead (Cancelled/No-show), deleted (a link with no row — `event_id` is deliberately not a foreign key so the link outlives the row) and reassigned ones. Pull uses Google's `syncToken` (a 410 restarts a full read); only times and cancellation come back (`decidePull`), Google-native events are never imported, an item whose etag matches the link is our own write echoing back, and when both sides changed the later timestamp wins. A pull writes the row's new `updated_at` back onto the link so the push that follows does not bounce it. Times cross with `instantOfWallClock` / `wallClockIn` in the company zone; no time is an all-day event, no end time is one hour, an end on another day is kept as "no end". Writes are capped per run so a rep with a year of future bookings does not own a cron slot. The Google client id falls back to Drive's so both live in one Google Cloud project. The page is not admin-gated (every rep connects their own); the company section is Office/Admin only, and the Calendar page links to it because the Settings grid is not reachable by reps.

**Consequence:** Changes made in Google take up to 15 minutes to land (push notification channels are the upgrade if that ever matters; the link table already carries what they need). Editing a title, client or notes in Google is overwritten by the next CRM push — Google is a mirror for the fields the CRM owns. Disconnecting leaves the existing Google copies in place. The 30-day pull window means an appointment older than a month moved in Google is not pulled; the CRM copy stands.


## 073 — Location is tracked only while on the clock, and attendance is written by the server

**Context:** The owner wanted live tracking of reps and crews from the start, with hours feeding payroll and attendance. Tracking people is legally and socially sensitive, and a web page can only read location while it is on screen.

**Decision:** Tracking is tied to the time clock (0174): a fix is accepted only while its sender has an open punch — enforced by the `location_pings` insert policy, not by the app — and clocking out or starting a break stops it. Each person accepts a notice before their first clock-in, and trails are deleted after the company's retention (default 90 days) while hours and arrivals are kept. Workers write their own punches but only "now" (policy + a guard trigger: a worker can close their own open punch but never move a clock-in or reopen a closed one); Office/Admin corrections go through `correctPunch`, which records raw before/after snapshots in the append-only `time_punch_changes` (the change-tracking skill). Site visits are written only with the service role from the pings, so nobody can hand-craft their own attendance. Zones are appointment addresses geocoded through the existing `address_geocode` cache (Census geocoder) — no new API key. A shift with a break is two punches, so hours are a plain sum. Hours are filed on the company-local day the punch started.

**Consequence:** Until the phone app ships, location updates only while the CRM is open on screen; hours and attendance still work. Late and no-show counts on Timesheets are only for people who clocked in that week, so reps not yet using the clock are not flagged. A punch that spans midnight counts entirely on the day it started.

## 074 — The phone app is a thin shell around the live CRM

**Context:** Live tracking with the phone locked needs a native app (decision #073); the CRM is a Next.js site deployed on Vercel, updated many times a day.

**Decision:** `mobile/` is a Capacitor 7 project whose WebView loads the live site (`server.url` = crm.aibuildpros.com) rather than a bundled copy, so every CRM release reaches the app without a store update — only native changes (plugins, permissions, icons) need a new build. Background location is the free `@capacitor-community/background-geolocation` plugin (its README lists Capacitor ≤7, hence 7, not 8). The same `LocationSharer` runs in both: `Capacitor.isNativePlatform()` switches the fix source from `navigator.geolocation` to the plugin's watcher and the POST from `fetch` to `CapacitorHttp` (Android throttles WebView requests after five minutes in the background; `CapacitorCookies` lets the native request carry the session). The watcher asks for every fix (`distanceFilter: 0`) and `fixDue` decides what is sent, because a stationary phone must still report or the Team Map shows "Location off". Nothing new on the server: fixes still hit `/api/location` and the on-the-clock rule stays in RLS.

**Consequence:** GPS stays on for the whole shift inside the app — a real battery cost, bounded by clock-out. The app needs a network connection to open (an offline page offers Try again). Force-quitting the app stops sharing until it is opened again.

## 075 — A lapsed AI Build Pro subscription locks the company in RLS, not just in the UI

**Context:** Self-serve signup (0130) sells the CRM on a recurring Stripe price but only ever looked at the first payment, so a company that cancelled or stopped paying kept full access. The owner chose a full lockout (not read-only) when a subscription lapses.

**Decision:** Status lives in its own table, `company_billing` (0175), written only by the service role — not columns on `companies`, whose `companies_update` policy would let a company's own Admin mark themselves paid. The boundary is a **restrictive** `billing_lock` policy added to every RLS-protected public table with a uuid `company_id` by `apply_billing_lock_policies()`; restrictive policies AND with the existing ones, so nobody's visibility changes except a lapsed company's members, and no existing policy had to be rewritten. The lapsed set comes from `billing_locked_company_ids()`, argument-free so it runs once per query (#0108's rule), empty for platform admins. `company_members`, `profiles` and the billing tables are left unlocked so the lock screen can still tell who is signed in. The app layout redirects to `/billing-locked` from a tag-cached read the webhook expires. The webhook re-lists the customer's subscriptions from Stripe on every billing event rather than trusting the event body, and `pickSubscription` prefers any working subscription over a newer dead one, because renewing after a cancellation is a fresh Checkout on the same customer (the Customer Portal can't revive a canceled subscription). `past_due` is not a lockout — Stripe is still retrying — only a banner.

**Consequence:** A tenant table added after 0175 is not locked until its migration runs `select public.apply_billing_lock_policies();` (TECH_DEBT). Service-role code paths (webhooks, crons, the AI receptionist) keep running for a lapsed company. Companies bought before 0175 get their status at their next billing event. The lock screen's status list and 0175's must match; `subscription.test.ts` reads the migration to hold them together.

## 076 — Customer deposits never use the deployment's Stripe key

**Context:** `getStripeForCompany` fell back to `STRIPE_SECRET_KEY` when a company had not connected its own Stripe account — a leftover from when the CRM served one business. That variable is now the AI Build Pros account, which sells CRM subscriptions (`/get-started`, #075). With the fallback, every company without its own account would have taken its customers' deposits into AI Build Pros' Stripe.

**Decision:** No fallback. The deposit path (`stripe-company.ts`, `portal-payments.ts`, the per-company webhook) reads only the company's own encrypted keys; `stripe-company.test.ts` fails if any of them reads the deployment key. The Payments page's "not connected" notice follows the company's own account too.

**Consequence:** A company must connect its own Stripe under Settings → Portal Payments before its customers can pay online. The deployment key is used only for self-serve signup and subscription billing.

## 077 — A bill says which contract it's for when the customer has more than one

**Context:** A cost belongs to a contract through its phase (`costsForContract`); an unfiled cost is attributed only when the customer holds exactly one contract. Projects' "+ Add bill" never asked for a phase, so on a customer with two contracts (Mari: EST-1106 and EST-1117) every receipt counted toward neither, and the commission statement read "Job costs not recorded yet" on a job 100% collected with $32k of bills in.

**Decision:** When the customer holds more than one contract, "+ Add bill" and "✎ Edit" ask "Which contract?" — the choice is a phase, grouped by contract with its change orders' phases under it (`contractFilingOptions`), and saving refuses a blank choice. Opened from a project row, the row's contract is pre-picked. Options are read with the admin client (`getJobFilingOptions`) because Field records receipts but cannot open estimates; only document numbers, titles and phase names come back, never an amount. Every save checks the phase is on that job (`phaseIsOnJob`) — the write policy only checks the company. Bills already saved unassigned are counted per contract row (`unassignedJobCosts`) and flagged on the statement with a link to file them.

**Consequence:** A one-contract customer sees no new question. The one-job statement (`?job=<contract id>`) itemises exactly the bills the commission counts, one bill at a time through the same rule, so the list always adds up to the costs line.

## 078 — A bill entered as paid is a bill plus payments, not a bare job cost

**Context:** "+ Add bill" with "Already paid" wrote one `job_expenses` row and nothing else: no method, no account, no way to record $800 on the Amex and $300 by check, and nothing QuickBooks could ever read as a bill. The owner asked for a payment-method dropdown and partial / split payments, "all compatible to QuickBooks sync in future".

**Decision:** Every bill entered as paid is now a `vendor_bills` row plus one `vendor_bill_payments` row per payment line (`createBillWithPayments`) — the shape Bills to Pay already used, and the shape QuickBooks Online records (one Bill, a Bill Payment each). Each payment carries its method (ACH added), check/ref number and a "Paid from" account from the new `payment_accounts` list (0176), which will map to QuickBooks bank / credit-card accounts. Empty `qb_bill_id` / `qb_payment_id` / `qb_synced_at` columns are in place so a future sync never sends anything twice. Bills to Pay's Pay button and the new form share one writer (`writeBillPayment`), so both produce identical rows and job costs. Field (and anyone else who can't run Bills to Pay) records through the same action with the admin client, after the job, vendor, phase and accounts are proven to be the company's, and may only save a bill paid in full — they can't leave one owing. Part-paid bills leave the remainder open in Bills to Pay.

**Consequence:** Old "Already paid" costs stay as they are (their ✎ Edit still works); new ones are bill payments, corrected in Bills to Pay, whose Edit now also works on paid bills (never below what's paid, and the linked job costs follow). A vendor name is now required on a paid receipt too — QuickBooks can't hold a bill without one. No sync is built yet.


## 079 — PrimeCall's live feed is a nudge, not a data source

**Context:** PrimeCall is a reseller of the NetSapiens platform, whose v2 API offers event subscriptions that post each finished CDR to a URL. NetSapiens does not sign those posts, the posted shape is documented only loosely, and the CDR `call-direction` integer has no published meaning.

**Decision:** The webhook URL carries a per-company secret, and a verified post only triggers a re-read of the last 30 minutes from the CDR API, the same read the 15-minute sweep does. Nothing in the post body is written anywhere, so a forged or oddly shaped post can't create a call or a lead. Direction comes from which API filter (Inbound / Missed / Outbound) returned the row, and legs are grouped on `call-orig-call-id`, so a ring group's three legs are one call. Rows are keyed on that id (`call_logs.primecall_call_id`, unique per company); a re-read refreshes only status, duration, recording and an empty rep, never disposition or the lead link. Extensions map to CRM users by email (exactly one match, or no rep) rather than through a mapping screen.

**Consequence:** Each finished leg costs three small API reads, which is fine for one office's call volume. If NetSapiens is ever found to put a field somewhere other than where `cdrsToCalls` reads it, the fix and its test are in one pure module. Outbound calls to numbers not in the contact book are not logged at all.

## 080 — Facebook sign-in goes through one CRM-owned Meta app

**Context:** Connecting Facebook Lead Ads meant each company creating its own Meta developer app, adding Webhooks, generating a Page token in the Graph API Explorer, exchanging it for a long-lived one and pasting five values. Nobody outside engineering could do it, and a token that later died stopped leads without a word.

**Decision:** The deployment owns one Meta app (`META_APP_ID` / `META_APP_SECRET`), whose webhook is registered once against `/api/meta/leadgen` with `META_WEBHOOK_VERIFY_TOKEN`. A company signs in with Facebook (`/api/oauth/meta/*`), the code is exchanged for a long-lived user token, and the Page token read with it — which doesn't expire on a timer — is the only token stored. With several Pages, the user token waits ten minutes in an httpOnly cookie for the pick instead of in the database: it can reach every Page the person runs and the CRM needs one. `meta_connected_via = 'facebook_login'` (0178) tells the webhook to check signatures with the platform secret, and to refuse the call when the deployment has none, rather than falling back to the manual path's "no secret, no check". The manual path is kept as-is for companies already on it. The settings page asks Facebook on each load whether the token works and the Page is still subscribed to the CRM's app.

**Consequence:** Meta has to approve the app (App Review with Business Verification) for `leads_retrieval`, `pages_manage_metadata`, `pages_manage_ads`, `pages_read_engagement`, `pages_show_list` and `business_management` before companies whose people aren't app testers can connect. A Page belongs to one company (0178's unique index; the connect path refuses it too), since the webhook finds the company by Page id. The settings page makes one Graph call per load.


## 081 — Sending without approval is a per-person switch that approves in the sender's name

**Context:** With estimate approval switched on (0136), a closer at the kitchen table had to wait for an Admin before the customer could get the estimate. The owner asked for a Users & Roles switch that lets chosen people, closers in particular, send without that wait.

**Decision:** A per-person flag, `company_members.can_send_without_approval` (0179), off by default. It works for anyone who can send, not only closers. The owner picks the people, and tying it to the closer seat would miss a trusted rep with no closer on the lead. It doesn't bypass the gate. The rule (`approvalOnSend`, pure and tested) answers "self-approve", and the send stamps `approved_at`/`approved_by` with the sender just before the status change. So the 0136 trigger needs no change, the document still says who let it go, and a line goes on the contact's timeline like an admin's approval does. An existing admin approval is never overwritten. Only an Admin can change the flag: the gate exists to check Office's sends too, and Office can edit `company_members` under RLS. The action refuses non-Admins, and a trigger in 0179 refuses the column change in the database for any signed-in non-Admin (super admins and the service role pass). Admins read "Always" (they approve their own). The switch shows only for people who can send.

**Consequence:** Mark Sent now asks the approval gate in the app before flipping the status. It used to leave the refusal to the trigger's database error. The stamp is written just before the status change: if that change then fails, the draft stays approved in the trusted sender's name, and anyone who can send may then send it.

## 082 — An invoice is an estimates row, issued as Signed, kept out of sales by its kind

**Context:** The owner needed to bill a customer for extras on top of the contract, a permit fee above all, without a signature. The only ways to charge a customer were a contract phase and a change order, and a change order needs the customer to sign.

**Decision:** An invoice is an `estimates` row with `kind = 'invoice'`, the way a change order is. Its lines are `estimate_items`, and it has one `estimate_payments` phase for the whole amount, billed the moment it's issued. It's inserted straight as `status = 'Signed'`, with `signed_at` set to the issue time, because every money path (portal Pay button, Stripe checkout, Record payment, Payments, P&L, the overdue bell) already reads Signed as "owed". Inserting it Signed, rather than updating a Draft, also keeps the 0136 approval trigger (update-only) from holding a document nobody has to approve. It's numbered `INV-<n>` from the company's one `next_estimate_number` sequence. What keeps it out of sales is its kind, stated as allow-lists rather than deny-lists: `isSellableKind` (funnel, marketing, dashboard sales), `addsToContractValue` (rep and dispatcher commission count only a signed change order), contract-only production jobs and project links, lead value, the Estimate Status board, "Signed!" alerts, and no funnel card at all. Money to Collect reads `collectsOnDocument` (contract or invoice). Projects keep invoices apart from change orders: collected and receivable, never sold, with `invoicedCents` added to what "% collected" is of. A line billed back from a job cost links to it (`estimate_items.source_expense_id`, 0180), which blocks billing the same cost twice and shows its receipt to the customer when `show_source_receipt` is on.

**Consequence:** Commission doesn't count an invoice, so an invoiced permit fee still reduces the rep's net profit as a job cost, the same as before invoices existed (owner's call: an invoice never raises commission). If the reimbursement should offset the cost instead, the fix is in `addsToContractValue` plus the `docIds` filters in `rep-commission.ts`. An issued invoice can't be edited: one sent by mistake is cancelled (Void, its phase un-billed, its costs free to bill again) and re-issued. Any new reader of `estimates` has to decide what an invoice is to it, and an allow-list on `kind` is the safe default.

## 083 — A company client is the company; its person is only the contact

**Context:** A lead's Contact Type can be Individual or Company. The lead card and the Projects list named a Company client by its company, but about thirty other surfaces joined `first_name` and `last_name` by hand. So "Coast to Coast Water Damage & Restoration, Inc" read as "Josh Martinez" on its estimate, contract, customer copy, PDF, lists, reports, alerts and Production job.

**Decision:** One rule, in `src/lib/data/client-name.ts`. `clientName()` is who the client is: the company when Contact Type is Company, otherwise first + last. It keys off Contact Type, never off whether `company_name` is filled, because CSV imports put an employer on individuals. It mirrors SQL `lead_display_name` (0170), and `leadDisplayName()` is it plus the "Unnamed" fallbacks. `clientContactName()` is the person at a company client ("Contact: …" on the estimate header, "Attn: …" on the customer's copy and PDF). `clientCompanyName()` is what a customer signer signs on behalf of. `personName()` is kept for the places that really are about the person: email and text greetings, and the signer rows (a company can't sign). The contract's `{{client_name}}` is `clientName()`. `src/lib/client-name-guard.test.ts` fails on any new hand-built first + last join outside `client-name.ts`. The incoming-text toast's SQL (0181) follows the same rule.

**Consequence:** A new surface that names a client imports `clientName()`, and its lead select has to carry `contact_type` and `company_name`. Without them it silently falls back to the person. A company with no company name yet reads blank to the helper, and each caller shows its own fallback ("Customer", "Unnamed Company") rather than the contact person. Stored text isn't rewritten: an already-merged contract body or an existing Production job name keeps whatever it said when it was made.

## 084 — Deleting a file trashes it in Drive and leaves a record of who deleted it

**Context:** The owner asked that authorized users can delete job photos (duplicates and stray phone screenshots were piling up in the job Photos popup), and asked for a "who deleted what" history. `deleteLeadFile` already existed and `lead_files_delete` RLS already limited deletes to Office/Admin, but a Drive-kept file was removed with a DELETE call, which skips Drive's trash, and nothing recorded that the file had ever been there.

**Decision:** Delete stays Office/Admin, the boundary the RLS policy already draws. Production keeps filing and gets "Remove from job" (unfile back to the customer), which loses nothing. `deleteLeadFile` now reads where the file lives from the row it deleted rather than from the caller, moves Drive files to the trash (`PATCH trashed: true`, restorable for 30 days), and then inserts a snapshot of the row into `lead_file_deletions` (0182): file name, type, the job it was filed under, uploader, upload time, deleter, delete time. The table is append-only by RLS (select and insert for Office/Admin, insert only as yourself, no update or delete for anyone), the same pattern as `sales_team_changes` (#026). The history is written by the server action, not a trigger, because `deleteLeadFile` is the only path that deletes a single file. If the history insert fails, the action says the file was deleted but the record wasn't saved, and doesn't pretend the delete failed.

**Consequence:** Files kept in app storage (not Drive) are still removed for good, so the confirm says "can't be undone" for those. Files that go because their whole lead is deleted aren't recorded one by one (see `docs/TECH_DEBT.md`). The history starts when 0182 runs; nothing is backfilled.

## 085 — Notes the client sees live in their own table, not behind a flag on internal notes

**Context:** The owner asked for notes shared between the team and the client in the portal. The lead card already had Notes (`lead_notes`), the team's internal timeline, which holds things a client must never read ("price-sensitive, push the upgrade"). The portal reads with the service role, because a customer has no Supabase session, so RLS can't stand between the portal and a table.

**Decision:** A separate table, `lead_shared_notes` (0183), instead of a "visible to client" column on `lead_notes`. With a column, every portal query would have to remember the filter, and one that forgot would show the client every internal note. With a separate table, the portal reads a table that only ever holds what the client may see. The lead card shows both as two sides of one switch, never one mixed list, and the shared side keeps a "the client sees this" banner above its composer. Clients write through `portalAddSharedNote`, which scopes the insert in code to the signed-in customer's lead. Staff write on their own session: the insert policy allows Office, Sales and Field (Admin implied) as themselves, onto a lead of their own company. Reading follows the lead, with the same select rule as `lead_notes`. There's no delete policy, because the table is the project's written record. A trigger keeps authorship and placement fixed and lets only a note's own staff author change its text. That covers the owner's call that a client can't edit a note after posting. The alert for a client's note is derived, like the rest of the bell and popups: Office/Admin see every one, a rep sees them on customers assigned to them (`seesClientNoteAlert`), and an unassigned customer's note goes to the office only.

**Consequence:** A mistaken shared note can't be deleted, only edited by its author, so the banner's warning matters. Anything new that shows the client something about a note has to read `lead_shared_notes`, never `lead_notes`. Client notes arrive under the Texts popup switch rather than a switch of their own.


## 086 — The Play upload key is made on GitHub and only ever stored locked; the app targets API 36

**Date:** 2026-09-27

**Context:** The Google Play account is open and the next step is a signed release build. The owner has no Android Studio or command line, and the key that signs uploads has to live in GitHub secrets for CI to use it. The repo is public, so anyone signed in to GitHub can download a run's artifacts and read its logs. A workflow can't write repo secrets with its own token, so a key made on GitHub has to reach the owner through an artifact. Separately, since 31 Aug 2026 Play refuses new apps and updates that don't target Android 16 (API 36), and `mobile/` targeted 35.

**Decision:** A manual workflow (`android-upload-key.yml`) makes the upload key on the runner, locks it with gpg (AES-256, the heaviest S2K count) using a password the owner chose first and saved as the `ANDROID_UPLOAD_KEYSTORE_PASSWORD` secret, and publishes only the locked text, for one day. It refuses a password under 20 characters, and it refuses to replace an existing key unless *Replace* is ticked. That locked text is itself the `ANDROID_UPLOAD_KEYSTORE` secret. The release workflow (`android-release.yml`, manual, `main` only) unlocks it into the runner's temp directory, signs `bundleRelease`, checks the signature by jarsigner's words (it exits 0 on unsigned files too), and deletes the key. Gradle reads the key's path, password and version numbers from the environment, so every other build stays unsigned and needs no secrets. The version code is the release workflow's run number. Play App Signing is on, so this is only the *upload* key, which Play support can reset if it is lost. For API 36: compile/target 36, AGP 8.13.0 and Gradle 8.14.3 (Capacitor 8's pairing for 36), and `adjustMarginsForEdgeToEdge: "auto"`, because Android 16 ignores the edge-to-edge opt-out once an app targets 36. That setting (Capacitor 7.1+) insets the WebView on Android 15+ only, where edge-to-edge is enforced. The PR test build now also compiles `bundleRelease`, so the Play build path is proven on every `mobile/` PR.

**Consequence:** The key's safety rests on the owner's password, because the locked copy was public for as long as the artifact existed. That's why there's a length floor, why the retention is one day, and why the doc says to delete the artifact. Renaming `android-release.yml` resets `github.run_number`, and Play would then refuse a repeated version code: keep the file name, or add an offset to `ANDROID_VERSION_CODE`. Capacitor 7's margins cover the system bars, not the keyboard. If a text field ends up hidden behind the on-screen keyboard on Android 15+, the fix is in native code, not the CRM.

## 087 — The Play Store app hides the CRM's own subscription; privacy and deletion pages are public

**Date:** 2026-09-27

**Context:** The phone app opens the live CRM (#074), so every screen on the website is also a screen in the app. Three of them sell or manage the AI Build Pro subscription through Stripe: the sign-in page's "Start an account", the lock screen's renew and card buttons, and *Settings › Subscription*'s "Manage billing". Google Play requires apps to sell subscriptions to their own service through Play Billing, and bars pointing people to another way to pay. Play also requires a public privacy policy, a web page for requesting account deletion, and both reachable inside the app. The owner gave the contact address (info@aibuildpros.com) and an Organization account.

**Decision:** `<WebOnly>` (`src/components/web-only.tsx`) renders its children on the website and a fallback inside the app, detected by `Capacitor.isNativePlatform()`. Until the browser has said which it is, it renders nothing (`webOnlyView`, tested), so the app never flashes a sales link during hydration. The web pays for that with a one-frame delay before those links appear. The fallbacks only say it can't be done in the app, and never where it can, because naming the website is the steering Play bars. `no-sales-in-app.test.ts` reads every page and component and fails on a file that links to `/get-started` or calls `renewSubscription`/`openBillingPortal` without WebOnly. Homeowner payments to contractors stay: they pay for real-world work, which Play allows, and the portal isn't in the app anyway. `/privacy` and `/delete-account` are plain public pages (`src/lib/public-paths.ts`, now tested and shared with the proxy), linked from the sign-in footer and the sidebar. The contact address, date, and deletion window are constants in `src/lib/app-store/legal.ts`, and the location-retention figure is read from `DEFAULT_TIME_CLOCK_SETTINGS`. Deletion is a request by email, handled by hand. That's what Play asks for, and deleting a user in bulk isn't something the app does today.

**Consequence:** A new screen that sells the subscription has to wrap it in WebOnly, or the test fails. Server actions are unchanged: a determined user could still reach Stripe, but the rule concerns what the app shows. The policy text is a list of facts about the product. A new integration that receives personal data, or a new kind of data collected, means updating `/privacy` and the Data safety answers in `docs/MOBILE_RELEASE.md` 3f together. The 30-day deletion promise binds whoever reads info@aibuildpros.com.

## 088 — The Production Board reads a job's status from its project's documents

**Date:** 2026-09-30

**Context:** The Projects page works out Complete (signed completion certificate), On Hold (`project_on_hold` on the contract) and Cancelled (voided contract) from the documents every time it loads. The Production Board kept its own `jobs.status`, which only a drag changed. Nothing moved it when the customer signed off, so finished jobs sat in Not Started next to "Unassigned", and a hold set on one page didn't show on the other. The owner asked that completed projects go to Complete automatically.

**Decision:** Both. The board places every card with `boardPlacement` (`src/lib/production-board.ts`, tested), reading the documents at load the way Projects does: certificate → Complete (locked), project hold → On Hold, all contracts voided → off the board, and Not Started with crew and a start date that has arrived → In Progress. Only the certificate on the live (latest signed) contract counts. Because it's read at load, jobs finished before this shipped move with nothing to backfill and no SQL. The stored status is also written where the events happen, so the Dashboard and Schedule, which read `jobs.status`, catch up from now on: `finalizeSignedEstimate` sets the lead's job to Complete when a certificate is signed, `setProjectHold` moves the card in or out of On Hold, and `updateJobStatus` sets the project's hold when a card is dragged in or out of On Hold. Changing a hold stays Office/Admin (the existing rule); a Field user can park a card in On Hold but gets a refusal when trying to release a project the office held. A drop the rules would undo is refused with the reason, and dropping on Complete without a signed certificate asks first, because the certificate starts the warranty and releases commission. The board never raises it on its own.

**Consequence:** The board and Projects can't disagree about Complete, On Hold or Cancelled. A job completed by a certificate signed before this shipped still has its old `jobs.status`, so the Dashboard's production counts and the Schedule read it until someone touches the job (see `docs/TECH_DEBT.md`). A job whose certificate is later voided keeps a stored Complete and becomes draggable again. Anyone adding a new way to finish, hold or cancel a project should read `boardPlacement` first.


## 089 — Phones get a bottom tab bar and a More sheet; the top bar's tools are opened from More, not moved

**Date:** 2026-09-30

**Context:** The Android app (and every phone browser) showed the desktop CRM squeezed down: a ☰ drawer for the menu, and nine tool icons in a top bar that scrolled sideways. The search box was hidden at phone width because the bar was full. The owner approved a mockup of a phone-shaped layout (bottom tabs, a More sheet) and asked for more color. Several tools open their own panels from inside themselves: the daily brief opens once a day on its own, and the AI assistant keeps a chat panel. So physically moving those components into a sheet that is usually closed would have hidden their panels, or mounted them twice.

**Decision:** At ≤700px the shell gains a tab bar as the last row of the app column. It is not floating, so it never covers the end of a list. The tabs are the first four pages the person can open, from a best-first list (`mobileTabs`, tested). Office and Sales get Home · Leads · Schedule · Jobs. The crew gets Jobs · Schedule · Time · Calendar. A page the person can't open never becomes a tab; the next candidate takes its seat.

More opens a sheet with:
- every page they can open, as tiles grouped by department (`moreSections`, following their menu order);
- the tools;
- the account block (company switcher, sign out);
- Privacy and Delete account (#087).

The ☰ is hidden at that width, and the search box is shown again.

The tools stay exactly where they were in the layout, each wrapped in a `display: contents` `.tool-slot[data-tool]`, so the desktop DOM and look are unchanged. At phone width their `.topbar-icon-btn` is hidden. The sheet's rows are read from whichever slots the top bar actually rendered for this person (so they can't drift from its role rules), and a tap clicks the hidden button. Each tool therefore has one instance, with its panels, polling and once-a-day brief untouched. Bell and Quick Create stay in the bar.

Color: each tab, section and tool wears a tone (`data-mtone`). These are the sidebar's department tones, deepened to at least 3:1 on white for icons, plus violet for scheduling. Red and green stay reserved for money.

Things pinned to the bottom (the location-sharing pill, the screen-share windows) now sit above the tabs. Tablets (>700px) and desktops are untouched.

**Consequence:** A new top-bar tool needs a `.tool-slot` with a `data-tool` key, and a row in `more-sheet.tsx`'s `TOOLS`. Without both, it is simply invisible on phones. A new page gets a tile automatically. It also needs an icon in `lib/mobile-tabs.ts`, or `mobile-tabs.test.ts` fails. The dashboard's old phone "Modules" tile grid now duplicates More; the Home screen PR (the next step of the approved mockup) replaces it. Anything else fixed to the bottom of the screen at phone width must clear `--phone-tabbar-h`.


## 090 — On a phone, Home is a short Today screen with the full dashboard one tap below; the crew's Today is the time clock

**Date:** 2026-09-30

**Context:** On a phone, the Dashboard is a long reflowed stack: filters, a dozen KPI boxes, charts and tables. It is useful at a desk, but not in a driveway between two appointments. The approved mockup's second step asked for a phone Home built around the next few hours: quick buttons, what needs attention, the next appointments with a way to drive there, and how the month is going. The field crew's day is already one page, the time clock (the clock itself, hours so far, today's schedule).

**Decision:** At ≤700px, `/` renders `PhoneToday` (`src/app/(app)/phone-today.tsx`) above the dashboard it wraps, and the dashboard is hidden behind a "Show the full dashboard" toggle. Nothing is removed, and it opens in place. Tablets and desktops never see Today, and their dashboard is unchanged. Once the full dashboard is open on a phone, its Modules tile grid stays hidden, because the More sheet (#089) already offers every page.

The pieces are pure and tested in `src/lib/phone-today.ts`:
- The Needs attention rows are `attentionItems`. The desktop dashboard's alert strip now reads the same function, so the two can never disagree about what is overdue or where it links. Money rows stay hidden from anyone without financials.
- The month deltas are `deltaView`, which the dashboard's KPI tiles also use now.
- Quick buttons (`quickActions`) offer only pages the person can open.
- Next up (`upcomingCards`) shows the first three of the dashboard's own upcoming events. It names the client and offers Navigate when the contact has an address.

The contacts behind those events are fetched by id in the same page load, scoped to the company.

For the crew, the time clock page moves to the first tab and is labelled Today. It is not a new page, because that one already is their day.

**Consequence:** The phone Home adds one small query (the contacts behind at most five events) and no new tables, routes or SQL. A new dashboard alert belongs in `attentionItems`, and then appears on both screens. If the phone should ever open straight on the full dashboard again, remove the wrapper in `page.tsx`; the dashboard itself was not changed apart from reading the shared helpers.


## 091 — On a phone, the Leads board becomes stage chips over a list of cards

**Date:** 2026-09-30

**Context:** The Leads tab (#089) opens the Pipeline. The Pipeline is a Kanban board: 220px columns side by side, cards moved by dragging, and a sideways scrollbar. On a phone that means one column and a sliver of the next, drags that a finger can't make, and a list you can't read without swiping sideways. The approved mockup's next step showed Leads as a list of cards, each with Call, Text and Directions.

**Decision:** At ≤700px the board renders `PhoneLeadList` beside the columns, and CSS shows one or the other. The list is built from the same `displayGroups` the columns use: the same server windows, counts, filters and hidden stages. So it fetches nothing new and cannot disagree with the board.

- **Stages.** Each column becomes a chip with its count. The list opens on the first stage that has leads (`pickPhoneStage`, tested), and a picked chip stays picked while it is still a column. There is no "All" chip, because the board's data is windowed per stage (#020). Merging windows would show an arbitrary mix, and "Show more" could not say what was left.
- **Cards.** Call raises the same `crm:call` event as the lead window's Call button, so the call goes through the CRM's dialer and is logged and recorded. It is not a `tel:` link that would bypass that. Text opens the lead on its Texts tab (LeadForm's new `initialTab`), because the thread lives there. The card line is `leadCardMeta` (tested); stale matches the board's own >14-day rule.
- **What steps aside.** Moving a lead between stages is done from the lead's own stage field. The stat tiles, sort, Select and Columns controls are desk tools and are hidden at this width. The status, rep, no-appointment and age filters stay, in one row that scrolls. The floating New lead button replaces the toolbar's buttons while it is shown.

In the same change, `/pipeline?new=1` now opens the new-contact form. That is the link Quick Create's New Lead and the phone Today screen's New lead button use, and it used to land on the board with nothing open. It follows the estimates page's idiom: open during render behind a consumed guard, then strip the param.

**Consequence:** Anything added to a board card that a phone user needs must also go on `phone-lead-list.tsx`. Nothing forces that, but the list is short enough to check. Quick Create's New Appointment, New Job and New Contract (`?new=1` on /schedule, /production and /contracts) still open nothing; they are the same fix, page by page. (Done in 1.169.1: the four pages share `useQuickCreate`, and the gate is `shouldOpenQuickCreate`.)


## 092 — On a phone, a lead opens full screen with a header of actions; the contact fields move under the tabs

**Date:** 2026-09-30

**Context:** A lead opens in `LeadForm`, a floating modal. On a phone that card opened on the edit form: contact type, first name, last name, three phone fields and email came before anything useful. Call and Text were small emoji links under the form, and the tabs (Texts, Notes, Files) sat a long scroll further down. The approved mockup's last step showed a lead as a screen with the customer and the actions on top, the stage, the next visit, and the activity underneath.

**Decision:** Restyle `LeadForm` at ≤700px, not a second lead screen. It is opened from the Pipeline, Contacts, Tasks and more, and it holds every panel, the autosave and the permission rules. A parallel phone page would drift from it.

- **Full screen.** The modal takes a `className` (`lead-sheet`), and at phone width that card fills the screen with a sticky title bar.
- **`LeadPhoneHero` on top.** It shows the address, "Source · Rep" (`leadSubline`), and Call / Text / Email / Directions as big buttons. Call raises `crm:call` (the dialer, logged), and Text is the form's own `textPhone`. Below that come the stage bar and the next visit (`nextAppointment`: soonest from today, cancelled ones skipped).
  - It is mounted only at phone width (`usePhoneWidth`, matchMedia), because it fetches the lead's appointments, and a desktop that never shows it shouldn't pay for that.
  - It sits outside the form's `<fieldset disabled>`, so a read-only viewer (a Field user) can still call and navigate.
- **Moved with CSS, not by restructuring the JSX.** The form's fieldset becomes a flex column. The tab row gets `order: -1` and scrolls sideways; the open chip is kept in view on phones only, so a desktop card never jumps. The contact block (now wrapped in `.lf-contact`) shows on Overview only, and the old stage bar gives way to the header's. The fieldset also needs `min-inline-size: 0`: by default it is as wide as its content, and the one-line tab row pushed the form 240px past the edge.

**Consequence:** Desktop and tablet DOM order and look are unchanged; only a wrapper div and a class were added. On a phone the visual order (header, tabs, contact, tab) differs from the DOM order (contact, tabs, tab), so keyboard Tab order on a phone runs through the contact fields first. That is acceptable for touch, but a reason to restructure the JSX if this form is ever rebuilt. The mockup's sticky "Add note / Create estimate" bar was not built: Notes is a tab, and the estimate button already sits in the tab row. Anything added above the tabs in `LeadForm` should go inside `.lf-contact` if it belongs to Overview, or it will show on every tab on a phone.

## 093 — The Estimates salesperson filter finds everyone on a document, not just its salesperson

**Date:** 2026-09-30

**Context:** The Salesperson filter on Estimates & Contracts (and the Contract Board) matched a document on one person: the salesperson column (`effectiveEstimateRepId`). Simon closed EST-1068 for Rafi (Rafi in the salesperson seat, Simon in the closer seat), yet picking Simon showed only his own EST-1090. A closer or second salesperson looking for their jobs could not find them.

**Decision:** The filter answers "which documents is this person on", so a document matches when anyone on its sales team is ticked: the salesperson, the second salesperson (at any share, including a pre-0153 contract's closer parked in that seat) and the closer. The team comes from `estimateSeats`, which uses the same rule as the Sales team panel (`getSalesTeam`):
- A signed or void document reads the seats stamped on it at signature, and reads the lead's people only when nothing was ever stamped.
- A live document follows the lead (`assigned_to`, `partner_rep_id`, `closer_id`), just as its salesperson column already does.

The funnel cards follow the filtered rows (cards-follow-filters rule), and each document is counted once however many of its people are ticked. The row lists the rest of the team under the salesperson, so a row the filter found says why it is there.

**Consequence:** With a closer ticked, the Contracts card's money includes the full value of the jobs they closed. That is the value of the documents they are on, not their sales credit. Crediting a sale is a separate question, answered by `sale-credit.ts` (the Salespeople grid, the rep report): there the closer follows a sale with a cut and never holds it, and that is unchanged. The salesperson column itself still names only the salesperson, frozen at signature.

## 094 — A screen share ends by beacon on pagehide, and "Not now" is remembered per browser

**Date:** 2026-10-01

**Context:** The owner got Vanessa's "Screen share invite" on every refresh. An invite is a `screen_shares` row with no `ended_at` (under 4 hours old), and two things kept it coming back. The sharer's goodbye was a Server Action fired from `beforeunload`: an action fired while the page goes away waits behind any other action in Next's queue and dies with the page, and iPhones never fire `beforeunload` at all — so the row stayed "live". And "Not now" lived only in React state, so a reload asked again.

**Decision:** Ending a session goes to a thin route handler, `POST /api/screen-shares/end`, sent with `sendBeacon` (keepalive `fetch` as the fallback) — for Stop and for leaving alike, from `pagehide`, which fires on reload and close in every browser. The route calls the same `endScreenShare`, so the sharer-only scoping and RLS are unchanged. "Not now" (and the banner's ✕) stores the session id in `localStorage` (`crm.screen-share.dismissed`, newest 20); a new session from the same person has a new id, so it still knocks. The pure parts — which session to offer, the stored list, the beacon's body — are in `src/lib/screen-share-session.ts` with tests.

**Consequence:** A reload, close or Stop no longer leaves a ghost invite. A sharer whose tab dies without any event (crash, laptop lid, lost connection) still leaves one until the 4-hour cutoff; its invitee sees it once. Closing that last gap needs a heartbeat column, logged in TECH_DEBT rather than built now.

## 095 — The clock-in location check flags and asks; it never blocks or clocks anyone automatically

**Date:** 2026-10-01

**Context:** The owner asked for geofencing on the time clock. The zones already existed (appointments and the office, #073) but nothing looked at where a clock-in happened. Contractor time clocks usually offer some mix of record-and-flag, ask-for-a-reason, block-outside-the-zone, and automatic clock in/out on arrival. A recommendation page compared them and the owner took the recommended picks.

**Decision:** The server stamps every app clock-in and clock-out with where it happened against the person's places today — appointments, the production jobs they're on (`jobIsLiveToday`; a crew on day 3 of a job has no appointment that day), and the office — and Timesheets flags off-site and no-location clock-ins (0185). In the default "ask" mode a worker clocking in away from every place picks a reason and is clocked in; nothing ever refuses a punch, and clock-outs and breaks are never questioned. Field and Production are checked by default; Sales reps often start the day on calls from home. Blocking was left out: bad GPS, a new subdivision the Census geocoder can't place, or a supply run first thing would lock out honest people, and work done while locked out is an unpaid-wage claim; the office also has no "add missing time" yet. Automatic clock in/out was rejected outright: detecting an arrival needs location while off the clock, which #073 and the notice everyone accepted rule out, and driving between jobs is paid time, so clocking out on leaving a zone would underpay. The phone sends only its location and accuracy; the server decides "at Smith" or "2.3 mi away" and writes the verdict with the service role, and a trigger clears it on a worker's own insert and keeps it on a worker's update, so a punch made by going around the app reads "Not checked". Existing punches take `not_required` from the column default so old weeks don't light up. The check has a 5-second budget (`withDeadline`) because an uncached address asks the Census geocoder, which has no timeout. Every read of the new columns is its own query or a `*` select, and settings save without them, so the app runs unchanged until 0185 is pasted.

**Consequence:** GPS can be faked by a mock-location app; the check is a deterrent and a record, with the location trail and arrivals on Team Map as the second witness. People who accepted the location notice before 1.171.0 haven't seen its new sentence about the check (the privacy page already said "when and where you clock in and out"). A clock-in that runs past the 5-second budget is stamped "no job or office on the map to check against" rather than flagged. Job arrivals and the job-zone half of "on site" need 0185.

## 096 — Bills are added, fixed and deleted in Projects and Bills to Pay; a contract's Job costs only files them to a phase

**Date:** 2026-10-02

**Context:** Paying a bill writes two linked rows: the payment (`vendor_bill_payments`, what Bills to Pay shows) and a job cost (`job_expenses`, source `bill`, what the job counts as Spent). The link is `on delete set null` from the payment's side (0121) so that deleting a cost by hand never erases the payment record. But the contract page's Job costs panel put a × on every cost, and `deleteJobExpense` didn't refuse a bill payment's cost the way `updateJobExpense` already refused to edit one. The owner deleted a $6,030 check that way: Bills to Pay still showed it paid with $220 left, while the job showed $0 spent and a 100% margin. The owner asked whether bills should be entered only on the Projects page and in Bills to Pay.

**Decision:** The server refuses to delete a bill payment's cost (or a QuickBooks one) on its own, whatever screen asks (`expenseDeleteLock`). Instead it names the place to go: deleting the payment in Bills to Pay (`deleteBillPayment`) removes both rows together. The contract page's Job costs panel loses its × and its "+ Add bill" and links to the job in Projects (`/projects?focus=<estimateId>`) and to Bills to Pay instead. It keeps the per-phase profit table and the phase dropdown. Those two only file costs and move no money, and the panel is the only place a cost can be filed to a specific phase: Projects' "+ Add bill" and Edit only ask which *contract*, and only when there are several. Removing the dropdown would have left every new cost on "Not filed". On a bill payment's cost the dropdown files the whole bill (`phaseRefileIds`): the bill and every payment's cost move together, so a bill never sits in two phases and its next payment lands on the chosen one. The picked phase is checked to be on the job (`phaseIsOnJob`), as Add bill already did.

**Consequence:** A bill can no longer be filed to a phase at entry, which only the contract page's Add bill offered. It is filed afterwards from the dropdown. A QuickBooks-sourced cost can't be deleted anywhere in the CRM (only the old × could), which matches its edit lock. Payments already split before this shipped stay split until someone deletes the leftover payment in Bills to Pay. This finds them: `select … from vendor_bill_payments p join vendor_bills b on b.id = p.bill_id where b.lead_id is not null and p.job_expense_id is null`.

## 097 — An account is changed by its owner, the server, or someone who runs every company it works in

**Date:** 2026-10-02

**Context:** A person's account (name, phone, sign-in email, password, and the `is_platform_admin` / `is_super_admin` flags) lives on `profiles`, which has no company: one login can work in several companies, and its phone is where each of them texts that person. Three paths let a company reach past itself. `updateUserProfile` changes the account through the service role and only checked that the caller was Office or Admin somewhere, not that the person worked for them. The API let a signed-in person write any column of their own `profiles` row, the flags included. And `profiles_office_manage` (0036) let Office write the profile of anyone sharing a membership row with them, which `company_members_write` lets Office create for any profile id.

**Decision:** `accountEditBlock` (`src/lib/data/account-edit.ts`, tested) decides, and `updateUserProfile` asks it before touching anything. You may always edit yourself. Nobody else edits a platform or super admin. Otherwise the person must hold a real (not platform-granted) seat in the current company, and every company where they hold a seat, archived ones included, must be one where the editor is an Active Office or Admin. So an owner running two companies still edits the people who work in both. In the database (0188), the API keeps update rights on exactly `name`, `phone`, `estimate_funnel_order` and `dashboard_panel_order`, still only on the caller's own row. `profiles_office_manage` is dropped, and `revoke_platform_admin_if_not_last` runs for the service role only. `findUserByEmail` matches the lowercased address exactly instead of with `ilike`, where `_` and `%` were wildcards. `updateUserProfile` now saves emails lowercased so exact lookups find them. `profile-write-lockdown.test.ts` fails if code writes any other `profiles` column through the signed-in client.

**Consequence:** Someone who also works for a company the editor doesn't run changes their own account. They reset a forgotten password from the sign-in page. Any new self-editable profile column needs adding to 0188's grant in a new migration, or its save fails with "permission denied". Proven on a replay of the migrations into local Postgres. Before 0188, a Field user could make themselves a platform admin (gaining Office+Admin in every company), change their own email, and an Office user could rewrite another company's rep's phone. After it, all three are refused while the four self-edits still save.

## 098 — The nightly backup is stored only locked with a password

**Date:** 2026-10-02

**Context:** `nightly-backup.yml` saved the full export (every company's customers, texts, calls, staff and settings) as a plain JSON GitHub Actions artifact, kept for 90 days. This repository is public, and anyone signed in to GitHub can download a public repository's artifacts. The 57 stored backups were deleted on 2026-10-02 at the owner's request.

**Decision:** The job checks the `BACKUP_PASSPHRASE` secret first and stops before exporting anything if it is missing. After the existing checks it locks the file with gpg (symmetric AES-256), deletes the plain copy, and uploads only `crm-backup-*.json.gpg`. gpg runs with a fresh `mktemp -d` key folder, because its agent can't start where the socket path is too long and gpg then exits non-zero. `src/lib/backup-workflow.test.ts` fails if the check, the lock or the upload path changes.

**Consequence:** Until the owner adds the `BACKUP_PASSPHRASE` secret (Settings → Secrets and variables → Actions), the nightly job fails instead of storing an open copy. Opening a backup: `gpg --decrypt crm-backup-YYYY-MM-DD.json.gpg > crm-backup.json`, then type the password. On Windows, Gpg4win provides `gpg`. A lost password means the stored backups can't be opened, so it belongs in the owner's password manager. Moving the backup off GitHub entirely (or making the repository private) would remove the need for this. The company-scoped Backup download is a separate change.

## 102 — A row that names a contact belongs to that contact's company, checked by a trigger for every caller

**Date:** 2026-10-02

**Context:** RLS on every tenant table checks the row's own `company_id` against the caller's memberships. Nothing checked that the contact a row points at (`lead_id`) is in that same company. An Office user of company A could insert an estimate, note, appointment or text into A naming B's contact; replayed against the migrations, this succeeded. Admin-client code trusts those ids: `previewEstimateEmail` read B's contact's address, the lead-touch helpers showed B's name and phone, and the no-show cron moved B's contact's stage and texted B's customer.

**Decision:** Migration 0189 adds `lead_in_same_company()`, a SECURITY DEFINER `BEFORE INSERT OR UPDATE OF <lead columns>, company_id` trigger. It looks up each named contact and refuses the row (`check_violation`) when the contact's company differs from the row's. Null references are skipped, and a missing contact is left to the foreign key. SECURITY DEFINER so a rep whose RLS hides a colleague's customer can still photograph them. It runs for the service role too, because the admin client is where an unchecked id did the harm. `apply_lead_company_checks()` stamps the trigger on every public table with a `company_id` and a single-column foreign key to `leads(id)`: 21 tables at the time, including `documents.contact_id` and both columns of `lead_duplicate_dismissals`. `lead_trash` has no foreign key and is left out. It also prints a WARNING per table for rows that already cross companies, without changing them. A composite foreign key (`(lead_id, company_id) → leads(id, company_id)`) was the alternative. It needs a new unique index on `leads` and fails to create while any bad row exists, so it would block the fix on a data cleanup. The trigger doesn't.

**Consequence:** A new table referencing `leads` needs `select public.apply_lead_company_checks();` at the end of its migration; `lead-company-check-migrations.test.ts` fails otherwise, as for the billing lock. Every write to these tables costs one primary-key lookup per named contact. Moving a contact to another company (no feature does today) would need its rows moved in the same statement batch, or the trigger refuses the stragglers.

## 099 — Settings → Backup exports the current company only; the full export is the nightly job's

**Date:** 2026-10-02

**Context:** The Backup page's download (`downloadBackup`) was gated on Office or Admin, the company-level roles every self-serve owner gets, and then called `buildBackup()`. That read all 44 backup tables through the service role with no company filter. So any company's admin downloaded every company's customers, texts, calls, staff and settings, encrypted keys included, and the page showed platform-wide row counts.

**Decision:** `buildBackup` and `countBackupRows` take a scope. `"all"` is used only by the nightly cron route, behind the cron secret, and a test fails if anything else asks for it. Settings passes `{ companyId }` for the current company. `companyScopeColumn` (`src/lib/backup-scope.ts`, tested) narrows each table: `companies` by `id`, people through `company_members` (not `profiles.company_id`, which is the legacy first company; seats granted only for platform admins are left out, as the roster leaves them out), and everything else by `company_id`. A company's own file also drops saved keys, webhook secrets and access tokens (`withoutSecrets`: `*_enc`, `secret`, `token`, `password`, `api_key`), matching the settings pages, which never send those back to a browser. The nightly export keeps them, because it is the copy a restore is made from.

**Consequence:** A company's download can't be restored as-is into another database: it has no secrets and no other companies' rows. It is an export of the company's own records, which is what the page now says. A table added to `BACKUP_TABLES` without a `company_id` column fails the company-scoped read and shows up under "Couldn't read", so it can't silently leak.

## 100 — The recording proxy sends Twilio credentials only to Twilio, for that account's recordings

**Date:** 2026-10-02

**Context:** `/api/voice/recording/[id]` plays a Twilio recording by fetching the URL stored on the call's `call_logs` row with the company's account SID and auth token as Basic auth. For a company without its own Twilio, those are the platform account's (`getTwilioForCompany` falls back). The row is not written only by the recording webhook: `call_logs` insert/update RLS lets members write it. Nothing checked where the URL pointed, so the credentials went wherever the row said.

**Decision:** Before the credentialed fetch, `twilioRecordingUrlAllowed` (`src/lib/recording-range.ts`, tested) requires https, no userinfo or port, host `api.twilio.com` or a regional `api.<edge>.<region>.twilio.com`, and the path `/2010-04-01/Accounts/<this account's SID>/Recordings/RE<32 hex>` (with an optional `.mp3`/`.wav`, which is what `recording-status` stores). Anything else answers 404 "No recording." with no request made. A test also fails if the route's check stops coming before its fetch. The other credentialed Twilio fetches (`sms.ts`, `phone-numbers.ts`, `voice-intelligence.ts`, `screen-share.ts`, `twilio-env.ts`) build their URLs from fixed Twilio hosts and were left as they are. The PrimeCall branch already sends its key only to its own server. The CallRail branch's media URL comes from CallRail's API response, not from the row.

**Consequence:** A recording made on one Twilio account and played while the company is on another (it connected its own after recording on the platform's) now gets a 404 from the check rather than a 401 from Twilio. Playing those needs the call's account SID stored on the row, which belongs with the Phase 1 per-company Twilio work. Rotating the platform account's auth token after this ships closes off anything taken before it.

## 101 — Admin-client actions check the id they're handed belongs to the caller's company; Drive plumbing is server-only

**Date:** 2026-10-02

**Context:** A few server actions took an id from the browser and then worked through the service role, which RLS never sees, without checking the id's company. `sendPortalLink` had no auth check at all. Given any contact id, it extended that contact's portal access and texted and emailed them a sign-in link from their company's own number. `uploadLeadFile` and `recordLeadFile` trusted `leadId`, guarded only by "the storage path starts with it". `getOrCreateLeadDriveFolder` read and wrote any lead by id. Every export of `lib/actions/google-drive.ts` was a server action because the file is `"use server"`, including `getValidAccessToken(companyId)`, which returns a company's live Drive token; no client imported it yet. The Google Drive and Calendar OAuth callbacks took the company (and the rep) from a cookie and never compared it with who was signed in, unlike the Meta callback. The portal's "email me a link" form matched with `ilike` on the raw typed address, where `_` and `%` are wildcards.

**Decision:** `sendPortalLink` requires a signed-in caller and first finds the contact through the caller's own RLS, in their current company, matching who can open the card the button sits on. All three lead-file entry points call `leadInCompany` (admin client, company-scoped, for the colleague's-customer reason `createLeadFileUploadUrl` already gave) before any storage, Drive or database work. The Drive plumbing moved to `src/lib/google-drive-api.ts` (`import "server-only"`), and the lead-folder lookup and write are filtered by company. `actions/google-drive.ts` keeps only `getGoogleDriveStatus` and `disconnectGoogleDrive`. Both Google callbacks call `oauthTargetAllowed` (`src/lib/oauth-target.ts`, tested): same company as the signed-in person, and their own calendar, or Office/Admin for a company-wide connection. They call it before exchanging the code. The portal form escapes the typed address (`exactEmailPattern`). `company-checks.test.ts` pins each check in place before the work it guards.

**Consequence:** A Drive or Calendar connection started in one company and finished after switching to another is refused; the person starts it again. A signed-in rep whose RLS hides a contact can no longer send that contact a portal link; "Copy portal link" (`createPortalLinkForStaff`) was already company-scoped and role-gated.

## 103 — The shared Twilio account moves into its owner's settings before it stops being lent

**Date:** 2026-10-02

**Context:** `getTwilioForCompany` and `getTwilioVoiceForCompany` lend the deployment's `TWILIO_*` account (La Home Contractor's, from when the CRM served one business) to every company that hasn't connected its own. Customers of every other company get texts and calls from La Home's number, and their replies land on La Home's line. The owner chose to end the lending (Phase 1, option A): a company without its own account can't text or call until it connects one. Switching it off as-is would also have cut off La Home, whose own `company_profile` row holds no Twilio settings, because it only ever ran on the fallback.

**Decision:** Two steps. This one changes nothing for any customer. `adoptSharedTwilio` (platform admin only, inside the company the account belongs to) copies the shared account into that company's own row server-side, with the token and API secret sealed like any connected account. It is refused when the company already has its own or another company holds the shared account or number (`adoptSharedBlock`). Settings → Twilio says when a company is borrowing (`twilioSource`). Platform Admin lists every company's source, the number its customers see, and companies saved with the same Twilio account, which callbacks can't tell apart (`twilioOverview`). All three rules live in `src/lib/twilio-source.ts` and are tested. The second step removes the lending once the owner's company has moved its account in and the borrowing companies have connected their own or accepted losing texting.

**Consequence:** The Platform Admin list is the checklist for the switch. Every "Borrowing the shared number" row is a company whose texting stops then.

## 105 — Switching company ends in a full page load

**Date:** 2026-10-02

**Context:** `switchCompany` only changes the `current_company_id` cookie. Its callers then ran `router.refresh()` or `router.push()`, which re-render the server components but keep every client component's state. The dialer (`voice-dialer.tsx`) builds its Twilio `Device` once and reuses it while its token is fresh. So after switching from La Home Contractor to Ca Pro Builder, the owner's calls still went out on La Home's account, and his phone showed La Home's number and name. Views that copy server props into `useState` (tasks, pipeline board, dashboard) showed the previous company's rows the same way.

**Decision:** Every switch (the company switcher, including New company; Platform Admin's Open company and Open Twilio settings; the billing-lock screen) finishes with `openInCompany(path)`: a full `window.location.assign` to an absolute URL on this site (`companyUrl` keeps the destination on-origin). Nothing from the previous company survives in the browser, the dialer included. `open-in-company.test.ts` fails if a client file calls `switchCompany(` or `createCompany(` without it.

**Consequence:** A switch costs a full page load, which a person switching company barely notices. The dialer still needs the new company's own calling setup to call from that company's number: a company without one borrows the shared account until #104 removes the lending.

## 106 — Twilio details are checked with Twilio before they are saved, and the dialer shows Twilio's reason

**Date:** 2026-10-02

**Context:** Setting up Ca Pro Builder's in-app calling, Settings → Twilio saved the API Key SID, Secret and TwiML App SID without asking Twilio anything, and the page then said "In-app calling is configured". The first call failed with "Could not place the call." When Twilio refuses the calling pass (a secret that doesn't belong to the SK key, or a key from another Twilio account), the Voice SDK closes its connection and rejects `connect()` with no value at all. Twilio's reason only arrives as an `error` event on the Device, which `voice-dialer.tsx` never listened for. The closed connection was also kept and reused, so every later try failed the same way until the page was reloaded, even after the keys were fixed.

**Decision:** `saveCompanyTwilio` refuses half-filled calling boxes (`voiceFieldsBlock`) and then asks Twilio before saving (`checkTwilioSetup`). It fetches the account with the Account SID and Auth Token, looks the number up in that account, and fetches the TwiML app with the API Key SID and Secret, the same pair the calling pass is signed with. It also checks that the app's Voice Request URL is the CRM's `/api/voice/twiml`, by POST, on any of its domains. Each refusal says what to fix. If Twilio can't be reached, nothing is saved. In the dialer, the Device's `error` event is kept for the attempt. A failed connect is explained from it (`callFailureMessage`), and after a refusal or a reasonless close the Device is destroyed so the next try mints a fresh pass (`shouldRebuildDevice`). Never after an ordinary error such as "A Call is already active", where that would hang up a live call.

**Consequence:** A wrong key, number or app is caught when it's typed, not on the first customer call. Saving Settings → Twilio now needs Twilio to answer (a few hundred milliseconds). The Platform Admin "move the shared account" action doesn't go through this check: it copies the server's own working settings.

## 107 — The calling key must be the company's own account's key

**Date:** 2026-10-04

**Context:** After #106, Ca Pro Builder's calls still failed. The dialer now showed Twilio's reason: error 31100, "The request could not be understood due to malformed syntax". Ca Pro's setup was saved before #106's checks existed, so it hadn't been checked. The owner's screenshot showed both of the CRM's API keys listed in the California Pro Builders account, so a key from the wrong account isn't the cause there. Looking into it showed one gap left in #106's check, though. Twilio's access tokens want the API key from the same account as the Account SID they carry. A main account's key can read its sub-accounts, so reading the TwiML App with the API key would pass for a key made in the main account.

**Decision:** `checkTwilioSetup` also asks the account itself, with its Account SID and Auth Token, for `Keys/{SK}`. An account only lists its own keys, so a 404 means the key was made elsewhere. The refusal says to pick the company's account in Twilio's account menu and create the key there. In the dialer, 31100 joins the codes that mean a refused calling setup. The message now says the API key and TwiML App must both come from the number's own Twilio account, and the connection is rebuilt for the next try.

**Consequence:** One more request to Twilio when in-app calling is saved. A setup that saved before this check isn't re-checked until it's saved again; the dialer's message points the admin there.

## 104 — No company texts or calls from another's Twilio account, and an unknown number is never guessed

**Date:** 2026-10-02

**Context:** The second step of #103. `getTwilioForCompany` and `getTwilioVoiceForCompany` lent the deployment's `TWILIO_*` account (La Home Contractor's) to every company without its own. Ten webhook routes verified any request from an unrecognised account or number with that account's token. Once verified, they treated it as the platform's. An inbound text to a number nobody owned was matched against every company's contacts and staff. An inbound call to one rang whichever company had a forwarding number first and could start that company's AI receptionist. The owner chose option A: a company without its own account can't text or call.

**Decision:** Both lookups return the company's own credentials or null. Every route resolves the company from the receiving number or the request's AccountSid. With no company, or no credentials, it gives its existing safe answer (an empty TwiML reply, "This line is not configured", the failsafe receptionist line, the recording notice) and acts on nothing. The SMS webhook matches leads, staff (now through `company_members`, not every profile on the platform), the rep's appointments and the rep's last crew message only inside the receiving company, and always files the message there. The dialer's chosen caller ID must be one of the calling company's own numbers. `saveCompanyTwilio` refuses an account SID another company already uses, because callbacks carry the account, not the company. One Twilio login running several companies needs a subaccount for each. `twilio-no-fallback.test.ts` fails if anything other than `twilio-env.ts`, `twilio-company.ts` (identifiers only, for the Platform Admin page and the move) and `actions/twilio-admin.ts` (the one-time move) reads the shared account, the same as Stripe (#076). The "borrowing" state left `twilio-source.ts`: a company has its own account or none.

**Consequence:** Merge only after the company that owns the shared account has moved it in (#103). Until then, that company's own inbound texts and calls would be answered as unknown. Every company the Platform Admin list shows as "Can't text or call" loses texting, reminders and calling until it connects its own account. Companies already saved with the same account SID must be split onto subaccounts first, or their callbacks resolve to neither.

## 108 — Job files, receipts and company documents are private; the CRM checks who asks before it signs a link

**Date:** 2026-10-05

**Context:** The `lead-files` bucket (0024) and the `company-docs` bucket (0073) were created public. Every saved link (`lead_files.file_url`, `company_documents.file_url`, `job_expenses.receipt_url`, `vendor_bills.receipt_url`) was a permanent public Supabase URL from `getPublicUrl`. Anyone holding one could open the file for ever, signed in or not, whichever company they belonged to: a forwarded email, a former employee, a customer's old browser tab. No `storage.objects` policy existed at all.

**Decision:** Both buckets are private (0190). Every saved link is the CRM's own address, `/api/files/<bucket>/<path>` (`privateFileUrl`, `src/lib/files/file-url.ts`). The route there (`src/app/api/files/[bucket]/[...path]/route.ts`) first decides who is asking, then redirects to a signed link that lasts an hour (long enough to play a site video through):
- **Staff:** asked with their own signed-in client whether they can see a record that points at the object (`lead_files.file_path`, `job_expenses` / `vendor_bills.receipt_path`, `company_documents.file_path`). Row-level security on that record decides, the same rule that decides what the screens list (`staffCanReadFile`).
- **Portal customers:** read from the portal cookie without writing to the session, and refused once their access has lapsed. They may open their own job's files, the company documents marked for the portal, and a receipt only while a line on one of their own non-draft documents bills that cost back with its receipt switched on (`portalCanReadFile`).

The object is reached through its record, never its path alone: a merged duplicate keeps its old lead id in the path, and a bill and its job cost share one receipt object. "Not yours" and "not there" give the same 404. The migration rewrites every saved public link to the new address, keeping the path exactly as Supabase encoded it; Drive links are left alone. It counts any row the route can't authorise as a WARNING. Logos stay public: the portal shows one before the customer has signed in. `private-files.test.ts` fails if anything but the logo upload calls `getPublicUrl` again, or if the route signs before it checks.

**Consequence:** A copied or forwarded link opens nothing for someone without access. Every view costs one extra request (the route, then the signed link); the person's own browser may reuse that redirect for five minutes (`private, max-age=300`, never a shared cache), so a page of photos isn't downloaded again on every visit. The migration must run after the version with the route is live; run earlier, pictures are blank until the deploy lands.

## 109 — The phone app asks for the microphone, and the dialer stays in the phone's top bar

**Date:** 2026-10-04

**Context:** Reps reported they couldn't dial from the Android app, and that there was no dial button. Two separate causes. First, the in-app dialer is a WebRTC call, so it needs the microphone. Inside the app, the WebView's request for it goes to Capacitor (`BridgeWebChromeClient.onPermissionRequest`), which asks Android for `RECORD_AUDIO` and `MODIFY_AUDIO_SETTINGS` and denies the page unless both are granted. The manifest declared only `INTERNET`, and Android refuses a permission the manifest never declares without asking. So every call from the app failed before it rang, and the dialer showed Twilio's own sentence ("PermissionDeniedError (31401): ... user media"). Second, #089 hid the top bar's tools on phones and put them in More. The dialer went with them, so dialing a number by hand meant More → scroll past every page tile → Tools → Dialer.

**Decision:**
- The Android manifest declares both microphone permissions, and the iPhone app's Info.plist carries `NSMicrophoneUsageDescription` (iOS closes an app that opens the microphone without one). `phone-app-mic.test.ts` fails if either goes missing. Android asks once, on the first call.
- A blocked (31401) or unopenable (31402) microphone gets a plain sentence from `callFailureMessage`: in the app, where to allow it in the phone's Settings; on the website, to allow it for the site. Call errors now go through the same function, so Twilio's raw sentence is never shown.
- At ≤700px the dialer's `.tool-slot` is the one tool not hidden, so the green phone sits beside the bell and Quick Create. Its row leaves More. The other tools stay in More as #089 set out.
- At ≤700px the dialer panel spans the screen under the top bar and is capped between the bar and the tabs, scrolling inside, so Call and Hang Up are always on screen. Keys and buttons are 48px tall. The number box is `type="tel"`, so it opens the phone's number pad rather than the full keyboard. Tablets and desktops are unchanged.

**Consequence:** The permission is native, so the Android app needs a new build from **Android App (Play release)** and an upload to Play before calls work there. The website and the phone browser get the rest with the deploy. The phone top bar now holds three controls (dialer, bell, Quick Create) next to search; it still fits at 360px.

## 110 — A company sends from its own address only through its own Resend account; replies always go to the company

**Date:** 2026-10-05

**Context:** Every email goes through `sendEmail` with the shared `RESEND_API_KEY` and `EMAIL_FROM`, and that address is La Home Contractor's (`info@lahomecontractor.com`). This caused two problems:
- **Replies went to La Home.** A company with no address of its own sent its customer emails from that address under its own name (`companyFromHeader`, release 1.158.3) with no Reply-To. A customer who replied to Ca Pro Builder's portal link or bulk email was writing to La Home's inbox. This is the email version of the problem #103/#104 fixed for texts and calls.
- **Any company could send as another.** `getEmailForCompany` lent the shared key to any address a company typed in Settings → Email (0099). Resend sends from every domain verified in the shared account, La Home's included, and `saveCompanyEmail` checked only that the text looked like an address. A company admin could have typed La Home's address and sent as La Home.

**Decision:**
- **Who sends what is decided by `companyEmailPlan` (`src/lib/email-from.ts`, tested).**
  - With its own address and its own Resend key, the company's account sends. Resend refuses any domain not verified in that account, which is the proof the company controls it.
  - Otherwise the shared account sends from the shared address under the company's name, with Reply-To set to the company's main email (`company_profile.email`). If that's missing, Reply-To is the address the company typed.
  - The shared key is never paired with a company's own address.
- **Replies.** Portal links and bulk email pass that Reply-To. Bulk email falls back to the sender's own email. The estimate email keeps replying to the rep who sent it.
- **Saving an address.** `saveCompanyEmail`:
  - needs a key (a stored key is kept when none is retyped)
  - refuses Resend's `resend.dev` sandbox address
  - sends the admin a test email from the new address through that key before saving anything
  - if Resend refuses, reports why and which domain to verify
- **What stays the same.** System emails (password reset, signup invites) still use the shared sender.

**Consequence:**
- A company that had saved an address without its own key now sends from the shared address under its name, with replies to that address, until it adds a key. Settings → Email says so.
- **Two owner steps finish the move to AI Build Pros:**
  - **La Home:** add a Resend API key from the account where `lahomecontractor.com` is verified, in La Home → Settings → Email.
  - **The shared sender:** verify `aibuildpros.com` in Resend, then change `EMAIL_FROM` in Vercel to an AI Build Pros address.


## 111 — The Speaker button is the app's own plugin, and shows only where it works

**Date:** 2026-10-05

**Context:** Once calls worked in the Android app (#109), the owner asked for a speaker button. A call from the CRM is WebRTC inside the app's WebView. A web page can't choose between the phone's earpiece and its loudspeaker: browsers on Android offer no output choice, and the WebView picks the route itself when the call opens the microphone.

**Decision:**
- The app carries a small plugin of its own, `CallAudioPlugin.java` (`CallAudio`), registered in `MainActivity` before the bridge starts. It has two methods. `isSpeakerOn` reports the live route; `setSpeaker` switches it, then reports the result. On Android 12 and later it uses the communication device (loudspeaker or earpiece; a tablet with no earpiece hands the route back to Android). Earlier versions use `setSpeakerphoneOn`. It relies on `MODIFY_AUDIO_SETTINGS`, already declared for #109.
- `src/lib/call-audio.ts` is the CRM's side. The dialer shows **Speaker** between Mute and Hang Up only when `speakerSwitchAvailable()` is true: inside the app, *and* the app build carries the plugin. The website, and an app installed before this build, show no button rather than one that does nothing.
- The button's state is read back from the phone, never assumed. It's read when the call rings, when it's answered, and after every tap, so it shows the route that's actually live (blue while the loudspeaker is on).
- `call-audio.test.ts` holds the plugin's name and methods to the Java side, and checks it's registered before the bridge starts. A mismatch would otherwise fail silently: the button would just never appear.

**Consequence:** It needs a new Play build. The iPhone app has no plugin yet, so it shows no button. The route the WebView chooses at the start of a call is left as Android sets it.

## 112 — Recordings from the borrowing days play with the shared account, only from a list made once at the switch

**Date:** 2026-10-05

**Context:** Before #104, a company without its own Twilio borrowed the shared account (the server's `TWILIO_*` settings, La Home Contractor's), and its calls were recorded there. Since #104 the recording player fetches with the company's own account only (`getTwilioForCompany`), and #100 refuses a recording that isn't on that account. So those older recordings stopped playing:
- Ca Pro Builder, now on its own account, got "No recording."
- Companies with no Twilio of their own couldn't play any of their earlier calls.

The shared account can't simply be used for any recording on it. `call_logs` is writable by a company's own members, so a row edited to point at one of La Home's recordings would then be fetched with La Home's credentials.

**Decision:**
- **The list.** `0191_legacy_shared_recordings.sql` lists, once, every call whose saved Twilio recording is on an account other than the one its company has saved now. The table is not `call_logs`: RLS is on with no policies, and anon/authenticated have no rights on it. Only the migration writes it, and only the server reads it.
- **Which account plays a recording.** The recording route picks the account with `recordingCredentialChoice` (`src/lib/recording-range.ts`, tested):
  - the company's own account, for a recording on that account
  - otherwise the shared account, through `legacySharedRecordingCreds` (`src/lib/twilio-company.ts`), only for a recording on the shared account itself that is on the list for that exact call and URL
  - otherwise nothing
- **Guard test.** `twilio-no-fallback.test.ts` pins the list lookup and the table's lockdown.

**Consequence:**
- Old recordings play again for every company, and new calls never use the shared account.
- The list never grows: a company that borrows nothing has nothing new to add.
- If the `TWILIO_*` settings are ever removed from the server, these old recordings stop playing again.

## 113 — A text belongs to whoever sent it, or to whoever texted that number last; four roles see every text

**Date:** 2026-10-05

**Context:** Every member of a company could read every text in it: 0117's `sms_messages_select` checked the company and nothing else. So the Reply Inbox, a contact's Texts tab and Text Reports showed each rep every other rep's conversations. Customer replies weren't given to anyone, and `sent_by` (0054) only said who pressed send. The owner asked for texts to be private, and for a way to text a number from the dialer.

**Decision:**
- **Who sees every text:** Admin, Office, Dispatch and Call Center (the owner's choice). Everyone else sees only texts they own or sent. The boundary is RLS on `sms_messages` (migration 0192), not the screens.
  - Every reader that goes through the signed-in user narrows on its own: the inbox, the Texts tab, Text Reports, the inbox badge's `text_alert_rollup`, and the daily brief.
  - The admin-client readers are an Admin-only activity report, the customer's own portal thread, and the AI conversation analysis (below).
- **A text's owner** (`owner_id`) is set by a `BEFORE INSERT` trigger, so no send path has to remember it:
  - A text someone sent is theirs.
  - A customer's reply belongs to whoever texted that number last. Numbers are compared on their last ten digits (`contact_phone_key`), because outbound numbers are saved as typed and replies arrive as `+1…`.
  - With nobody to go by (an automatic reminder, a number nobody texted), the owner is the contact's assigned rep.
  - Otherwise there is no owner, and only the four roles see it.
  - The migration gives texts already saved an owner by the same rule; a reply goes to whoever texted before it arrived.
- **Ownership is per text, not per thread.** If two reps text the same customer, each sees their own texts and the replies that followed them.
- **Text in the dialer:** a Text button next to Call, for people who may send texts (`canEditDispatch`, the same check `sendSms` makes). `sendDialerText` turns the typed number into `+1…` and files the text on the contact who owns that number. It uses the lookup the dialer's calls use (`leadForPhoneNumber`), as the signed-in user, so it never lands on a contact they can't see.
- `text-privacy.test.ts` pins the four roles, the owner rule and the migration's safety; `dialer-text.test.ts` pins the Text button and its send path. The migration was also run against a copy of the tables in PGlite (an in-process Postgres), signed in as each role.

**Consequence:**
- **Nothing changes until 0192 is run**; until then everyone keeps seeing every text.
- A Field, Bookkeeping or Production user sees no texts they didn't send, which includes office texts to crew about a job.
- The AI conversation analysis still reads the contact's whole conversation through the admin client. It shows signals, not the texts themselves.
- Reassigning a contact doesn't move texts already owned; a reply still goes to whoever texted last.
- 0192 defines `contact_phone_key` itself, word for word as 0129 has it. Production never ran 0129, so the first paste stopped at "function contact_phone_key(text) does not exist". 0129 can't be run now: it would put back an older `create_lead_for_unknown_caller` over 0150's. With the helper in place, 0150's one-contact-per-new-caller guard, which calls it, starts working; until now CallRail and the AI receptionist had been taking their unguarded fallback.

## 114 — Facebook Page tokens and app secrets are stored encrypted, and only an admin can change them

**Date:** 2026-10-05

**Context:** A company's Facebook Page token and its own Meta app secret (the advanced setup) were kept unencrypted in `company_profile`, unlike the Twilio, Stripe, CallRail, Primecall and Resend keys, which are stored encrypted (`*_enc`, `APP_ENCRYPTION_KEY`). The settings page also sent the saved values to the browser to fill its form, and the advanced form's save did not check the person's role.

**Decision:**
- **One module owns the keys.** `src/lib/meta/page-secrets.ts` (server-only, service role) is the only code that reads or writes them; the rules are in `page-secrets-rules.ts` (tested). A test fails if any other file names the plain columns.
- **Stored encrypted.** New columns `meta_page_access_token_enc` and `meta_app_secret_enc` (0193). Every save writes the encrypted copy and clears the plain one.
- **The old plain copies are moved out of reach at once.** SQL can't encrypt (the key lives on the server), so 0193 moves them into `meta_secrets_legacy` (RLS on, no policies, no rights for signed-in users) and clears them from `company_profile`. The first time the server needs a company's keys it encrypts them and deletes that company's row there. If a key can't be encrypted, nothing is changed.
- **Never sent to the browser.** The settings page shows whether a token or secret is saved. The boxes start empty, and a blank box keeps the saved one.
- **Admin only.** `saveMetaConfig` checks the role (Office or Admin), like every other integration setting. A save error is shown instead of "✓ Saved".
- **Works before 0193 is run.** Reads fall back to the plain columns and a save stores the old way, so no lead is dropped in between; 0193 then moves what was saved.

**Consequence:**
- **Owner step:** run `0193_meta_secrets_encrypted.sql` in Supabase after the deploy. Its last line should read `plain_left = 0`.
- Nothing changes for a connected Page. Leads keep arriving.

## 115 — The database files record everything production has, and a catch-up file runs what it missed

**Date:** 2026-10-05

**Context:** Code deploys automatically, but database changes are pasted into the Supabase SQL editor by hand. A full read-only comparison of production with `schema.sql` + every migration (`supabase/checks/schema-drift-check.sql`, built from a local replay of the files) found the two had drifted both ways:
- **Made by hand in production, recorded nowhere:** the company Twilio and Stripe columns (and the unique Twilio-number index), `leads.dispatcher_id`, `lead_files.event_id`, `company_profile.dispatcher_commission_bp`, the `logos` bucket, `dispatcher_may_touch_lead()`, and the split of `events_write` into `events_insert` / `events_update` / `events_delete` that 0084 already mentioned. A database built from the files failed at 0069, 0088, 0095, 0117 and 0191, and `schema.sql` itself stopped at a copy of 0165 that came before the table it needs.
- **In the files, never run in production:** 0137 (Call Center edits a contact and adds call notes from the dialer), 0138 (AI call notes), 0171 (dispatch dashboard summary) and 0182 (record of deleted files). The `portal_payments.recorded_by` link also lacked the `on delete set null` 0151 intended.
- About 230 more differences were noise: line endings (functions pasted from Windows) and comments.

**Decision:**
- **0067 records the hand-made objects**, copied exactly from production, in a free slot before the first file that needs them. Every statement is guarded, so running it in production changes nothing.
- **0194 catches production up.** The owner runs 0137, 0138, 0171 and 0182, then 0194. 0194 stops with the list of files still missing if run too early. It restores the payment link's `on delete set null`, restates 0129's execute rights on `create_lead_for_unknown_caller` (0150 applied the same in production; restated so 0194 on its own guarantees it), and applies the billing lock and same-company trigger to the new table.
- **`schema.sql` drops its out-of-order copy of 0165.**
- **The check stays in the repo** (`supabase/checks/`). It ignores function comments and line endings, and covers function execute rights. It compares against the files as of 0194, so later migrations show as `only_live` until it is regenerated.
- **Settings → Database Health probes 0067, 0138 and 0182–0193**, so a skipped file is named instead of a feature failing quietly.

**Proof:** a database built from the files alone now applies with no errors and no stand-ins. A copy set up like production (those four files skipped, the old payment link) given 0137 → 0138 → 0171 → 0182 → 0194 ends identical to it, object for object (1,935). The check reads that copy as having no differences, also when pasted with Windows line endings.

**Consequence:**
- **Owner step:** run the five files in order in Supabase, then re-run the check. It should list nothing but the version row.

## 116 — Examples, hints and "What's new" use made-up details, never a subscriber's

**Date:** 2026-10-05

**Context:** Every company sees the same contract merge-field examples, form hints and "What's new" notes. They carried La Home Contractor's name, address, phone, email and licence number, a client name, phone and address that looked real, the owner's name, another subscriber's email address, and three release notes naming La Home or a person. Code comments and tests in this public repository also held real-looking phone numbers.

**Decision:**
- Examples and hints use the tutorials' made-up company: Summit Builders Co, 555-01xx phone numbers, @example.com addresses, made-up people (Jordan Rivera, Alex Morgan).
- Release notes describe the fix, not who it happened to ("never another company's name").
- Real-looking numbers in comments and test data become 555-01xx numbers with the same area code and formatting, so every test still checks what it checked.
- `src/lib/demo-details.test.ts` fails if any of those details come back, if a merge-field example stops being made up, or if a release note names a subscriber or a person.

**Consequence:** nothing a company stored changes; only the shared text around it.

## 117 — The deposit is each company's own rule; the completion certificate names no state

**Date:** 2026-10-05

**Context:** Every estimate asked for California's limit -- 10% of the total or $1,000, whichever is less -- for every company, wherever it worked: new estimates took the column defaults, and `company_profile.deposit_percent_bp` / `deposit_cap_cents` (0061) existed but nothing read them. The default completion certificate printed "CSLB Licence No." and "under California law" for everyone, and two hints said "CSLB".

**Decision:**
- **Settings → Contracts → Deposit at signing** sets the company's rule: a percent of the total and an optional dollar cap (blank = none), whichever is less. Admin only. `src/lib/deposit-rule.ts` (tested) parses and checks it.
- **Copied onto each new estimate** (`createEstimate`), like the contract body, so changing the rule never changes an estimate already made. Change orders, completion certificates and invoices still carry no deposit.
- **California keeps its limit.** A company whose licence state is California can't save more than 10% or a cap above $1,000, or no cap (B&P 7159.5).
- **Existing companies keep 10% / $1,000** -- their stored values -- until an admin changes them. Nothing to run.
- **The default completion certificate names no state:** "Licence No." and "under the law". A company that saved its own certificate keeps it.

**Consequence:** a company outside California can ask for the deposit its own state and terms allow.

## 118 — A new company starts with its own state, time zone and zero commission rates

**Date:** 2026-10-05

**Context:** Every new company started as a copy of La Home Contractor's settings: Pacific time (the column default), La Home's commission plan as column defaults (50% rep share of profit, 15% lead cost, 5% closer, 1% dispatcher), and a Team Map that opened on Los Angeles. The setup form never asked where the company was.

**Decision:**
- **The account setup form asks for the company's state and time zone.** Choosing a state fills in its usual zone (`src/lib/data/us-states.ts`, tested); either can be changed. `completeSignup` refuses a missing or unknown value before the setup link is spent, and the company is made with them (`timezone`, `license_state`).
- **Commission rates start at zero.** `createCompanyWithDefaults` writes 0 for all four rates, so a company sets its own plan instead of inheriting another's. The column defaults stay as they are (no database step); existing companies keep their rates.
- **Team Map** opens on the company's own address when nobody on the clock is located yet, falling back to the whole US.

**Consequence:** a company's reminders, "today" and report days run on its own clock from the first day. A company's commission statements read $0 until an admin sets its rates in Settings → Sales Commission.

## 119 — "New company" is a platform admin's tool, and a new company starts clean

**Date:** 2026-10-05

**Context:** The company switcher's "+ New company" was open to any Office or Admin user. They could make as many companies as they liked, none of them billed, and each was seeded with a copy of the current company's stages, calendars, call outcomes, project types, lead sources and time zone -- so a company made for someone else started as its creator's copy.

**Decision:**
- `createCompany` and the switcher's button require a platform admin (`isPlatformAdmin`), like the rest of Platform Admin.
- A company made there starts from the standard starter lists (`createCompanyWithDefaults` without `sourceCompanyId`), the same as a paid sign-up.

**Consequence:** Office and Admin users no longer see "+ New company". Customers get their company through sign-up or a setup link from Platform Admin. Billing for companies a platform admin makes by hand comes with Phase 4's trials and Subscribe button.

## 120 — Stages are known by a fixed tag, so any stage can be renamed

**Date:** 2026-10-05

**Context:** Each company names its own pipeline stages, but the app moved and counted leads by name: "Unsorted" for a new lead, "Appointment Scheduled" when a visit is booked, "Proposal Sent" and "Won" from estimates, "Appointment Follow Up" after a no-show, "Won"/"Lost"/"DNC" in every report. So four stages couldn't be renamed at all, renaming any other quietly switched its automation off, and a roofer couldn't call its stages what roofers call them. "Closed" also had a dozen definitions: most reports counted Not Interested (and some DNC) leads as open pipeline.

**Decision:**
- **Every standard stage has a fixed tag**, `pipeline_stages.key` (`unsorted`, `new_lead`, … `won`, `lost`, `not_interested`, `dnc`; 0195 tags existing companies' stages by name, a new company's come tagged). A company's own stages have none. The list and rules live in `src/lib/pipeline/stage-keys.ts`, tested against the migration.
- **Every lead carries its stage's tag**, `leads.stage_key`, kept by the database (`resolve_lead_stage` trigger): set from the name on every write. An automation writes only the tag (`update({ stage_key: "won" })`) and lands in that company's stage under its current name; with no such stage the lead stays put. A new lead whose stage isn't on the board goes to the intake stage, so `stage: "Unsorted"` on new leads keeps working after a rename.
- **Renaming a stage takes its leads and the dialer outcomes pointing at it along**, in the database (`follow_stage_rename`), and the won date stays (`set_won_at` goes by the tag).
- **Any stage can be renamed.** The four the app always needs (Unsorted, Appointment Scheduled, Won, Lost) still can't be deleted. Settings shows "works as …" next to a renamed standard stage.
- **One meaning of closed:** won, lost, not interested, do-not-contact (`CLOSED_STAGE_KEYS`, `is_closed_stage()`). Open-lead counts, pipeline value, follow-ups due, stale tags, the Dashboard, Salespeople, Contacts, Daily Brief and the assistant all use it. The board's and dialer's Open/Won/Lost views still show every column but Won and Lost.
- **Waiting for a first appointment** (booking advances, dialer outcomes move, the dispatch waiting list) is the intake tags plus a company's own stages placed before its Appointment Scheduled stage. That replaces a list that named La Home's "Meta" column.
- The portal's progress steps read the tag instead of guessing from words in the stage name. `marketing_funnel_rollup` (unused since 0164) is dropped.

**Consequence:** run 0195 before this deploys: the app reads `stage_key`. Report numbers drop where Not Interested and DNC leads used to count as open. A browser's hidden board columns are remembered by name, so a renamed column shows again until hidden again. Trade starter pipelines (Phase 3e) build on the tags.

## 121 — Each company chooses the words its customers read

**Date:** 2026-10-05

**Context:** Every customer got a remodeler's words: an "Estimate" for a "Project". A plumber sends a Quote for a Job, a solar company a Proposal. Worse, one send used two words: the text said "your estimate", the email "your proposal". And change orders, completion certificates and invoices went out through the same path, so a change order arrived as "your estimate EST-1012-CO1" and a certificate as "the grand total of the proposal is $0.00".

**Decision:**
- **Eight words a company can choose** (`src/lib/company-words.ts`, tested): estimate, project, appointment, contract, rep, customer, change order, deposit. Each has a short list of usual choices (Estimate / Proposal / Quote / Bid …), or the company types its own. Typed words are limited to letters, numbers, spaces, hyphens, apostrophes and & — they go into text messages, where one dash or emoji re-encodes the whole message, and into emails.
- **Stored as only what changed** (`company_profile.wording`, migration 0196), so a standard word the app later improves reaches every company that kept it. A missing or broken value reads as the standard word; a customer never sees a blank. The loader (`load-company-words.ts`) falls back to the standard words on any read error, so a send never fails over them, including before 0196 runs.
- **A document is called what it is** (`estimate-email-copy.ts`): the company's estimate word for an estimate, its change order word for a change order, "completion certificate" and "invoice" for those. Text, subject, body, button ("Review & Sign" / "View Invoice") and the closing line all use the same word; a certificate names no price, an invoice gives the amount due and asks for no signature.
- **Shown only where it is live.** Settings › Company Words lists the words customers already see (estimate, project, change order — `LIVE_WORD_KEYS`), with where each appears and an example text. The other five join as the portal and documents learn them, so no setting does nothing.
- The portal sign-in text and email say "your portal" (no longer "project portal"), and the text lost its em dash.

**Consequence:** with the standard words, a sent estimate's email now says "estimate" where it said "proposal" — the text already did. A company that prefers "Proposal" picks it in Settings › Company Words. Run 0196 to save words; until then everyone has the standard words.

## 122 — Documents and the customer portal speak the company's words, and its name

**Date:** 2026-10-05

**Context:** #121 put a company's words into what customers are sent. The document itself (web copy and PDF) and the customer portal still printed a remodeler's words — "Project", "Job location", "Original contract", "Due upon contract signing", "Customer", "Your estimates", "Proposal sent" — and called the company "your contractor" about a dozen times while its name was on the page. The PDF also had no INVOICE banner and printed "PREPARED FOR" on invoices.

**Decision:**
- **One set of document labels** (`src/lib/document-words.ts`, tested): banner, untitled title, prepared-for / bill-to, the project and location labels, "To/For contract", original and revised totals, the bottom line, deposit and its due line, and who signs — from the document's kind and the company's words. `components/estimate-document.tsx` and `lib/pdf/document-pdf.ts` both read it; a test stops either printing a label of its own. The PDF now says INVOICE and CERTIFICATE OF COMPLETION and leaves the schedule off an invoice, as the web copy does.
- **The portal in the company's words:** progress steps ("Quote in progress", "Quote sent", "Job confirmed" — it said "Estimate in progress" then "Proposal sent" for the same document), the documents list, the status card, notes, the deposit card and chip, the sign / decline buttons and messages ("Sign quote", "Decline this amendment"), and the card payment page's description and deposit name.
- **The company by name, not "your contractor"**, wherever the portal knows it. Before sign-in the portal serves every company, so it stays neutral: "Your Customer Portal", "matches our records".
- Settings › Company Words now offers contract, customer and deposit too (six of eight), each saying where customers see it, with an example of the document line. Appointment and rep follow with the quick texts and the AI receptionist.
- The completion certificate's legal text (Settings › Certificates, "the Owner", "Contractor") is the company's own template and is not reworded.

**Consequence:** with the standard words the portal's step three reads "Estimate sent" (was "Proposal sent"), a document's work address reads "Project location" (was "Job location"), and the portal is titled "Your portal" / "Customer Portal". No database step.

## 123 — Appointment and rep in the company's words: quick texts, AI receptionist, portal

**Date:** 2026-10-05

**Context:** After #121 and #122, two of the eight words were still fixed: a roofer's customers were told about their "appointment" (an inspection, to them) by the quick texts, the portal and the AI receptionist — which said "visit" — and a text sent before anyone was assigned read "this is your rep".

**Decision:**
- **Quick texts** gain an `{appointment}` placeholder, filled with the company's word; the three defaults that said "appointment" use it, so a company that never edited them gets its own word. `{rep_name}` with nobody assigned reads "your" + the company's rep word. A company's own edited texts are left as written (they can use `{appointment}` too — Settings › Appointment Notifications lists it).
- **AI receptionist:** offers to pencil in the company's kind of appointment ("an inspection"), asks what the job or problem is in its project word, and its confirmation text names it ("We've penciled in your inspection for …").
- **Portal:** the appointment cards, the progress step and the sign-in text use the company's word.
- Settings › Company Words now offers all eight words, with a quick-text example.

**Consequence:** with the standard words the receptionist now says "appointment" where it said "visit", and its confirmation reads "We've penciled in your appointment for …". No database step.

## 124 — A new company picks its trade and starts in its own words

**Date:** 2026-10-05

**Context:** Every new company started as a remodeler: an "Estimate" for a "Project", "Appointment Scheduled" on the board, and Kitchen Remodel / Bathroom Remodel as its project types. With the words (#121–#123) and stage tags (#120) in place, a plumber or a solar company can change all of that, but each would have to find out how and do it by hand.

**Decision:**
- **The account setup form asks for the trade:** Remodeling, HVAC, Plumbing, Roofing, Solar or Other (`src/lib/trade-starters.ts`, tested). `completeSignup` refuses a missing or unknown one before the setup link is spent.
- **The trade sets the starting words**, as approved by the owner on 2026-10-05: HVAC — Job, Service Call, Technician; Plumbing — the same plus Work Authorization; Roofing — Inspection; Solar — Proposal, Consultation, Energy Consultant, Agreement; Remodeling and Other — the standard words. Written to `company_profile.wording` on its own, so a database without 0196 leaves the company on the standard words rather than failing its profile.
- **The stages follow the words:** an HVAC company starts with "Service Call Scheduled", "Service Call Follow Up", "2nd Service Call"; a solar company with "Proposal Prepared". Tags are unchanged (#120), so every automation works. A stage whose word is standard keeps its usual name — a remodeler's board is exactly what every company had before. The dialer outcomes point at the renamed stages, and "Appointment Set" becomes "Inspection Set" and the like.
- **A few project types per trade**, only so the dropdown is never empty (AC Repair, Leak Repair, Roof Repair, Solar Panels…; Remodeling keeps the old four).
- Calendars, lead sources and everything else are the same for every trade. A company made by a platform admin, or copied from another, is unchanged.

**Consequence:** a new HVAC company's customers get "Service Call" texts and its board reads in its words from the first day. Everything stays editable in Settings › Company Words, Pipeline Stages and Project Types. No database step.

## 125 — The staff screens speak the company's words too

**Date:** 2026-10-05

**Context:** #121–#124 put a company's words in front of its customers and gave new companies their trade's words. The team's own screens still said "Estimates & Contracts", "Estimate Status", "Projects", "Appointment Reports", "Salespeople", "New Estimate", "New Appointment" — so an HVAC company's customers read "Quote" and "Service Call" while its staff worked under a remodeler's menu.

**Decision:**
- **One place for staff labels** (`src/lib/staff-words.ts`, tested): the sidebar links, the page headings of Estimates & Contracts, Estimate Status, Projects, Contracts, Appointment Reports and Salespeople, the estimate list's count cards, and Quick Create.
- **A label changes only when a word in it was changed.** A company on the standard words sees exactly what it always has — "Salespeople" does not become "Reps". An HVAC company sees "Quotes & Work Authorizations", "Jobs", "Service Call Reports", "Technicians", "New Service Call".
- **Sidebar group names stay** (Dispatch, Production…): they are departments, not company words, and saved menu orders are keyed on them.
- The words reach every page through the cached company chrome (`getCompanyWordsCached`), invalidated when Company Words is saved — no extra query per page load.

**Consequence:** a company that changed a word sees its menus change with it, on the next page load after saving. Team role names (Sales, Dispatch…) are not words and are untouched here.

## 126 — Scheduled jobs run each company in its own safety net

**Date:** 2026-10-05

**Context:** Eight of the ten scheduled jobs (appointment and task reminders, no-show follow-ups, rain alerts, CallRail and PrimeCall syncs, the time clock, Google Calendar) looped over every company in one pass, with no safety net around each company. One company's failure — a Twilio account that answers with an error, a calendar token that throws — ended the run for every company after it, and a slow outside service could hold the whole run until the function was cut off. With a handful of companies that was rare; with hundreds it would be a daily event that silently skips reminders.

**Decision:**
- **One company at a time, each in its own try/catch** (`src/lib/cron/each-company.ts`, pure and tested; `runForEachCompany` in `src/lib/cron/run-companies.ts`). A company that fails is logged and sent to Sentry tagged with its company id and `service: "cron"`, and the next company runs.
- **The order turns every minute**, so the same company is never always last.
- **A time budget:** a run stops starting new companies after four minutes (`CRON_BUDGET_MS`); the ones it didn't reach are counted as "deferred" and simply go first on a later run. Every one of these jobs gets `maxDuration = 300` so the budget, not the platform, decides where a run stops.
- **Calls to outside services have a time limit and never throw:** sending a text (15 s), the weather service (10 s), CallRail (20 s), Google sign-in and calendar requests (15 s / 20 s). A timeout reads as an ordinary failure for that one company.
- The job still answers 200 and adds `failures` (company id + message) and `deferred` (count) to its JSON, so the scheduler doesn't retry everyone because one company failed. (First shipped as `failed`, which overwrote Google Calendar sync's own `failed` count; renamed the same day.)
- Unchanged: the nightly backup exports whole tables at once (and reports a partial export as a failure), and the AI receptionist finalizer already works call by call, each in its own try/catch.

**Consequence:** one company's broken setting or a slow outside service can no longer stop everyone else's reminders and syncs, and the failure shows up in Sentry with the company it belongs to. No database step.

## 127 — A Companies page for whoever runs the platform

**Date:** 2026-10-05

**Context:** A platform admin could see companies only piecemeal: the invite history (companies that came from a setup link), the Twilio card, and the company switcher. Nothing answered "how many companies are there, who owns each one, and which are paying" — the first thing to know when running hundreds of them.

**Decision:**
- **Platform Admin › Companies** (`/platform-admin/companies`, behind `PlatformAdminGate`, also in the Admin Tools menu) lists every company: name, owner, team size, start date, billing, and Open (the same switch the other Open buttons use).
- **Owner** is the company's earliest active Office or Admin of its own. Platform admins hold a seat in every company (0132, `granted_via_platform_admin`); those seats never count as the owner or in the team size.
- **Billing** reads `company_billing`: Paying (active), Free trial (trialing), Payment failed (past due or incomplete, still has access), Locked (the statuses that lock, `isBillingLocked`), Waiting on Stripe (a customer whose status hasn't come in, or a status we don't know — never shown as paying), Not billed (no subscription: made by a platform admin or before self-serve signup, never locked).
- **Built for hundreds:** three reads (companies, members with their names, billing), each paged past the 1,000-row cap, joined in a pure tested function (`src/lib/company-directory.ts`) — not one query per company.
- A setup-progress column waits for the setup checklist, so the two read the same rules.

**Consequence:** one page shows every company and where its billing stands. No database step.

## 128 — A record whenever a platform admin opens a company

**Date:** 2026-10-05

**Context:** Platform admins hold a seat in every company so they can open it and help (0132). Nothing recorded when they did. With hundreds of companies trusting the platform with their customers, "who from AI Build Pros looked at our account, and when" needs an answer.

**Decision:**
- **New table `platform_access_log`** (migration 0197): company, person (name and email copied in, so a line still reads after the account is gone), time. Row-level security on with no policies: only the server writes and reads it.
- **Append-only in the database itself:** a trigger refuses any edit, delete or truncation. A line goes only when its company is deleted (the cascade is let through).
- **Written in `switchCompany`**, which every Open button and the company switcher use, only when the seat used is a look-in seat (`granted_via_platform_admin`). Opening a company the admin genuinely belongs to isn't recorded.
- **No record, no entry:** if the line can't be written the company stays closed ("Couldn't record this visit…"). The one exception is the table not existing yet: until 0197 is run, opening works as before, with a warning in the logs. The schema check in Settings names 0197 until it has run.
- **No backdoor through the default company:** with no company chosen yet (a new device, cleared cookies) a person lands in a company of their own before any look-in seat (`defaultCompanyId`), so a platform admin can't end up inside a customer's company without opening it. Someone with only look-in seats still lands in one, as before.
- **Shown on Platform Admin** ("Company access record"): the newest 300 lines, searchable by company or person, times in the current company's zone.
- Customers don't see it yet; a company's own Admin view can be added on top of the same table.

**Consequence:** every look into a customer's company leaves a line that can't be changed. **Database step: run `supabase/migrations/0197_platform_access_log.sql`.**

## 129 — Self-serve signup starts with 30 days free and no card

**Date:** 2026-10-05

**Context:** The marketing site promises "First 30 days free" and "no card up front" (the owner kept that offer on 2026-09-24), but `/get-started` sent people straight to a paid Stripe Checkout. There was no trial, no countdown, and no way to tell an ended trial from a cancelled plan.

**Decision:**
- **Stripe runs the trial.** A monthly plan is sold through Checkout with `trial_period_days: 30`, `payment_method_collection: "if_required"` (no card asked for) and `trial_settings.end_behavior.missing_payment_method: "cancel"`. A trial that ends with no card becomes a cancelled subscription, which locks the company exactly as before (0175). The CRM keeps no trial clock of its own. A one-off price is still paid up front; the Get Started page promises a trial only when the plan is monthly.
- **Two columns on `company_billing` (0198):** `trial_ends_at` and `card_on_file`, filled by the billing sync from Stripe. They are written separately from the status, so a database without 0198 still syncs the status (and the lock); it just can't count the days.
- **A card added in Stripe's Customer Portal** lands on the customer, not the subscription. The sync copies it onto the subscription, so the "no card: cancel" rule can't miss a card that was added. Returning from the portal re-checks Stripe, so the prompt goes away at once.
- **Countdown:** a banner on every page while the trial has no card ("Your free trial ends in 12 days. Add a card…"), linking Office/Admin to Settings › Subscription, which shows the end date and an **Add a card** button. With a card on file, the banner says nothing.
- **Trial ended:** the lock screen says the free trial has ended and offers **Subscribe**, a plain paid checkout. Coming back never starts a second trial.
- **Not touched:** companies without a subscription (made by a platform admin, or before self-serve signup) are never billed or locked. Giving a company more trial time from Platform Admin is the next step.

**Consequence:** a new company signs up with an email address alone and has 30 days to add a card. **Database step: run `supabase/migrations/0198_billing_trial.sql`.**

## 130 — A platform admin can give a company more trial time

**Date:** 2026-10-05

**Context:** With the free trial (#129), a company that needed a few more days to decide had no way to get them short of someone editing the subscription in Stripe's dashboard.

**Decision:**
- **Platform Admin › Companies** shows a trialing company's end date and an **Extend trial** control: +7, +14 or +30 days (`src/lib/actions/trial-admin.ts`, `extendTrial`).
- **Stripe holds the trial, so Stripe changes:** the subscription's `trial_end` moves (no proration), counted from the trial's current end — or from now, if that has passed — so an extension always adds the full time (`extendedTrialEnd`, tested). The billing sync then brings the new date back to the banner and the list.
- **Platform admins only**, checked inside the action, not just on the page. Only a subscription still trialing can be extended; a trial that has already ended is a Subscribe, not an extension. Each extension is logged (`billing.trial_extended`, with who and how many days).

**Consequence:** giving a company more time is one click on the Companies page. No database step.

## 131 — A locked company is paused: no texts, no calls, no AI

**Date:** 2026-10-05

**Context:** A lapsed subscription locked a company's screens (the app shell redirects) and hid its data from its own people (row-level security, 0175). But texts, calls, the AI and every scheduled job run on the service-role client, which row-level security doesn't touch, and a server action or API route is reachable without the shell. A locked company's reminders kept going out, its new-lead alerts kept texting, its AI receptionist kept answering — on the platform's AI bill — and a stale tab could still send a text or ask the assistant.

**Decision:**
- **One check** (`isCompanyLocked`, `src/lib/billing/company-lock.ts`), on the same cached billing read as the app shell, dropped by the Stripe webhook the moment a subscription changes — so a renewal turns everything back on at once.
- **Texts:** every send gets its account from `getTwilioForSending`, which gives a locked company none. The screens' actions (send a text, send an estimate, send a portal link, request a progress payment) say why. The inbound-text webhook still saves a locked company's incoming texts but sends no automatic reply. `getTwilioForCompany` stays for checking Twilio's signatures and playing recordings.
- **Calls:** no dialer token for a locked company, and the outbound call route refuses too (a token lasts an hour). Inbound calls still ring through to the company's own phone — that costs the platform nothing, and its customers can still reach it.
- **AI:** one door, `aiForCompany` (`src/lib/ai/company-ai.ts`); it is now the only place the AI client is created. A locked company gets no assistant, lead analysis, scope writer, estimator lines or call notes, and the AI receptionist doesn't pick up. A receptionist call already under way when the lock lands ends the way a model failure does, and its caller still becomes a lead. The usage tracking to come counts at the same door.
- **Scheduled jobs:** `runForEachCompany` reads the locked companies once per run and pauses them; the job's report says how many (`paused`).
- **Guard tests** (`company-lock.test.ts`) read the code: only the AI door creates an AI client, every text sender uses `getTwilioForSending`, and the screens' actions, the call route, the auto-reply and the receptionist's pickup all check.

**Consequence:** a locked company costs the platform nothing and sends nothing until it renews; nothing is deleted, and incoming texts and leads are still captured. Platform admins looking in are paused there too. No database step.

## 132 — What each company uses, counted per month

**Date:** 2026-10-05

**Context:** The platform pays for every company's AI, and every company's texts and emails carry the platform's name. With hundreds of companies there was no way to see who uses how much — no basis for a fair limit, and no early sign of a trial account sending a thousand texts.

**Decision:**
- **One row per company per calendar month** (`company_usage`, 0199; months in UTC): AI uses, the words the AI read and wrote (tokens), texts sent and emails sent. Added only through `record_company_usage`, which only the server may call; the company's own people can read their rows, nobody signed in can write them.
- **Counted where each thing actually happens**, so nothing goes around it:
  - **AI:** the one AI door (`aiForCompany`, #131) hands out a client that counts every complete answer, whole or streamed. A failed request isn't counted.
  - **Texts:** `sendTwilioSms` counts after Twilio accepts the text; its account comes from `getTwilioForSending`, now tagged with the company. `sendSms` (its own send) counts the same way. The YES/NO auto-reply is Twilio's own reply and isn't counted.
  - **Emails:** `sendEmail` counts mail sent with a company's email details (`getEmailForCompany`, now tagged with the company). Setup links and password resets are the platform's own mail and aren't counted.
- **Counting never fails the thing counted:** a text that went out never reports an error because its tally didn't; until 0199 has run, nothing is counted, quietly.
- **Shown** on Platform Admin › Companies ("This month") and in each company's Settings › Subscription ("This month so far").
- **Limits come next**, on top of these counts. Guard tests hold the three senders and the AI door to counting.

**Consequence:** the platform can see what each company uses this month. **Database step: run `supabase/migrations/0199_company_usage.sql`.**

## 133 — Monthly limits per company, set by a platform admin

**Date:** 2026-10-05

**Context:** With usage counted (#132), the platform could see a company using far more AI, texts or email than its plan was meant for, but couldn't do anything about it short of locking the whole company.

**Decision:**
- **Three limits per company, per month:** AI answers, texts, emails (`company_limits`, 0200). Blank means no limit, and every company starts with none — the owner's choice when the plan was approved.
- **Set on Platform Admin › Companies** (**Set limits**), by platform admins only, checked inside the action (`setCompanyLimits`). Who set them last is kept.
- **Checked before each one goes out, in the same places it is counted**, so nothing goes around it: the AI door (`aiForCompany` refuses with reason `limit`), `sendTwilioSms` and `sendSms`, and `sendEmail` for company mail. Platform mail is never limited.
- **The refusal explains itself:** what ran out, how much, and that it starts again on the 1st ("ask AI Build Pros if you need more"). Background senders (reminders, alerts) skip, as they do for any send error.
- **Cheap when unused:** a company's limits are read through a cache, dropped the moment they are set; a company with no limit for something never reads its counts for it.
- Shown against usage on the Companies page ("214 of 500 AI uses") and in the company's Settings › Subscription. Guard tests hold each check before its send.

**Consequence:** the platform can cap a company that uses too much without locking it. **Database step: run `supabase/migrations/0200_company_limits.sql`.**

## 134 — Export any one company, with everything it holds

**Date:** 2026-10-05

**Context:** A company's own Admin could download its data from Settings › Backup, but a platform admin had no way to export a company they don't run — the first thing needed when a customer leaves, asks for its data, or is being closed. And the export's table list had fallen behind the product: 16 tables where a company's business lives (bills and bill payments, payment accounts, commission payouts, sales-team changes, marketing spend, shared notes, file deletions, contact views, AI receptionist calls, the whole time clock) were in no backup at all, the nightly one included.

**Decision:**
- **Export on Platform Admin › Companies** (`exportCompanyData`): any one company's file — the same as its own Admin's download, without saved keys or tokens. Platform admins only, checked inside the action before anything is read; each export is logged with who took it. "Every company at once" stays the nightly job's alone.
- **The 16 tables are in every backup now**, each after the tables it points at, so a restore can load in order.
- **No more silent gaps:** `backup-scope.test.ts` reads the database files for every table with a `company_id` and fails unless it is in `BACKUP_TABLES` or in `BACKUP_LEFT_OUT` with its reason (sign-in tokens and connections, page-view pings, which alerts were read, and the platform's own billing, usage, limits and access records).

**Consequence:** a company's full data is one click away for the platform, and the next table a feature adds can't be forgotten by the backup. No database step.

## 135 — A platform admin can close a company, and reopen it

**Date:** 2026-10-05

**Context:** There was no way to close a company — a customer who left, a test account, a sign-up that was never real — short of cancelling a subscription it might not have, or deleting it, which nothing supported and which would destroy its records. Separately, the database allowed more than it should around removing a company row; no screen ever did it, but the permission was there.

**Decision:**
- **Closed is a lock, not a delete.** `company_closures` (0201) holds the closed companies, with who closed it and why; only the server reads or writes it.
- **Locked exactly like a lapsed subscription, through the same checks:** the database lock (`billing_locked_company_ids()` now returns closed companies too, still empty for platform admins so they can look in), the app shell's redirect, `isCompanyLocked` (texts, calls, AI — #131), the scheduled jobs' pause, and the lock screen's re-check. The lock screen says the company is closed and offers nothing to buy, since paying doesn't reopen it.
- **Close and Reopen on Platform Admin › Companies** (`closeCompany`, `reopenCompany`): platform admins only, checked inside the actions; closing asks for an optional reason; both are logged. A Closed chip marks closed companies.
- **Stripe is left alone:** closing doesn't cancel a subscription. A paying company being closed should have its subscription cancelled in Stripe as a separate, deliberate step.
- **Only the server can remove a company row now** (the companies table's delete permission is gone). No screen used it.

**Consequence:** a company can be closed and reopened in one click without losing anything. **Database step: run `supabase/migrations/0201_company_closures.sql`.**

## 136 — A setup checklist for new companies

**Date:** 2026-10-05

**Context:** A new company starts with its lists filled in, but nothing that is its own: no business phone, email or address on its documents, no logo, no texting number (it can't text or call until it connects its own Twilio — #104), no way to take payments online, no contract on its estimates, and nobody else on the team. Nothing told a new Admin any of that, and the platform couldn't see which companies were stuck.

**Decision:**
- **Six steps, each with a done signal the CRM already has:** business phone + email + address (`company_profile`), logo (`logo_url`), its own Twilio account, token and number (`twilioSource`'s "own" test), its own Stripe key, a default contract template, and at least one more active person besides the owner (platform admins looking in aren't counted). Pure rules in `src/lib/setup-checklist.ts`.
- **Time zone isn't a step:** a company that never chose one can't be told apart from one that chose the default (Pacific). The details step names the current zone so it gets checked while the profile is open.
- **On the Dashboard for Office and Admin people only** — the ones who can open those settings pages. Each step links to its page (`/settings?card=logo` now opens the Logo card). It goes away by itself once every step is done; **Hide** puts it away on that browser (a cookie per company), with nothing stored in the database.
- **Read on the server only:** the encrypted Twilio and Stripe values are read through the service-role client for the signed-in company and reduced to "saved / not saved"; they never reach the page.
- **On Platform Admin › Companies**, under each company's name: "Setup 4 of 6", with what's missing on hover (written out on a phone), or "Setup done". Two paged reads for every company, not a query each.
- The Logo card in Settings no longer carries a SOON tag: it opens a working panel, unlike the cards that have no page yet.

**Consequence:** a new company sees what's left to set up and where; the platform sees which companies haven't. No database step.

## 137 — A change order shows the customer its own payment schedule

**Date:** 2026-10-05

**Context:** The customer's copy of a change order (portal page and PDF) never printed a payment schedule. The rule dated from when a change order was billed as one lump on its contract, and a second schedule would have been terms that governed nothing. That stopped being true: its money is collected stage by stage on its own schedule (#015), so a customer signed an $8,500 change order with no idea when any of it was due. Separately, the portal looked up the parent contract with the staff client; a customer has no CRM login, so row-level security returned nothing and the change order lost "To contract EST-1112", the original total and the revised total.

**Decision:**
- **The change order's own schedule prints, headed as its own** ("Payment schedule for this change order"), its deposit "Due when you sign this change order", and under it: these payments don't change the ones already scheduled on the contract. Percentages are of the change order's total.
- **No stages of its own → one line**, billed as one payment added to the contract's schedule (a credit: taken off it). Nothing when there is no contract to name or nothing owed.
- **Web and PDF pick the section through one pure, tested helper** (`documentPaymentSection`, `src/lib/document-words.ts`), with the wording beside the other document labels in the company's words. A source test fails if either renderer stops using it.
- **Each stage's share prints as a percent on both copies** (`paymentPercentLabel`). The PDF printed the raw number — "(33.333333333333336)" — on every contract.
- **The portal reads the parent with the service role, scoped to the viewer's lead** (`portalParentContract`) — the same boundary the page already applies to the document itself. The staff preview keeps `getParentContract`.

**Consequence:** the customer sees what they're agreeing to pay and when, and what the change order adds up to. Pay buttons are unchanged: they still appear only once a stage is billed, and not at all for a customer invoiced separately. No database step.

## 138 — Each company can rename its team roles (display only)

**Date:** 2026-10-05

**Context:** Phase 3 let each company choose its own words (#121, #125), but the team roles stayed fixed: an HVAC company's technicians still showed as "Sales", a front desk as "Call Center". Role names were left out then because they need their own column (saving company words replaces the whole `wording` object).

**Decision:**
- **Display only.** `company_profile.role_names` (0202) maps a role to the company's name for it, e.g. `{"Sales": "Technicians"}`; only renamed roles are stored. Every permission, page rule, RLS policy and saved assignment still uses the role itself, so a rename can't change anyone's access. Pure rules in `src/lib/role-names.ts`.
- **Admin and Office keep their names.** The app's messages name them everywhere ("ask an Office or Admin user", "Office or Admin only"); renamed, those would disagree with the screen. The other six (Field, Sales, Call Center, Dispatch, Bookkeeping, Production) can be renamed.
- **Plain, short and distinct:** the same character rules as company words, 30 characters, and no two roles may read the same (case-blind), so people can always tell them apart. Blank goes back to the standard name; a broken or clashing stored value reads as the standard names.
- **Settings › Role Names** (also linked from Users & Roles as "Rename roles"), Office or Admin, checked inside `saveRoleNames`.
- **Where the names show:** Users & Roles (chips, add/remove tooltips, the role pickers when creating or adding a user), Role Visibility's column headers, Time Clock settings' role checkboxes, Salespeople (chips, "with the … role"), the rep report's notes, and the no-access notes on Bills, Collect and Payments. Read through the cached chrome (`getRoleNamesCached`), dropped on save.
- **Left as they are:** access-rule error messages from the server (they name Office/Admin almost everywhere), the tutorials, the release notes, platform-admin screens (which span companies), and page or menu names that contain a role word ("Dispatch Dashboard", the "Call Center" menu group — menu orders are saved by group name).

**Consequence:** a company sees its own role names on the screens that list roles, with no change to who can do what. **Database step: run `supabase/migrations/0202_company_role_names.sql`.**

## 139 — The free trial is 60 days

**Date:** 2026-10-05

**Context:** Self-serve signup started with 30 days free (#129), matching the marketing site's "First 30 days free". The owner chose a bigger offer for the site: "First 2 months free", with every button going straight to sign-up instead of booking a demo (aibuildpros-site PR #8). The CRM has to give that before the site can say it.

**Decision:**
- **`TRIAL_DAYS` is 60.** Checkout sells a monthly plan with `trial_period_days: 60`; everything else in #129 stands — no card asked for, no card at the end means Stripe cancels and the company locks, and coming back never starts a second trial. The Get Started page reads the number, so it says "Start your 60-day free trial".
- **Trials already running keep their end date:** Stripe fixed it at checkout. A platform admin can add time from Platform Admin › Companies (**Extend trial**, #130) if a company should get the longer offer.

**Consequence:** a company that signs up from now on has 60 days to add a card. No database step.

## 140 — Scheduled jobs run from the database, not GitHub

**Date:** 2026-10-05

**Context:** GitHub Actions timers started every scheduled job: appointment and task reminders and no-show follow-ups every 15 minutes, the phone and calendar syncs, the time clock, rain alerts. GitHub's timers are best-effort. On 2026-10-05 it cancelled runs for over an hour without starting them, so every company's reminders would have been late at once. The jobs also send a text before marking it sent, so two runs of the same job at the same moment can text twice: whatever starts them should start each one once, on time.

**Decision:**
- **Supabase Cron starts them** (`pg_cron` + `pg_net`, migration 0203), on the minute, at the same UTC times GitHub used. The routes and what they do are unchanged; the database calls them the way GitHub did. `crm_jobs.run(path)` only calls `/api/cron/…` on `crm.aibuildpros.com`, and lives in a schema the app's API doesn't expose.
- **No secret to copy.** The migration makes a random token and keeps it in Supabase Vault; it's sent with each call, and the routes ask the database whether a token is that one (`crm_job_token_ok`, service role only). `CRON_SECRET` still works for the "Run workflow" buttons. One check for all nine routes: `refuseCronCaller` (`src/lib/cron-auth.ts`).
- **The GitHub timers are removed** from those nine workflows, so a job is never started by both. Their "Run workflow" buttons stay.
- **The nightly backup stays on GitHub**, on `CRON_SECRET` only: its encrypted file is kept there, and the export of every company shouldn't be something the database can ask for.
- `cron-token.test.ts` holds every job route to exactly one scheduler and the times above.

**Consequence:** reminders and syncs run on time whatever GitHub is doing. **Database step: run `supabase/migrations/0203_scheduled_jobs.sql` right after merging** — until then nothing starts the nine jobs on a timer.

## 141 — The Reply Inbox reads only what is on screen

**Date:** 2026-10-06

**Context:** The Reply Inbox read every text the company had ever sent or received (`selectAll` over `sms_messages`), grouped them into conversations in the browser, and did it all again on every new inbound text (the `TEXTS_FRESH_EVENT` refresh). To name the texts never linked to a contact, `leadsLiteForMessages` also walked the company's whole contact book, 1000 rows at a time, because a contact's number is stored however it was typed and could only be matched in code. Fine for a new company; at La Home's 79k contacts and years of texts, every visit and every new text paid for all of it.

**Decision:**
- **The list is the newest conversations.** The server reads texts newest first, 500 at a time, until it has 50 conversations (at most four reads a page), keeps each conversation's newest text, and sends the browser one summary row per conversation (name, number, snippet) instead of the texts. Everything listed is complete and in order: its newest text was read, and anything unread is older. **Show older conversations** reads the list again from the top, one page longer (`getReplyInboxConversations`), so a refresh of the first page can't open a gap between pages (`mergeConversationLists`).
- **A conversation's messages are read when it is opened** (`getReplyInboxThread`): its newest 100, then 100 more per **Show earlier messages**, up to 500 (one more than asked is read to know older ones exist, which must stay under PostgREST's 1000-row ceiling). The page brings the conversation it opens on, so it doesn't open empty. A new text, or one sent from here, re-reads the list and the open conversation.
- **Lookups by number happen in the database** (migration 0204), on the app's own key (digits, the last ten: `normalizePhone`, the same expression 0168 uses), each held by an index: `leads_by_phone_keys` for whose number it is (Text Reports benefits too) and `reply_inbox_unlinked_thread` for a conversation never linked to a contact. Both are `security invoker`, so RLS and #113's who-sees-which-texts apply as on any read; anon can't call them. Until 0204 runs, both fall back to the old reads.
- The browser sends only a conversation key and a count; the key is checked (`parseConversationKey`: a contact id or `phone:` and digits) and the count clamped before any query, and the company always comes from the signed-in profile.
- The thread is loaded by a server action into state, not by putting the open conversation in the URL: the app's group-level `loading.tsx` would replace the inbox with a skeleton on each click, and a half-typed reply would go with it.

**Consequence:** a visit reads a few hundred texts and a handful of contacts, whatever the history. Finding an old conversation takes **Show older conversations**, or the contact's own Texts tab. Text Reports still reads every text (TECH_DEBT). **Database step: run `supabase/migrations/0204_reply_inbox_lookups.sql`** (indexes and two lookups; changes no data).

## 142 — The Calendar loads one month at a time

**Date:** 2026-10-06

**Context:** The Calendar read every appointment the company had ever booked, every contact that had ever had one (inner join on `events`), all of their tasks and notes, and the company's estimates (a bare select, so silently the newest 1000), on every visit and every refresh. The two service-role lookups behind it (`getAppointmentHolders`, `getLeadsBehindAppointments`) walked every appointment too, and checked visibility of every lead behind them. The board navigates in the browser, so all of it was loaded in case someone clicked back two years.

**Decision:**
- **The page loads one month, the one in the address** (`?month=YYYY-MM`, else this month), from a week before its first day to a week after its last (`monthRange`). The month grid draws at most six days of the months around it and a week can straddle two months, so the extra week each way covers everything any view shows for a day in that month (`calendar-range.test.ts` walks the grid and every week).
- **Only what stands behind those appointments comes with them:** their contacts, and those contacts' tasks, notes and estimates, by id in chunks of 150 (each chunk read in full). The service-role lookups take the same range; the Schedule calls them without one and is unchanged.
- **Moving into another month replaces the address in a transition** (`router.replace`, `useTransition`). Tested before relying on it: a search-param-only navigation keeps the page's client state and does not show the group's `loading.tsx` skeleton; the old screen stays, pending, until the new one arrives. The board fades the grid and says "Loading appointments…" meanwhile. `router.refresh()` after a save refreshes the month on screen.
- **A link to one appointment opens on its month:** the page looks up the appointment's date first, and the board moves to that day, so the appointment and its contact stay loaded while its window is open; the `?openEvent=` is dropped with the month kept.
- **The filters follow the people-dropdown rule per month:** the rep filter is Sales plus whoever is on this month's appointments plus whoever is ticked; the dispatcher filter keeps anyone ticked.
- The line under the title counts the appointments in view instead of "total": the page no longer knows the total.

**Consequence:** a visit reads one month of appointments and only the contacts, tasks, notes and estimates behind them, whatever the history. Moving a month costs one server render. Jobs are still read whole, and the Schedule page still reads everything (TECH_DEBT). No database step.

## 143 — The Schedule loads only the window it shows

**Date:** 2026-10-06

**Context:** The Schedule read every appointment the company had ever booked, every contact that had ever had one, and every task and every note in the company (`selectAll` over `lead_tasks` and `lead_notes` with no filter but the company), then filtered by date in the browser. Its range picker (Upcoming, Today, Tomorrow, Next 7 days, This month, Past, All, Custom) and rep picker only ever hid rows.

**Decision:**
- **The range and rep ride in the address** (`?range=…&from=…&to=…&rep=…&limit=…`, only what differs from the default; `parseScheduleQuery` keeps a value only when it is what it should be, and the rep only as an id, since it goes into a database filter). Changing either replaces the address in a transition, the same mechanism as the Calendar (#142): the list stays on screen, faded, until the new window arrives.
- **The server loads that window** (`serverWindow`). It knows only the UTC date, and a browser's own "today" can be a day either side, so every edge that depends on today is a day wider; the list still applies its own exact filter (`listWindow`, the logic it always had). `schedule-window.test.ts` checks the server's window holds the list's for any "today" a day either side, across month, year and leap-day ends.
- **A page at a time:** 200 appointments, one more read to know there are more, **Show more** in pages of 200 up to 800 (under PostgREST's 1000-row ceiling), then "pick a custom date range". **Past and All read newest first**, and so does a custom range with no start date yet (it is open at the old end too); All used to read oldest first, which opened it on the oldest appointment ever.
- **Only what stands behind the loaded appointments comes with them:** contacts, tasks, notes and estimates by lead id (`loadAppointmentContext`, now shared with the Calendar). The service-role lookups (#142's range) cover the loaded appointments' first to last date.

**Consequence:** a visit reads one window of appointments and what stands behind them, whatever the history; an old appointment is a range change and a "Show more" away. Jobs are still read whole (TECH_DEBT). No database step.

## 144 — The portal charges what's left on a part-paid stage

**Date:** 2026-10-06

**Context:** Once any money was filed to a billed stage — a cheque for part of it, say — the customer's portal showed "Partially paid — $X still due" with no Pay button (#033). Checkout only knew how to charge a stage's full amount, so a button there would have charged the face value on top of what was paid. The rest was chased and recorded by hand.

**Decision:**
- **The Pay button charges the rest:** the stage's amount less settled money *and* money already on its way — a completed ACH checkout or a cheque recorded as pending — so a transfer still clearing is never charged twice. A checkout the customer opened and left is not money and reduces nothing (`phaseCheckoutCents`, pure and tested).
- **One figure everywhere in a checkout:** the same amount goes to Stripe's session, to the pending row the webhook settles, and to the reuse check — so an open checkout left over from before a cheque landed is closed, not handed back at the old amount. The webhook needed no change: it settles the pending row's own amount. A source test fails if the checkout goes back to the face amount in any of the three.
- **The "already paid" check reads every payment on the stage,** not a single settled row (it used to refuse any stage with one settled payment, and silently skipped the check with two).
- **Below 50¢ left, no button:** Stripe refuses smaller charges, so the contractor settles the cents (`MIN_ONLINE_CHARGE_CENTS`, `portalPayCents`).
- Stripe's line item reads "… (remaining balance) — EST-…" on a part payment, so the customer's receipt says what it was for.

**Consequence:** a customer who part-paid can finish online. Invoices benefit too — their one stage goes through the same checkout. Deposits are unchanged. No database step. **Worth one real test payment after deploy** (a small amount on a test job), since this changes what Stripe is asked to charge.


## 145 — The Estimates list reads only the columns it draws

**Date:** 2026-10-06

**Context:** The Estimates list read every column of every document (`select("*")`) and of every signer. That is each contract's full terms, its notes, customer message and completion notes, and -- for every signed document -- each hand-drawn signature as a base64 PNG, plus the signer's IP and browser. The list shows none of it. Unlike the Calendar (#142) and Schedule (#143), the list can't simply load a page at a time: its funnel cards count and total every document (by card, rep, dates and search), and the search runs over all of them in the browser.

**Decision:**
- **Every document still comes, with only the columns the list draws**: `ESTIMATE_LIST_COLUMNS` and `ESTIMATE_LIST_SIGNER_COLUMNS` (`src/lib/data/estimate-list-rows.ts`). Each is built from one field list that also makes the row type, checked against `Estimate`/`EstimateSigner` with `satisfies`, so the select and the type can't drift apart.
- **The list is typed on those rows** (`EstimateListRow`, `EstimateListSigner`), and every helper it calls already takes a `Pick` of what it reads, so a field the list starts reading without being added to the list fails the build instead of reading as blank.

**Consequence:** a document costs the list a few hundred bytes instead of its terms and signature pictures; the cards, filters, search and rows are unchanged. The list still grows with the company's document history (TECH_DEBT): paging it would mean computing the cards in the database. No database step.

## 146 — Text Reports loads only the period it shows

**Date:** 2026-10-06

**Context:** Text Reports read every text the company had ever sent or received (`selectAll` over `sms_messages`, every column), then filtered by period, direction and search in the browser and drew every match as a table row. Its period picker (Last 7, 30 or 90 days, All time, a custom range) only ever hid rows, and it opened on the last 30 days, so the default visit downloaded the company's whole text history to show one month of it.

**Decision:**
- **The period rides in the address** (`?range=90`, or `?from=…&to=…` for a custom range, only what differs from the default "Last 30 days"; `parseTextReportQuery` keeps a date only when it is a real calendar day, since it goes into a database filter). Changing it replaces the address in a transition, the same mechanism as the Calendar (#142) and Schedule (#143): the report stays on screen, faded, until the new period arrives, and its numbers stay on the period that is loaded until then rather than counting part of the new one.
- **The server loads that period** (`textReportServerWindow`) on the existing `(company_id, created_at)` index. It knows only the UTC date and a browser's own "today" can be a day either side, so a "last N days" period starts a day earlier on the server; custom dates are absolute and loaded exactly. The report still applies its own exact filter. `text-reports-window.test.ts` runs the browser's own date logic in nine time zones, across date and year ends and the nights clocks change, and checks the server's period always holds it.
- **Every text in the period still comes**, so the cards (sent, received, reply rate, confirmed / declined) and the busiest day stay exact. Only the columns the report uses (`TEXT_REPORT_COLUMNS`, typed with `satisfies` like #145), newest first with the id as a tie-breaker so paging past 1,000 texts neither repeats nor skips one.
- **The table draws 200 rows at a time** with **Show more**; the numbers above it count them all. Changing a filter starts again from one page.

**Consequence:** a visit reads one month of texts by default instead of the company's whole history, and the browser draws a page of them. All time is still everything (an explicit choice; counting it in the database would be the cure, as for Marketing Analytics). No database step.

## 147 — The Calendar and Schedule read only the jobs their appointments link to

**Date:** 2026-10-06

**Context:** The Calendar and the Schedule each read every job the company had ever had, every column (notes included), on every visit -- after #142 and #143 had windowed everything else on both pages. The jobs were used for three things: a linked job's name on an appointment, its address in the rep-info text, and the appointment window's "Related Job" picker, which lists every job. Jobs are created automatically when a contract is signed, so the list grows with every sale.

**Decision:**
- **The pages read only the jobs their loaded appointments link to**, by id, through the shared `loadAppointmentContext` (`linkedJobIds`), with only the columns the window uses (`APPOINTMENT_JOB_COLUMNS`: id, name, address -- typed with `satisfies` like #145).
- **The picker's full list comes when someone who can edit opens an appointment** (`getJobOptions`, read as the signed-in person, in name order as before). Until it arrives the picker holds just the job the appointment links to, so the field reads right and saving without touching it keeps the link (`jobPickerOptions`); a "Loading jobs…" line shows meanwhile, or "Couldn't load the job list" if the request fails. A read-only window never asks. The list is fetched fresh on each open, so a job created since the page loaded is there too.
- **The picker still lists every job.** Narrowing it (open jobs first, or type-to-search) changes what people can pick, so it is left for when a company's list is long enough to need it (TECH_DEBT).

**Consequence:** a visit to either page no longer grows with the company's job history; an editor opening an appointment pays for the job list once per open. No database step.

## 148 — Invoices get their own page, and Money to Collect ages by due date

**Date:** 2026-10-06

**Context:** First step of the full invoicing plan the owner approved. Bills to customers were spread out: invoices sat in the Estimates list (left out of its counts), billed contract stages were visible on Payments and Money to Collect, and nothing listed every bill with where it stood. Money to Collect aged its rows from the day each was billed, so a bill sent last week on 30-day terms counted as "current" and one billed 40 days ago on 60-day terms as needing follow-up, whatever their due dates said. It also left out the billed stages of change orders, which Payments counts.

**Decision:**
- **One set of rows for everything billed** (`buildInvoiceRows`, pure and tested): an invoice, or a billed stage of a signed contract or change order. Each row has its amount, what has been paid (settled money only), what is still owed, and a status: Billed; Viewed when the customer opened the document in the portal after it was billed (`estimate_views`, written only by the portal); Part paid; Overdue past the due date on the company's own clock; Payment clearing; Paid; Void for a cancelled invoice (listed once, from the document, since cancelling un-bills its stage) or a stage billed on a contract later voided; Credit for a billed negative amount. The status comes from `phaseState`, the same rule as Payments and the portal.
- **Accounting › Invoices** (`/invoices`) lists them, with filters (Open, Overdue, Paid, Void, All) and the billed-date period in the address, cards counted over every row, search, 200 rows at a time and **+ New invoice**. It is company-wide money, so it has Money to Collect's access: View Financials, off by default for Field and Sales, on for Bookkeeping.
- **Money to Collect reads the same rows** through the same loader (`loadInvoiceRows`), so its outstanding total is the Invoices page's. It now includes billed change-order stages and ages by due date: Not due yet, 1–30, 31–90 and 90+ days late, most overdue first. Billable Now is unchanged.
- **Only the columns the rows need**, in a stable order: both pages used `select("*")` on every estimate (terms included) before.
- **There is no "Sent"**: nothing records whether a bill was texted or only marked billed, so both read "Billed". Recording the send belongs to the sending steps of the plan.
- On phones, stat tiles step their amounts down to fit two across; five-figure amounts were running off the screen.

**Consequence:** one place to see every bill and its state, and an ageing that matches the terms each bill was sent on. Totals on Money to Collect can rise where change-order stages were billed, because those were missing before. No database step.

## 149 — Draft invoices, their own numbering, and payment terms

**Date:** 2026-10-06

**Context:** Step 2 of the invoicing plan the owner approved. An invoice was issued the moment it was saved: one quantity per line, no tax, no terms printed, no way to fix a typo except cancelling it and starting again. It was numbered from the estimates' counter with an INV prefix, so invoice numbers skipped whenever an estimate was made in between. The owner chose: only drafts can be edited (a sent invoice is cancelled and re-issued, which keeps the books clean), and invoices get their own sequence.

**Decision:**
- **Drafts.** The New invoice window gains **Save as draft**. A draft opens in an editor: lines with a quantity and a price (fractions allowed, for hours or yards), which are taxable and at what rate (starting at the company's estimate tax rate), payment terms (Due on receipt, Net 7, 15 or 30), and a note to the customer (`customer_message`, which the document already prints). The money is computed with the estimates' own `computeEstimateTotals` (`invoiceEditTotals`), so the office and the customer always see one number, and the invoice's single bill (its stage) is kept equal to the total. **Send by text** and **Issue without texting** issue it, due its terms from the company's today; **Delete draft** removes it. Every draft action goes through one guard (`loadDraftInvoice`): this company's invoice, still a draft. Cancelling refuses a draft ("delete it instead").
- **Own numbering** (0205): `next_invoice_number` hands out INV-1001, INV-1002, ... from `company_profile.invoice_seq`, which starts above the highest invoice number the company already had. It skips any number already on one of the company's documents, so an invoice numbered by the old code while the migration and the deploy were apart can't clash, and it serves only a member of the company. A draft takes its number when it's started; a deleted draft leaves a gap, as cancelling always has.
- **Payment terms** (`estimates.payment_terms_days`, 0205) are printed on the customer's copy as "Terms: Net 15" or "Terms: Due on receipt", and shown on the office page with the due date.
- **The approval gate leaves invoices alone** (0205 redefines 0136's trigger function with one added line). Invoices were never held by it -- they used to be inserted already issued -- and a draft invoice being issued is the same act. The admin's Approvals queue leaves draft invoices out for the same reason.
- **The Invoices page lists drafts** (a Drafts filter): owed nothing and counted in no total. The portal never shows a draft (it already redirected away from any Draft document).

**Follow-up (1.218.1):** sending a draft swaps the editor for the issued invoice page, and the first version dropped the editor's message with it -- a Pay-link text that failed went unreported. `issueInvoice` now says once it has issued, and the editor hands the outcome to the issued page (this tab's session storage, `invoice-note.ts`).

**Consequence:** an invoice can be got right before it goes out, with quantities, tax and terms, and numbers run in order. **Database step: run 0205 in Supabase before merging** -- the code reads the new columns and calls the new function. The text that carries the Pay link is still the only way the CRM sends an invoice; email is the next step.

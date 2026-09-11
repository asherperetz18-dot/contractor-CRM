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

# Production smoke suite

A separate suite from the unit tests (`npm test`). This one talks to a
real, running instance of the app over the network — locally, or
against real production — rather than testing pure functions in
isolation. Invoked explicitly (`npm run test:e2e`), never as part of
`npm test` or CI's `lint-test-build`.

## Running it

`SMOKE_BASE_URL` is required — there is no default, on purpose (a
production-verification suite should never silently guess whether "no
config" means "hit prod" or "hit nothing"):

```bash
# Against real production (read-only checks only — see below)
SMOKE_BASE_URL=https://crm.aibuildpros.com npm run test:e2e

# Against a local build
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key> \
npm run build && npm run start &
SMOKE_BASE_URL=http://localhost:3000 npm run test:e2e
```

First run needs the browser binary once: `npx playwright install chromium`.

## Safety — this suite is read-only against production

Every spec here only calls `page.goto()`/`request.get()` and reads back
state. **None of them submit a form.** `/login`, `/forgot-password`, and
`/register` all have real side effects on submit (a real auth attempt,
a real password-reset email, a real signup) — this suite loads those
pages to check headers/console/CSP, never fills in or submits them.
Anything that would need a real mutation (CSV import, file upload, a
message send) is written to stop at "the surface renders," deliberately
short of the confirming action — see the comments in
`authenticated-smoke.spec.ts` for exactly where each one stops.

## What's in each file

- **`headers.spec.ts`** — pure HTTP checks (no browser), validating the
  actual response headers a real client receives on public routes, an
  API route, and the unauthenticated `/` → `/login` redirect. Exact
  expected values are in the file itself; see `docs/DECISIONS.md` #011
  for why they're shaped the way they are (staged CSP rollout, narrowed
  HSTS).
- **`public-smoke.spec.ts`** — browser-based: navigates every page
  reachable without logging in, asserts zero unexpected console errors
  and zero CSP violations — except the one documented, expected gap on
  the two statically-prerendered pages (`/login`, `/forgot-password`),
  which can't receive a per-request nonce and so report (not block) a
  `script-src` violation until they're forced dynamic or carved out.
- **`authenticated-smoke.spec.ts`** — everything that needs a real
  logged-in session: dashboard/nav, the reply inbox (Supabase realtime),
  CSV import and file-upload UI reachability, a Drive-backed lead photo,
  a Street View image. Every test is real and would run for real if
  credentials were supplied via env vars — as of this writing none are,
  so they all report `test.skip()` with the exact reason, not a silent
  absence. See the env vars table below.
- **`twilio-and-screenshare.spec.ts`** — documents an actual
  investigation (not an assumption) into whether the Voice dialer and
  screen-share can be exercised headlessly: `getDisplayMedia` resolves
  under Chromium's fake-media-device flags in this kind of environment;
  `getUserMedia` (camera/microphone) reliably hangs instead of
  rejecting. Both real features need `getUserMedia`, and Twilio
  additionally needs a real Access Token from a real account — both
  stay `test.skip()`'d with the full reasoning in the file.
- **`fixtures.ts`** — shared console/CSP-violation capture every spec
  builds on, so each spec asserts against the same tracking rather than
  a hand-rolled copy that might miss a violation type.

## Env vars for the gated (currently skipped) authenticated tests

| Var | Needed for | Why it's not set here |
|---|---|---|
| `E2E_STAFF_EMAIL` / `E2E_STAFF_PASSWORD` | login, nav, reply inbox, CSV/upload UI checks | No seeded test account exists; signup provisions a real company (`src/lib/signup/provision.ts`) |
| `E2E_LEAD_WITH_DRIVE_PHOTO_URL` | Drive-backed image check | Needs a known real lead already carrying a Drive-backed photo — no safe way to discover or create one without a mutation |
| `E2E_LEAD_WITH_ADDRESS_URL` | Street View check | Same, plus `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` must be configured in whatever deployment is under test — without a real key the image fails regardless of CSP |

Supply real values (in CI secrets or a local shell, never committed) and
those tests run for real; leave them unset and they skip with the exact
reason printed in the report.

## What can never be automated here, full stop

- **A real Twilio Voice call** — needs a real Twilio account, a real
  Access Token, and (per the investigation above) a browser environment
  where `getUserMedia` actually resolves.
- **A real two-person screen-share** — needs a second real participant
  on the other end of the signaling, not just one browser exercising
  `getDisplayMedia` in isolation.
- **Vercel dashboard access** (deployment status, environment
  variables, logs) — outside anything a browser hitting the public app
  can observe.

# Observability

How a production failure gets diagnosed hours or days after it happened,
without reproducing it live. Built to prove itself against one concrete
case first: the intermittent Twilio Voice SDK `31000 UnknownError` that
motivated it (see `docs/DECISIONS.md`).

## Architecture

Three destinations, one correlation model:

- **Sentry** (`@sentry/nextjs`) -- every real fault: unhandled exceptions
  and explicit `captureError` calls. Stack traces, tags (environment,
  release, route, correlation id, company id, external service),
  breadcrumbs, grouping. This is the durable "reconstruct it later"
  record -- Sentry's own retention, not a database this app runs.
- **Structured logs** -- one JSON line per lifecycle event
  (`src/lib/observability/logger.ts`), captured for free by Vercel's
  Runtime Logs. Cheap and live-tailable; not durable beyond a few hours,
  so it supplements Sentry rather than replacing it.
- **Existing business tables** (Supabase) -- outcomes only. `call_logs`
  gained two nullable columns (`correlation_id`, `sentry_event_id`,
  migration `0149`) linking a business record to its trace; it did not
  become a logging table.

Config: `sentry.server.config.ts`, `sentry.edge.config.ts`,
`src/instrumentation-client.ts` each call `Sentry.init(commonSentryOptions())`
(`src/lib/observability/sentry-init.ts`). `src/instrumentation.ts` loads
whichever config matches the runtime and wires `onRequestError` as the
framework-level catch-all for anything that escapes manual instrumentation.

## Correlation model

One id per logical operation (`crypto.randomUUID()`), minted at the
earliest point it starts, threaded through every hop:

- Browser action (place a call) -- minted client-side.
- Browser → API route -- `x-correlation-id` header.
- Browser → Server Action -- passed as a plain argument
  (`withActionObservability`, `src/lib/observability/observe.ts`).
- **Twilio specifically**: no header Twilio will forward for us, so the
  id rides as a `CorrelationId` param on `device.connect({params})`
  (`voice-dialer.tsx`). Twilio POSTs it back as a form field to
  `/api/voice/twiml`, which forwards it as `?cid=` on the URLs it hands
  Twilio for `/api/voice/announce` and `/api/voice/recording-status`.

**Important nuance**: this stitches events together by a shared tag, not
one merged breadcrumb timeline. The browser accumulates one continuous
breadcrumb trail for the whole call (`call_requested` through
`ringing`/`error`/`completed`) because it's one JS session. But
`/api/voice/twiml`, `/api/voice/announce`, and `/api/voice/recording-status`
are three separate serverless invocations -- each gets its own Sentry
scope from scratch, so a breadcrumb set in one isn't visible when another
later captures an error. To reconstruct the whole operation, search
Sentry (and the structured logs) for the shared `correlationId` tag
across all of them, rather than expecting one unified breadcrumb list.

## Breadcrumb taxonomy (voice dialer)

```
call_requested → token_created → device_ready → call_connecting
  → ringing → connected | completed | cancelled | error
```

Emitted from `voice-dialer.tsx` via `addBreadcrumb`
(`src/lib/observability/sentry.ts`). Each carries the correlation id and
whatever safe data is relevant (masked number, call SID, `recordEnabled`)
-- never a raw phone number or credential.

## Privacy / redaction

Allowlist-based, in `src/lib/observability/redact.ts`:

- `maskPhone` -- keeps country code + last 4 digits, never the whole number.
- `pickSafeFields` -- the one primitive everything else is built on.
- `scrubForbiddenKeys` -- last-line-of-defense: drops any key matching
  `/token|secret|password|authorization|cookie/i`, wherever it appears.
- `safeUser` -- `{userId, companyId, role}` only, never name/email.
- `safeTwilioError` -- pulls `code`/`message`/`causes`/`solutions` off a
  Twilio error, nothing else (never the auth token or API key secret
  that might be sitting elsewhere on the same object).

`sentry-init.ts`'s `beforeSend`/`beforeBreadcrumb` hooks apply the same
scrubbing globally to *every* Sentry event, including ones from Next's
own automatic error capture (`onRequestError`) -- not just from this
app's own `captureError` call sites. Request bodies, cookies, and headers
are dropped unconditionally on every event (`sendDefaultPii: false` plus
explicit stripping), since that's exactly where a Supabase session
cookie or an `Authorization` header would otherwise end up.

## Alerting

Configured in Sentry, separate from what gets recorded:

- Every `captureError` call is recorded as an issue. That alone never
  pages anyone.
- A user-caused/validation failure (a mistyped number, "not signed in")
  passes `expected: true`, which downgrades severity to `info` and tags
  the event -- recorded, excluded from alert rules.
- Alert rules fire on a **new** issue in an external-service area
  (`service: "twilio" | "stripe" | "email" | "ai" | "cron" | "uploads" | "auth"`)
  or on a **rate** threshold on an existing one -- not on every occurrence.

## Known gaps (tracked in `docs/TECH_DEBT.md`)

- This repo builds with Turbopack (see `docs/DECISIONS.md` #012-#013),
  under which `@sentry/nextjs`'s webpack-based auto-instrumentation and
  source-map upload no-op. All capture here is therefore manual by
  design, not a fallback -- but stack traces in Sentry may show minified
  code until a Turbopack-compatible source-map upload step is added.
- `src/proxy.ts` (this Next.js fork's renamed `middleware.ts`) isn't
  covered by Sentry's auto-instrumentation, which looks for a file
  literally named `middleware.ts`. It's also outside `withRouteObservability`'s
  reach today, since its own matcher excludes `/api/*` and it has no
  correlation id of its own yet.
- Only the Twilio voice-calling path (this feature's proving case) is
  instrumented so far. Stripe webhooks, SMS, email, AI requests, cron
  jobs, uploads, and auth failures still use the ad hoc `console.error`
  calls that predate this -- extending the same `withRouteObservability`/
  `withActionObservability` pattern to them is the next slice of work.

/**
 * One correlation id per logical operation (a dialer call, a webhook
 * chain, a cron run), minted at the earliest point it starts and carried
 * through every hop -- browser, server action, API route, Twilio webhook
 * -- so a Sentry issue or a log line can be traced back to everything
 * else that happened in the same operation, on a different process,
 * hours later.
 */

const CORRELATION_ID_PATTERN = /^[0-9a-f-]{36}$/i;

export function newCorrelationId(): string {
  return crypto.randomUUID();
}

/**
 * A correlation id arriving from outside (a header, a Twilio form field)
 * is untrusted input -- it rides along into every tag and log line for
 * the rest of the operation, so anything not shaped like the id we
 * ourselves mint is replaced rather than trusted.
 */
export function resolveCorrelationId(inbound: string | null | undefined): string {
  const trimmed = inbound?.trim();
  if (trimmed && CORRELATION_ID_PATTERN.test(trimmed)) return trimmed;
  return newCorrelationId();
}

/**
 * Vercel's own environment name ("production" | "preview" |
 * "development"), else NODE_ENV. `VERCEL_ENV` is server-only -- Next.js
 * never inlines it into the client bundle on its own -- so the browser
 * falls through to `NEXT_PUBLIC_APP_ENV` (that same value, mirrored by
 * next.config.ts). Without it, a client-side event captured on a Preview
 * deploy would read NODE_ENV instead, which is "production" on both
 * Preview and Production Vercel builds -- silently conflating the two.
 */
export function currentEnvironment(): string {
  return (
    process.env.VERCEL_ENV || process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV || "development"
  );
}

/**
 * The deploy this event happened on, so a spike in errors right after a
 * release is visible as "all on release X" rather than a mystery.
 * `VERCEL_GIT_COMMIT_SHA` is Vercel's own build-time var (server-only);
 * `NEXT_PUBLIC_APP_RELEASE` is that same value mirrored into the client
 * bundle by next.config.ts, since the browser can't read the former.
 */
export function currentRelease(): string | undefined {
  return process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_APP_RELEASE || undefined;
}

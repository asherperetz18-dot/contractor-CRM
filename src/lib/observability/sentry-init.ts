import { currentEnvironment, currentRelease } from "./context.ts";
import { scrubForbiddenKeys } from "./redact.ts";

/**
 * Shared `Sentry.init()` options for all three runtimes (server, edge,
 * client -- see sentry.server.config.ts / sentry.edge.config.ts /
 * instrumentation-client.ts). Deliberately doesn't import "@sentry/nextjs"
 * itself: keeping this dependency-free is what makes it unit-testable
 * under plain `node --test` (see sentry.test.ts for why the SDK itself
 * isn't mockable in that environment) and keeps one place responsible for
 * "nothing unsafe leaves the process," independent of which runtime is
 * actually sending it.
 */

// Deliberately loose (no index signatures on the nested shapes): this
// only needs to *structurally bound* Sentry's real `ErrorEvent`/
// `Breadcrumb` types for the generic below, not describe them fully --
// an index signature here would make TS demand one on Sentry's own
// (unmodifiable) types too, which don't have one.
type MinimalEvent = {
  request?: { headers?: unknown; cookies?: unknown; data?: unknown };
  extra?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
};

/**
 * Sentry's Next.js SDK can, by default, capture the incoming request --
 * headers, cookies, body. That is exactly where a Supabase session
 * cookie or an Authorization header lives, so all three are dropped
 * unconditionally rather than filtered key-by-key.
 */
export function scrubEvent<T extends MinimalEvent>(event: T): T {
  const next: T = { ...event };
  if (next.request) {
    const { headers: _headers, cookies: _cookies, data: _data, ...restRequest } = next.request;
    next.request = restRequest as T["request"];
  }
  if (next.extra) next.extra = scrubForbiddenKeys(next.extra);
  if (next.tags) next.tags = scrubForbiddenKeys(next.tags);
  if (next.contexts) {
    const scrubbed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(next.contexts)) {
      scrubbed[key] = value && typeof value === "object" ? scrubForbiddenKeys(value as Record<string, unknown>) : value;
    }
    next.contexts = scrubbed as T["contexts"];
  }
  return next;
}

type BreadcrumbLike = { category?: string; message?: string; data?: Record<string, unknown> };

export function scrubBreadcrumb<T extends BreadcrumbLike>(breadcrumb: T): T {
  if (!breadcrumb.data) return breadcrumb;
  return { ...breadcrumb, data: scrubForbiddenKeys(breadcrumb.data) };
}

export function commonSentryOptions() {
  return {
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
    environment: currentEnvironment(),
    release: currentRelease(),
    // Sentry's own request/user auto-capture is exactly the PII surface
    // this app must never ship -- redaction here is defense in depth on
    // top of that, not a substitute for it.
    sendDefaultPii: false,
    tracesSampleRate: currentEnvironment() === "production" ? 0.1 : 1,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}

import * as Sentry from "@sentry/nextjs";
import { currentEnvironment, currentRelease } from "./context.ts";
import { scrubForbiddenKeys } from "./redact.ts";

/**
 * Thin, whitelist-enforcing wrapper around the Sentry SDK. Nothing in
 * this app should call `Sentry.captureException`/`Sentry.addBreadcrumb`
 * directly -- going through here is what guarantees every event carries
 * the same tags (environment, release, route, correlation id) and never
 * carries a secret-shaped field, no matter which call site forgot to
 * check.
 */

export type ErrorSeverity = "fatal" | "error" | "info";

export type CaptureErrorOptions = {
  /** Route or server action name, e.g. "api/voice/announce". */
  route?: string;
  correlationId?: string;
  companyId?: string;
  userId?: string;
  /** External system this failure is about, e.g. "twilio" | "stripe" | "email" | "ai" | "cron" | "uploads" | "auth". */
  service?: string;
  /**
   * A user-caused/validation failure -- a mistyped number, "not signed
   * in", a declined card. Still recorded, but downgraded to 'info' and
   * tagged so alert rules can exclude it: one of these should never page
   * anyone.
   */
  expected?: boolean;
  /** Overrides the severity implied by `expected`. */
  severity?: ErrorSeverity;
  /** Already-safe, already-redacted fields -- never a raw request/error object. */
  extra?: Record<string, unknown>;
};

type ErrorContext = {
  tags: Record<string, string>;
  user?: { id: string };
  level: ErrorSeverity;
  extra?: Record<string, unknown>;
};

/**
 * Builds the exact payload that will be sent to Sentry. Kept pure and
 * separate from the network call so the tagging/redaction rules are
 * unit-testable without a live DSN.
 */
export function buildErrorContext(options: CaptureErrorOptions): ErrorContext {
  const level: ErrorSeverity = options.severity ?? (options.expected ? "info" : "error");
  const tags: Record<string, string> = { environment: currentEnvironment() };
  const release = currentRelease();
  if (release) tags.release = release;
  if (options.route) tags.route = options.route;
  if (options.correlationId) tags.correlationId = options.correlationId;
  if (options.companyId) tags.companyId = options.companyId;
  if (options.service) tags.service = options.service;
  if (options.expected) tags.expected = "true";

  return {
    tags,
    user: options.userId ? { id: options.userId } : undefined,
    level,
    extra: options.extra ? scrubForbiddenKeys(options.extra) : undefined,
  };
}

/**
 * Observability must never be able to break the feature it's watching.
 * Guards every actual SDK call: a bad build, a missing DSN, or (in tests)
 * a module-resolution quirk that leaves an SDK function undefined must
 * degrade to a no-op, never throw into business logic.
 */
function safely(fn: () => void): void {
  try {
    fn();
  } catch {
    // Deliberately swallowed -- see the doc comment above.
  }
}

/** Records a real fault. Returns the Sentry event id for cross-linking (e.g. onto a call_logs row), when available. */
export function captureError(error: unknown, options: CaptureErrorOptions = {}): string | undefined {
  const context = buildErrorContext(options);
  let eventId: string | undefined;
  safely(() => {
    if (context.level === "info") {
      const message = error instanceof Error ? error.message : String(error);
      eventId = Sentry.captureMessage(message, {
        level: "info",
        tags: context.tags,
        user: context.user,
        extra: context.extra,
      });
      return;
    }
    eventId = Sentry.captureException(error, {
      level: context.level,
      tags: context.tags,
      user: context.user,
      extra: context.extra,
    });
  });
  return eventId;
}

/**
 * One lifecycle transition. Cheap, and travels with whatever error fires
 * later in the same scope -- this is what makes "reconstruct it days
 * later" possible without a separate log database.
 */
export function addBreadcrumb(input: {
  category: string;
  message: string;
  correlationId?: string;
  data?: Record<string, unknown>;
}): void {
  safely(() =>
    Sentry.addBreadcrumb({
      category: input.category,
      message: input.message,
      level: "info",
      data: scrubForbiddenKeys({ correlationId: input.correlationId, ...(input.data ?? {}) }),
    })
  );
}

/** Tags the active scope so every event/breadcrumb in this request carries the same identity. */
export function setRouteScope(input: { route: string; correlationId: string; companyId?: string; userId?: string }): void {
  const tags: Record<string, string> = { route: input.route, correlationId: input.correlationId };
  if (input.companyId) tags.companyId = input.companyId;
  safely(() => Sentry.setTags(tags));
  if (input.userId) safely(() => Sentry.setUser({ id: input.userId! }));
}

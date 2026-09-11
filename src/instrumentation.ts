import type { Instrumentation } from "next";
import * as Sentry from "@sentry/nextjs";
import { logError } from "@/lib/observability/logger";

/**
 * Runs once per server instance, before it serves a request. Loads the
 * matching Sentry init for whichever runtime this instance actually is --
 * see sentry.server.config.ts / sentry.edge.config.ts.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  } else {
    await import("../sentry.server.config");
  }
}

/**
 * The framework-level catch-all: anything that throws during Server
 * Component rendering, a route handler, or a Server Action and isn't
 * already caught by this app's own `withRouteObservability`/
 * `withActionObservability` wrappers still lands here, so nothing falls
 * through with zero signal. `Sentry.captureRequestError` runs through
 * the same `beforeSend`/`beforeBreadcrumb` redaction configured in
 * sentry-init.ts -- this is a safety net, not a second redaction path.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  logError({
    event: "unhandled_request_error",
    route: request.path,
    method: request.method,
    routeType: context.routeType,
  });
  Sentry.captureRequestError(error, request, context);
};

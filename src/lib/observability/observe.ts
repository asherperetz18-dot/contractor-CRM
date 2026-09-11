import type { NextRequest } from "next/server";
import { resolveCorrelationId } from "./context.ts";
import { logError, logInfo } from "./logger.ts";
import { captureError, setRouteScope } from "./sentry.ts";

/**
 * The one place a request/action's outcome is timed, logged, tagged, and
 * -- on failure -- reported. `src/proxy.ts` doesn't cover `/api/*` (its
 * matcher excludes it), so API routes and Server Actions each resolve
 * and thread their own correlation id through this rather than relying
 * on a shared middleware layer.
 */
export async function runObserved<T>(input: {
  name: string;
  correlationId: string;
  companyId?: string;
  userId?: string;
  service?: string;
  fn: () => Promise<T>;
}): Promise<T> {
  setRouteScope({ route: input.name, correlationId: input.correlationId, companyId: input.companyId, userId: input.userId });
  const startedAt = Date.now();
  try {
    const result = await input.fn();
    logInfo({
      event: `${input.name}.completed`,
      route: input.name,
      correlationId: input.correlationId,
      companyId: input.companyId,
      service: input.service,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (err) {
    logError({
      event: `${input.name}.failed`,
      route: input.name,
      correlationId: input.correlationId,
      companyId: input.companyId,
      service: input.service,
      durationMs: Date.now() - startedAt,
    });
    captureError(err, { route: input.name, correlationId: input.correlationId, companyId: input.companyId, service: input.service });
    throw err;
  }
}

/**
 * For a simple API route where the correlation id travels as a header
 * (browser -> our API route). Twilio's own webhooks POST it as a form
 * field instead -- those routes read it out of the parsed body and call
 * `runObserved` directly rather than using this wrapper.
 */
export function withRouteObservability(
  route: string,
  handler: (req: NextRequest) => Promise<Response>
): (req: NextRequest) => Promise<Response> {
  return (req: NextRequest) =>
    runObserved({
      name: route,
      correlationId: resolveCorrelationId(req.headers.get("x-correlation-id")),
      fn: () => handler(req),
    });
}

/** For a Server Action, whose correlation id is passed as a plain argument by the caller. */
export function withActionObservability<T>(
  action: string,
  correlationId: string,
  fn: () => Promise<T>
): Promise<T> {
  return runObserved({ name: action, correlationId, fn });
}

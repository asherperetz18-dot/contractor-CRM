import { currentEnvironment, currentRelease } from "./context.ts";
import { scrubForbiddenKeys } from "./redact.ts";

/**
 * The cheap, live-tailable half of the observability story: one JSON line
 * per lifecycle event, captured for free by Vercel's Runtime Logs. Not
 * the durable "reconstruct it days later" record -- that's Sentry, via
 * the matching breadcrumb these same call sites should also emit (see
 * sentry.ts). This is for watching an incident happen right now, and for
 * grepping the last few hours of a specific route.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

// A log call site names what happened (`event`) and whatever safe,
// already-redacted context is relevant -- never a raw request/error object.
export type LogFields = {
  event: string;
  route?: string;
  correlationId?: string;
  companyId?: string;
  service?: string;
  [key: string]: unknown;
};

function emit(level: LogLevel, fields: LogFields) {
  const line = scrubForbiddenKeys({
    timestamp: new Date().toISOString(),
    level,
    environment: currentEnvironment(),
    release: currentRelease(),
    ...fields,
  });
  const json = JSON.stringify(line);
  // stderr for anything actionable, stdout for routine lifecycle --
  // separates "worth a look" from "just tailing" at the stream level.
  if (level === "error" || level === "warn") console.error(json);
  else console.log(json);
}

export function logDebug(fields: LogFields): void {
  emit("debug", fields);
}
export function logInfo(fields: LogFields): void {
  emit("info", fields);
}
export function logWarn(fields: LogFields): void {
  emit("warn", fields);
}
export function logError(fields: LogFields): void {
  emit("error", fields);
}

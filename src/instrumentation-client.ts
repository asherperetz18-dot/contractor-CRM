import * as Sentry from "@sentry/nextjs";
import { commonSentryOptions } from "@/lib/observability/sentry-init";

// Runs after the document loads, before hydration -- see Next's own
// instrumentation-client.md. Client-side errors (including anything the
// dialer's own captureError calls report) flow through the same
// beforeSend/beforeBreadcrumb redaction as the server, via
// commonSentryOptions().
Sentry.init(commonSentryOptions());

export function onRouterTransitionStart(url: string) {
  Sentry.addBreadcrumb({ category: "navigation", message: `Navigated to ${url}`, level: "info" });
}

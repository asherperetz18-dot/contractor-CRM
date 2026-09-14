import * as Sentry from "@sentry/nextjs";
import { commonSentryOptions } from "@/lib/observability/sentry-init";

// Loaded from src/instrumentation.ts's register() on the Node.js runtime.
// No DSN configured yet means this simply doesn't send anything -- see
// docs/features/observability.md for what's left to wire up.
Sentry.init(commonSentryOptions());

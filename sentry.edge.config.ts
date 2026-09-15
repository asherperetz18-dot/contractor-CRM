import * as Sentry from "@sentry/nextjs";
import { commonSentryOptions } from "@/lib/observability/sentry-init";

// Loaded from src/instrumentation.ts's register() on the Edge runtime
// (src/proxy.ts, and any route explicitly opted into `runtime: "edge"`).
Sentry.init(commonSentryOptions());

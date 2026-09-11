import { test } from "node:test";
import assert from "node:assert/strict";
import { addBreadcrumb, buildErrorContext, captureError, setRouteScope } from "./sentry.ts";

/**
 * `captureError`/`addBreadcrumb`/`setRouteScope` are one-line forwards to
 * the real Sentry SDK and are deliberately not unit-tested here: under
 * plain `node --test` (no bundler), `@sentry/nextjs`'s package.json
 * `exports` map resolves to a CJS build whose named exports Node's
 * ESM/CJS interop (cjs-module-lexer) can't statically see, so a mocked
 * `Sentry.captureException` silently isn't the function this module
 * calls -- a false-negative risk, not a real gap. Next.js's own bundler
 * (webpack/Turbopack) resolves the correct ESM build in the real app, so
 * this is a test-environment artifact. All of the logic that's actually
 * ours -- tagging, severity, redaction -- lives in `buildErrorContext`,
 * a pure function, and is fully covered below. The thin pass-throughs
 * are verified end-to-end in Slice 2 by placing a real call and checking
 * the Sentry dashboard.
 */

test("buildErrorContext tags every event with environment, route and correlation id", () => {
  const ctx = buildErrorContext({ route: "api/voice/twiml", correlationId: "cid-1", service: "twilio" });
  assert.equal(ctx.tags.route, "api/voice/twiml");
  assert.equal(ctx.tags.correlationId, "cid-1");
  assert.equal(ctx.tags.service, "twilio");
  assert.equal(typeof ctx.tags.environment, "string");
  assert.equal(ctx.level, "error");
});

test("buildErrorContext downgrades an expected/user-caused failure to 'info' so it's recorded but never alerted", () => {
  const ctx = buildErrorContext({ expected: true, route: "actions/auth" });
  assert.equal(ctx.level, "info");
  assert.equal(ctx.tags.expected, "true");
});

test("buildErrorContext never forwards a secret-shaped key from `extra`", () => {
  const ctx = buildErrorContext({ extra: { callSid: "CA1", authToken: "shh" } });
  assert.deepEqual(ctx.extra, { callSid: "CA1" });
});

test("buildErrorContext omits the user tag entirely when no userId is given", () => {
  const ctx = buildErrorContext({});
  assert.equal(ctx.user, undefined);
});

test("captureError/addBreadcrumb/setRouteScope never throw, even when the underlying SDK call is unavailable", () => {
  // Regression guard for exactly the module-resolution quirk described
  // above: this call site must degrade to a no-op, not crash whatever
  // business logic it was wrapping.
  assert.doesNotThrow(() => captureError(new Error("boom"), { route: "test" }));
  assert.doesNotThrow(() => addBreadcrumb({ category: "voice", message: "ringing" }));
  assert.doesNotThrow(() => setRouteScope({ route: "test", correlationId: "cid-1" }));
});


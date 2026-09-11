import { test } from "node:test";
import assert from "node:assert/strict";
import { commonSentryOptions, scrubBreadcrumb, scrubEvent } from "./sentry-init.ts";

/**
 * These feed straight into Sentry's `beforeSend`/`beforeBreadcrumb` hooks
 * -- the last line of defense before anything leaves the process. No DSN
 * is configured for these tests (and none of this touches the network);
 * this only tests the redaction shape.
 */

test("commonSentryOptions never captures full request bodies/PII by default", () => {
  const options = commonSentryOptions();
  assert.equal(options.sendDefaultPii, false);
  assert.equal(typeof options.beforeSend, "function");
  assert.equal(typeof options.beforeBreadcrumb, "function");
});

test("scrubEvent strips request headers/cookies/body entirely -- exactly where a session cookie or Authorization header would land", () => {
  const event = {
    request: {
      headers: { authorization: "Bearer abc", "user-agent": "test" },
      cookies: { session: "abc" },
      data: { password: "hunter2" },
      url: "/api/voice/twiml",
    },
  };
  const scrubbed = scrubEvent(event);
  assert.equal(scrubbed.request?.headers, undefined);
  assert.equal(scrubbed.request?.cookies, undefined);
  assert.equal(scrubbed.request?.data, undefined);
  assert.equal(scrubbed.request?.url, "/api/voice/twiml");
});

test("scrubEvent scrubs secret-shaped keys out of extra, tags, and every context", () => {
  const event = {
    extra: { callSid: "CA1", authToken: "shh" },
    tags: { route: "api/voice/twiml", cookie: "shh" },
    contexts: { app: { release: "abc123", secret: "shh" } },
  };
  const scrubbed = scrubEvent(event);
  assert.deepEqual(scrubbed.extra, { callSid: "CA1" });
  assert.deepEqual(scrubbed.tags, { route: "api/voice/twiml" });
  assert.deepEqual(scrubbed.contexts?.app, { release: "abc123" });
});

test("scrubEvent is a no-op shape-wise on an event with none of those fields present", () => {
  const event = { message: "hello", request: undefined, extra: undefined, tags: undefined, contexts: undefined };
  assert.deepEqual(scrubEvent(event), event);
});

test("scrubBreadcrumb strips secret-shaped keys from breadcrumb data", () => {
  const breadcrumb = { category: "voice", data: { callSid: "CA1", authToken: "shh" } };
  assert.deepEqual(scrubBreadcrumb(breadcrumb).data, { callSid: "CA1" });
});

test("scrubBreadcrumb leaves a breadcrumb with no data untouched", () => {
  const breadcrumb = { category: "voice", message: "ringing" };
  assert.deepEqual(scrubBreadcrumb(breadcrumb), breadcrumb);
});

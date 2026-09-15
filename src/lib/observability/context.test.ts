import { test } from "node:test";
import assert from "node:assert/strict";
import { currentEnvironment, currentRelease, newCorrelationId, resolveCorrelationId } from "./context.ts";

function withEnv(vars: Record<string, string | undefined>, run: () => void) {
  const env = process.env as Record<string, string | undefined>;
  const prior: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) prior[key] = env[key];
  try {
    for (const [key, value] of Object.entries(vars)) {
      // Assigning `undefined` to process.env coerces to the string
      // "undefined" rather than clearing it -- delete the key instead.
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
    run();
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  }
}

test("newCorrelationId produces a fresh UUID-shaped id each time", () => {
  const a = newCorrelationId();
  const b = newCorrelationId();
  assert.match(a, /^[0-9a-f-]{36}$/i);
  assert.notEqual(a, b);
});

test("resolveCorrelationId trusts a well-formed inbound id instead of minting a new one", () => {
  const inbound = "9f3c2b1a-0000-4000-8000-000000000000";
  assert.equal(resolveCorrelationId(inbound), inbound);
});

test("resolveCorrelationId mints a fresh id when none was sent, or it's malformed", () => {
  assert.match(resolveCorrelationId(null), /^[0-9a-f-]{36}$/i);
  assert.match(resolveCorrelationId(undefined), /^[0-9a-f-]{36}$/i);
  assert.match(resolveCorrelationId(""), /^[0-9a-f-]{36}$/i);
  // A header is attacker-controlled input -- an oversized or symbol-laden
  // value must never ride along into every downstream tag and log line.
  assert.match(resolveCorrelationId("a".repeat(500)), /^[0-9a-f-]{36}$/i);
  assert.match(resolveCorrelationId("<script>alert(1)</script>"), /^[0-9a-f-]{36}$/i);
});

test("currentEnvironment prefers Vercel's environment name over NODE_ENV", () => {
  withEnv({ VERCEL_ENV: "preview", NODE_ENV: "production" }, () => {
    assert.equal(currentEnvironment(), "preview");
  });
});

test("currentEnvironment falls back to NODE_ENV, then 'development'", () => {
  withEnv({ VERCEL_ENV: undefined, NODE_ENV: "test" }, () => {
    assert.equal(currentEnvironment(), "test");
  });
  withEnv({ VERCEL_ENV: undefined, NODE_ENV: undefined }, () => {
    assert.equal(currentEnvironment(), "development");
  });
});

test("currentEnvironment falls back to the client-exposed mirror when VERCEL_ENV itself isn't readable (the browser bundle)", () => {
  // VERCEL_ENV is a server-only var -- Next.js never inlines it into the
  // client bundle on its own. Without this fallback, a client-side
  // Sentry event captured on a Preview deploy would be mistagged
  // "production" (NODE_ENV is "production" on both Preview and
  // Production Vercel builds), conflating the two. See next.config.ts's
  // NEXT_PUBLIC_APP_ENV mirror.
  withEnv({ VERCEL_ENV: undefined, NEXT_PUBLIC_APP_ENV: "preview", NODE_ENV: "production" }, () => {
    assert.equal(currentEnvironment(), "preview");
  });
});

test("currentRelease reads the deploy commit SHA when present, else the client-exposed fallback", () => {
  withEnv({ VERCEL_GIT_COMMIT_SHA: "abc123", NEXT_PUBLIC_APP_RELEASE: undefined }, () => {
    assert.equal(currentRelease(), "abc123");
  });
  withEnv({ VERCEL_GIT_COMMIT_SHA: undefined, NEXT_PUBLIC_APP_RELEASE: "def456" }, () => {
    assert.equal(currentRelease(), "def456");
  });
  withEnv({ VERCEL_GIT_COMMIT_SHA: undefined, NEXT_PUBLIC_APP_RELEASE: undefined }, () => {
    assert.equal(currentRelease(), undefined);
  });
});

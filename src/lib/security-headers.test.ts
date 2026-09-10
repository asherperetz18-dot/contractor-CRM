import { test } from "node:test";
import assert from "node:assert/strict";
import { reportOnlyCsp } from "./security-headers.ts";

const NONCE = "TEST_NONCE_VALUE";

test("script-src carries the nonce in the exact format Next.js's own parser expects", () => {
  // node_modules/next/dist/server/app-render/get-script-nonce-from-header.js
  // matches /^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/ against each space-
  // separated source in the script-src (or default-src) directive. If
  // this drifts from that shape, Next silently stops applying nonces to
  // its own framework scripts -- no error, just a CSP violation on every
  // dynamically rendered page.
  const csp = reportOnlyCsp(NONCE);
  const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src"));
  assert.ok(scriptSrc, "script-src directive is present");
  assert.match(scriptSrc!, new RegExp(`'nonce-${NONCE}'`));
});

test("style-src carries the same nonce, plus the documented 'unsafe-inline' fallback for the style attribute", () => {
  const csp = reportOnlyCsp(NONCE);
  const styleSrc = csp.split(";").find((d) => d.trim().startsWith("style-src "));
  assert.ok(styleSrc);
  assert.match(styleSrc!, new RegExp(`'nonce-${NONCE}'`));
  assert.match(styleSrc!, /'unsafe-inline'/);
  // The attribute form has no nonce mechanism at all -- style-src-attr
  // must allow it explicitly, in its own directive.
  assert.match(csp, /style-src-attr 'unsafe-inline'/);
});

test("connect-src and img-src include the Supabase project's https and wss origins, derived from its URL", () => {
  const prior = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcxyz123.supabase.co";
  try {
    const csp = reportOnlyCsp(NONCE);
    assert.match(csp, /connect-src[^;]*https:\/\/abcxyz123\.supabase\.co/);
    assert.match(csp, /connect-src[^;]*wss:\/\/abcxyz123\.supabase\.co/);
    assert.match(csp, /img-src[^;]*https:\/\/abcxyz123\.supabase\.co/);
  } finally {
    if (prior === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = prior;
  }
});

test("never throws when NEXT_PUBLIC_SUPABASE_URL is missing or malformed -- just omits the Supabase origins", () => {
  const prior = process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    assert.doesNotThrow(() => reportOnlyCsp(NONCE));
    const cspMissing = reportOnlyCsp(NONCE);
    assert.match(cspMissing, /connect-src 'self' https:\/\/\*\.twilio\.com/);

    process.env.NEXT_PUBLIC_SUPABASE_URL = "not a url";
    assert.doesNotThrow(() => reportOnlyCsp(NONCE));
  } finally {
    if (prior === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = prior;
  }
});

test("connect-src allows Twilio's signaling domains for the in-app Voice dialer", () => {
  const csp = reportOnlyCsp(NONCE);
  assert.match(csp, /connect-src[^;]*https:\/\/\*\.twilio\.com/);
  assert.match(csp, /connect-src[^;]*wss:\/\/\*\.twilio\.com/);
});

test("img-src allows Google Drive thumbnails and the Street View static image, plus blob:/data: for local previews and signatures", () => {
  const csp = reportOnlyCsp(NONCE);
  const imgSrc = csp.split(";").find((d) => d.trim().startsWith("img-src"));
  assert.ok(imgSrc);
  assert.match(imgSrc!, /blob:/);
  assert.match(imgSrc!, /data:/);
  assert.match(imgSrc!, /https:\/\/drive\.google\.com/);
  assert.match(imgSrc!, /https:\/\/maps\.googleapis\.com/);
});

test("locks down the directives that never need a runtime allowlist", () => {
  const csp = reportOnlyCsp(NONCE);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.match(csp, /form-action 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
});

test("never includes upgrade-insecure-requests -- meaningless in a Report-Only policy, and Chromium logs a console error for it on every page load", () => {
  // Regression guard for a real console error found via
  // e2e/public-smoke.spec.ts against production: "The Content Security
  // Policy directive 'upgrade-insecure-requests' is ignored when
  // delivered in a report-only policy." It stays in the *enforcing*
  // CSP (next.config.ts), where it actually takes effect.
  const csp = reportOnlyCsp(NONCE);
  assert.doesNotMatch(csp, /upgrade-insecure-requests/);
});

test("'unsafe-eval' appears only in development, never in a production policy", () => {
  // NODE_ENV is typed read-only (it's meant to be set once by the
  // runtime, not toggled at test time) -- go through the plain index
  // signature to flip it back and forth for this one test.
  const env = process.env as Record<string, string | undefined>;
  const prior = env.NODE_ENV;
  try {
    env.NODE_ENV = "production";
    assert.doesNotMatch(reportOnlyCsp(NONCE), /unsafe-eval/);

    env.NODE_ENV = "development";
    assert.match(reportOnlyCsp(NONCE), /'unsafe-eval'/);
  } finally {
    env.NODE_ENV = prior;
  }
});

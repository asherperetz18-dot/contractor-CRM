import { test, expect } from "@playwright/test";

/**
 * Pure HTTP checks -- no browser rendering, just the response headers
 * this app is supposed to send everywhere (docs/DECISIONS.md #011).
 * Validates the actual header *values* a real client receives, not the
 * next.config.ts/proxy.ts source that generates them.
 */

const SAFE_HEADERS = {
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy":
    "camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=(), midi=(), magnetometer=(), gyroscope=(), accelerometer=(), interest-cohort=()",
};

const ENFORCING_CSP =
  "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests";

// "/" always 307-redirects to /login for an unauthenticated request --
// proxy.ts returns NextResponse.redirect(url) directly for that case,
// before buildResponse() (where the nonce/Report-Only CSP get set)
// ever runs. Correct behavior: a redirect has no HTML body, so there's
// nothing for a page-content CSP to protect. Verified against real
// production (not assumed): the redirect carries the enforcing CSP and
// every safe header, but genuinely has no content-security-policy-
// report-only header at all. The nonce-specific checks below only run
// on paths that actually render a page.
const ALL_PUBLIC_PATHS = ["/", "/login", "/forgot-password", "/register", "/welcome", "/get-started"];
const RENDERED_PUBLIC_PATHS = ALL_PUBLIC_PATHS.filter((p) => p !== "/");

test.describe("Response security headers (public, unauthenticated routes)", () => {
  for (const path of ALL_PUBLIC_PATHS) {
    test(`${path} carries the full safe header set`, async ({ request }) => {
      const res = await request.get(path, { maxRedirects: 0 });
      const headers = res.headers();

      for (const [key, value] of Object.entries(SAFE_HEADERS)) {
        expect(headers[key], `${key} on ${path}`).toBe(value);
      }

      // HSTS: exactly max-age=15552000 -- specifically NOT
      // includeSubDomains or preload (docs/DECISIONS.md #011 -- neither
      // can be verified as safe from this repo alone, so neither ships).
      expect(headers["strict-transport-security"], `HSTS on ${path}`).toBe("max-age=15552000");
      expect(headers["strict-transport-security"]).not.toMatch(/includeSubDomains/i);
      expect(headers["strict-transport-security"]).not.toMatch(/preload/i);

      // The enforcing CSP stays narrow -- the real, restrictive policy
      // must never appear here (that's the Report-Only header's job).
      expect(headers["content-security-policy"], `enforcing CSP on ${path}`).toBe(ENFORCING_CSP);
    });
  }

  for (const path of RENDERED_PUBLIC_PATHS) {
    test(`${path} carries the Report-Only CSP with a fresh nonce, still non-enforcing`, async ({
      request,
    }) => {
      const res = await request.get(path, { maxRedirects: 0 });
      const reportOnly = res.headers()["content-security-policy-report-only"];
      expect(reportOnly, `content-security-policy-report-only on ${path}`).toBeTruthy();

      // Must be present as its OWN header, distinct from the enforcing
      // one -- if this string ever appears under the plain
      // Content-Security-Policy key instead, someone flipped it early.
      expect(res.headers()["content-security-policy"]).toBe(ENFORCING_CSP);

      // Format Next.js's own nonce parser requires
      // (get-script-nonce-from-header.js): 'nonce-<base64url>'.
      const nonceMatch = reportOnly!.match(/'nonce-([A-Za-z0-9+/_-]+=*)'/);
      expect(nonceMatch, `nonce present in Report-Only CSP on ${path}`).toBeTruthy();

      expect(reportOnly).toContain("script-src 'self' 'nonce-");
      expect(reportOnly).toContain("'strict-dynamic'");
      expect(reportOnly).toContain("style-src-attr 'unsafe-inline'");
      expect(reportOnly).toContain("connect-src");
      expect(reportOnly).toContain("https://*.twilio.com");
      expect(reportOnly).toContain("wss://*.twilio.com");
      expect(reportOnly).toContain("https://drive.google.com");
      expect(reportOnly).toContain("https://maps.googleapis.com");
    });
  }

  test("unauthenticated / redirects to /login, carries the safe headers, but has no Report-Only CSP (no page body to protect)", async ({
    request,
  }) => {
    const res = await request.get("/", { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers()["location"]).toBe("/login");
    expect(res.headers()["x-frame-options"]).toBe("DENY");
    expect(res.headers()["content-security-policy"]).toBe(ENFORCING_CSP);
    expect(res.headers()["content-security-policy-report-only"]).toBeUndefined();
    expect(res.headers()["x-nonce"]).toBeUndefined();
  });

  test("an API route gets the safe headers but no Report-Only CSP or nonce (proxy doesn't run on /api/*)", async ({
    request,
  }) => {
    const res = await request.get("/api/version");
    const headers = res.headers();
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["content-security-policy"]).toBe(ENFORCING_CSP);
    expect(headers["content-security-policy-report-only"]).toBeUndefined();
    expect(headers["x-nonce"]).toBeUndefined();
  });
});

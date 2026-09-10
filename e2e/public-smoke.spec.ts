import { test, expect, collectCspViolations, unexpectedConsoleErrors } from "./fixtures";

/**
 * Browser-based checks on every page reachable WITHOUT logging in.
 * Read-only by construction: each test only calls page.goto() and reads
 * back state. None of them fill in or submit a form (register/forgot-
 * password/login all have real side effects on submit -- sending mail,
 * creating accounts, issuing reset tokens -- so this suite only ever
 * loads them, never submits them, even against a local build).
 *
 * ── Why this file splits "domain" violations from "script-src-elem" ──
 *
 * This file originally assumed only the two statically-prerendered
 * pages (/login, /forgot-password) would show a nonce gap, per
 * docs/DECISIONS.md #011 -- verified against a *local* `next start`,
 * where that was true. Running this exact suite against real
 * production (crm.aibuildpros.com) after deploying disproved that:
 * ALL public routes, static and dynamic alike, render with zero
 * `<script>` tags carrying a nonce in production, not just the two
 * documented ones. Confirmed directly (not assumed) by fetching the
 * real HTML: `/login`, `/forgot-password`, `/register`, `/welcome`,
 * `/get-started` all show 0-of-10-or-11 script tags nonce'd.
 *
 * Root cause: NOT the bundler -- tested directly, not assumed. A
 * suspected match (vercel/next.js#96063, "Turbopack + output:
 * 'standalone'") was disproven: both Turbopack and webpack builds
 * correctly nonce every script tag in a local reproduction of Vercel's
 * standalone packaging, and both FAIL identically (0 nonce'd tags) on
 * real Vercel deployments -- production (Turbopack) and a one-line
 * experimental Preview (webpack) alike. Full evidence table:
 * docs/DECISIONS.md #013. The leading (not confirmed) explanation is
 * that Vercel's actual Proxy-then-render execution topology doesn't
 * carry the request-header mutation this app's nonce mechanism depends
 * on across that boundary -- Next's own proxy.ts docs describe Proxy as
 * "invoked separately of your render code," which a local single-
 * process run never exercises regardless of bundler.
 *
 * Consequence, stated plainly: flipping the CSP from Report-Only to a
 * real, enforcing policy TODAY would break script execution and
 * therefore hydration on every page in production -- not a narrow,
 * two-page gap. Recommendation (docs/DECISIONS.md #013): stay
 * Report-Only. Don't add 'unsafe-inline' -- that would mean the nonce
 * mechanism protects nothing, the opposite of the goal. The bundler
 * swap is ruled out. The one remaining real alternative (Next's
 * experimental Subresource-Integrity/hash-based CSP mode) isn't worth
 * chasing right now -- it's unstable, and confirming it works on
 * Vercel's real topology would mean repeating this whole investigation
 * cycle for a feature explicitly flagged as "may change or be removed."
 *
 * What this file actually asserts, given that reality:
 *  - Zero violations for every directive EXCEPT script-src-elem --
 *    connect-src/img-src/font-src etc. are unaffected by the nonce gap
 *    and remain the genuinely meaningful compatibility signal for this
 *    app's specific external domains (Supabase/Twilio/Drive/Maps).
 *  - script-src-elem violation counts are reported, not hard-asserted
 *    either way -- a local run legitimately shows 0 (no bundler
 *    reproduces the gap outside Vercel's own deployment topology),
 *    while a production/preview run legitimately shows violations
 *    everywhere. Hard-coding either expectation would make this suite
 *    lie about whichever target it isn't currently pointed at.
 */

const ALL_PUBLIC_PAGES = ["/login", "/forgot-password", "/register", "/welcome", "/get-started"];

for (const path of ALL_PUBLIC_PAGES) {
  test(`${path} loads with no console errors and no non-script-src CSP violations`, async ({
    page,
    consoleEntries,
  }) => {
    const response = await page.goto(path, { waitUntil: "networkidle" });
    expect(response?.ok(), `${path} responded ok`).toBeTruthy();

    const badConsole = unexpectedConsoleErrors(consoleEntries);
    expect(badConsole, `console errors on ${path}: ${JSON.stringify(badConsole)}`).toEqual([]);

    const violations = await collectCspViolations(page);
    const nonScriptViolations = violations.filter((v) => v.violatedDirective !== "script-src-elem");
    expect(
      nonScriptViolations,
      `non-script-src CSP violations on ${path} -- these indicate a real domain/compatibility ` +
        `problem (Supabase/Twilio/Drive/Maps allowlist), unlike script-src-elem (see file header)`
    ).toEqual([]);

    const scriptViolations = violations.filter((v) => v.violatedDirective === "script-src-elem");
    console.log(
      `[nonce-gap report] ${path}: ${scriptViolations.length} script-src-elem Report-Only violation(s) -- ` +
        "see file header / docs/DECISIONS.md #013 for why this varies by deployment target"
    );

    await expect(page).toHaveTitle(/.+/);
  });
}

test("unauthenticated visit to / redirects to /login and renders it cleanly", async ({
  page,
  consoleEntries,
}) => {
  const response = await page.goto("/", { waitUntil: "networkidle" });
  expect(response?.ok()).toBeTruthy();
  expect(page.url()).toMatch(/\/login$/);

  const badConsole = unexpectedConsoleErrors(consoleEntries);
  expect(badConsole, `console errors after redirect: ${JSON.stringify(badConsole)}`).toEqual([]);
});

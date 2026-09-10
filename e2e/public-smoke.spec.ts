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
 * Root cause, tracked upstream, not a bug in this app's own code:
 * vercel/next.js#96063 -- "Nonce-based CSP: no script gets a nonce on
 * Turbopack + output:'standalone'". This repo builds with Turbopack
 * (the default builder since well before this app upgraded to it --
 * confirmed separately, not new), and Vercel's own production build
 * pipeline packages Next apps as `output: 'standalone'` regardless of
 * this repo's own next.config.ts. The issue was closed upstream as
 * "not planned." A local `next start` doesn't go through that same
 * standalone packaging step, which is why local testing didn't catch
 * this -- the discrepancy is the deployment target, not this app.
 *
 * Consequence, stated plainly: flipping the CSP from Report-Only to a
 * real, enforcing policy TODAY would break script execution and
 * therefore hydration on every page in production -- not a narrow,
 * two-page gap. This is exactly why the CSP stays Report-Only until
 * this upstream issue is resolved or the team makes a deliberate
 * decision about it (switch off Turbopack for the production build if
 * webpack isn't affected, accept 'unsafe-inline' as a fallback and
 * knowingly weaken script-src, or wait for an upstream fix). See
 * docs/DECISIONS.md #011 for the full record of this correction.
 *
 * What this file actually asserts, given that reality:
 *  - Zero violations for every directive EXCEPT script-src-elem --
 *    connect-src/img-src/font-src etc. are unaffected by the Turbopack
 *    bug and remain the genuinely meaningful compatibility signal for
 *    this app's specific external domains (Supabase/Twilio/Drive/Maps).
 *  - script-src-elem violation counts are reported, not hard-asserted
 *    either way -- a local run legitimately shows 0 on dynamic pages
 *    (this bug is Vercel-standalone-specific), while a production run
 *    legitimately shows violations everywhere. Hard-coding either
 *    expectation would make this suite lie about whichever target it
 *    isn't currently pointed at.
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
        "see file header for why this varies by deployment target (vercel/next.js#96063)"
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

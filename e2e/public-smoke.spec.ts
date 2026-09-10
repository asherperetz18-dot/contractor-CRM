import { test, expect, collectCspViolations, unexpectedConsoleErrors } from "./fixtures";

/**
 * Browser-based checks on every page reachable WITHOUT logging in.
 * Read-only by construction: each test only calls page.goto() and reads
 * back state. None of them fill in or submit a form (register/forgot-
 * password/login all have real side effects on submit -- sending mail,
 * creating accounts, issuing reset tokens -- so this suite only ever
 * loads them, never submits them, even against a local build).
 *
 * /login and /forgot-password are statically prerendered
 * (docs/DECISIONS.md #011), so Next can't stamp a per-request nonce
 * into their inline framework scripts. That's a known, already-
 * documented gap, not a bug this suite should treat as a failure --
 * DYNAMIC_PAGES_EXPECT_NO_VIOLATIONS below encodes exactly that
 * distinction rather than asserting "zero violations everywhere" and
 * quietly passing for the wrong reason (or failing on a known issue).
 */

const DYNAMIC_PUBLIC_PAGES = ["/register", "/welcome", "/get-started"];
const STATIC_PUBLIC_PAGES_WITH_KNOWN_NONCE_GAP = ["/login", "/forgot-password"];

for (const path of DYNAMIC_PUBLIC_PAGES) {
  test(`${path} loads clean: no console errors, no CSP violations`, async ({
    page,
    consoleEntries,
  }) => {
    const response = await page.goto(path, { waitUntil: "networkidle" });
    expect(response?.ok(), `${path} responded ok`).toBeTruthy();

    const violations = await collectCspViolations(page);
    expect(violations, `CSP violations on ${path}`).toEqual([]);

    const badConsole = unexpectedConsoleErrors(consoleEntries);
    expect(badConsole, `console errors on ${path}: ${JSON.stringify(badConsole)}`).toEqual([]);

    await expect(page).toHaveTitle(/.+/);
  });
}

for (const path of STATIC_PUBLIC_PAGES_WITH_KNOWN_NONCE_GAP) {
  test(`${path} loads with no console errors (CSP script-src Report-Only violation is a known, documented gap here)`, async ({
    page,
    consoleEntries,
  }) => {
    const response = await page.goto(path, { waitUntil: "networkidle" });
    expect(response?.ok(), `${path} responded ok`).toBeTruthy();

    const badConsole = unexpectedConsoleErrors(consoleEntries);
    expect(badConsole, `console errors on ${path}: ${JSON.stringify(badConsole)}`).toEqual([]);

    const violations = await collectCspViolations(page);
    const scriptViolations = violations.filter((v) => v.violatedDirective === "script-src-elem");
    const nonScriptViolations = violations.filter((v) => v.violatedDirective !== "script-src-elem");
    expect(
      nonScriptViolations,
      `non-script-src CSP violations on ${path} (unexpected -- only the documented script-src nonce gap is expected here)`
    ).toEqual([]);

    // Asserted as a *positive* count, not just logged: this is the one
    // place this suite expects violations, and a silent drop to zero
    // is exactly the failure mode that let a real fixture bug (the
    // listener never actually being installed) go unnoticed earlier --
    // see the comment in fixtures.ts. If this ever legitimately hits 0
    // because the page was forced dynamic (docs/DECISIONS.md #011),
    // that's good news: move this path to DYNAMIC_PUBLIC_PAGES above
    // instead of loosening this assertion.
    expect(
      scriptViolations.length,
      `expected at least one script-src-elem Report-Only violation on ${path} (the known static-page nonce gap) -- ` +
        `zero here likely means the violation listener silently isn't attached, not that the gap is fixed`
    ).toBeGreaterThan(0);

    // Documents current reality rather than asserting it blindly: log
    // what's actually there so a future run (once this page is forced
    // dynamic, per the DECISIONS #011 checklist) makes the gap visible
    // by simply having nothing left to log, not by a red test.
    console.log(`[known-gap-check] ${path}: ${violations.length} script-src Report-Only violation(s)`);

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

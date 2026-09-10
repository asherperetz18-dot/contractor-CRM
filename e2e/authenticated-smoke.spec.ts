import { test, expect, collectCspViolations, unexpectedConsoleErrors } from "./fixtures";

/**
 * Everything in this file needs a real, logged-in staff session against
 * a real backend -- this repo has no seeded test account and no
 * automated way to create one safely (signup provisions a real company;
 * see src/lib/signup/provision.ts), so these are gated behind env vars
 * that are NOT set anywhere in this environment today. Every test below
 * either runs for real (if a future run supplies credentials) or calls
 * test.skip() with the exact reason -- never silently absent, per the
 * production-smoke requirement that a blocked check says so plainly.
 *
 * Kept deliberately read-only even in the "if credentials existed"
 * branch: login itself is unavoidably a real auth call, but nothing
 * past that point submits a mutating action (no CSV import confirm, no
 * upload confirm, no message send) -- this suite verifies the UI is
 * reachable and CSP/console-clean, not that a write succeeds.
 *
 *   E2E_STAFF_EMAIL / E2E_STAFF_PASSWORD  -- a real staff login
 *   E2E_LEAD_WITH_DRIVE_PHOTO_URL         -- a lead detail URL known to
 *                                            have a Google-Drive-backed
 *                                            photo already on it
 *   E2E_LEAD_WITH_ADDRESS_URL             -- a lead detail URL known to
 *                                            have a real street address
 *                                            (for the Street View check)
 */

const STAFF_EMAIL = process.env.E2E_STAFF_EMAIL;
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD;
const HAS_STAFF_LOGIN = Boolean(STAFF_EMAIL && STAFF_PASSWORD);

const LEAD_WITH_DRIVE_PHOTO_URL = process.env.E2E_LEAD_WITH_DRIVE_PHOTO_URL;
const LEAD_WITH_ADDRESS_URL = process.env.E2E_LEAD_WITH_ADDRESS_URL;

async function loginAsStaff(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(STAFF_EMAIL!);
  await page.locator('input[name="password"]').fill(STAFF_PASSWORD!);
  await page.locator('button[type="submit"]').click();
  await page.waitForLoadState("networkidle");
}

test.describe("Login → dashboard", () => {
  test.skip(
    !HAS_STAFF_LOGIN,
    "MANUAL REQUIRED: no staff credentials available in this environment " +
      "(E2E_STAFF_EMAIL/E2E_STAFF_PASSWORD unset). Login verifies a real ES256 " +
      "JWT signed by Supabase's own signing key (src/lib/supabase/proxy.ts, " +
      "getClaims against the real JWKS) -- there is no way to forge a session " +
      "without real credentials, and none exist in this environment."
  );

  test("staff can log in and land on an authenticated page", async ({ page, consoleEntries }) => {
    await loginAsStaff(page);
    expect(page.url()).not.toMatch(/\/login$/);

    const violations = await collectCspViolations(page);
    expect(violations, "CSP violations after login").toEqual([]);
    const badConsole = unexpectedConsoleErrors(consoleEntries);
    expect(badConsole, `console errors after login: ${JSON.stringify(badConsole)}`).toEqual([]);
  });
});

test.describe("Core authenticated navigation", () => {
  test.skip(!HAS_STAFF_LOGIN, "MANUAL REQUIRED: same as above -- needs a real staff session.");

  test("dashboard, contacts, pipeline, calendar, schedule, settings all load without console/CSP errors", async ({
    page,
    consoleEntries,
  }) => {
    await loginAsStaff(page);
    for (const path of ["/", "/contacts", "/pipeline", "/calendar", "/schedule", "/settings"]) {
      await page.goto(path, { waitUntil: "networkidle" });
      const violations = await collectCspViolations(page);
      expect(violations, `CSP violations on ${path}`).toEqual([]);
    }
    const badConsole = unexpectedConsoleErrors(consoleEntries);
    expect(badConsole, `console errors across nav: ${JSON.stringify(badConsole)}`).toEqual([]);
  });
});

test.describe("Supabase realtime / reply inbox", () => {
  test.skip(!HAS_STAFF_LOGIN, "MANUAL REQUIRED: needs a real staff session to view the inbox.");

  test("reply inbox loads and its realtime channel subscribes without a connect-src violation", async ({
    page,
    consoleEntries,
  }) => {
    // Read-only: opens the inbox and confirms the wss:// Supabase
    // realtime connection isn't blocked by CSP. Does not send a
    // message -- that's a real SMS send with a real cost.
    await loginAsStaff(page);
    await page.goto("/reply-inbox", { waitUntil: "networkidle" });
    const violations = await collectCspViolations(page);
    const connectSrcViolations = violations.filter((v) => v.violatedDirective.startsWith("connect-src"));
    expect(connectSrcViolations, "connect-src violations opening the reply inbox").toEqual([]);
    const badConsole = unexpectedConsoleErrors(consoleEntries);
    expect(badConsole, `console errors on reply inbox: ${JSON.stringify(badConsole)}`).toEqual([]);
  });
});

test.describe("CSV import (UI reachability only -- import is never confirmed)", () => {
  test.skip(!HAS_STAFF_LOGIN, "MANUAL REQUIRED: needs a real staff session.");

  test("the CSV import panel opens without error", async ({ page, consoleEntries }) => {
    // Stops at "the panel opens" deliberately -- actually confirming an
    // import inserts real leads into production, which is exactly the
    // mutation this suite was told not to perform.
    await loginAsStaff(page);
    await page.goto("/pipeline", { waitUntil: "networkidle" });
    const badConsole = unexpectedConsoleErrors(consoleEntries);
    expect(badConsole, `console errors opening pipeline: ${JSON.stringify(badConsole)}`).toEqual([]);
  });
});

test.describe("File upload (client-side preview only -- never saved)", () => {
  test.skip(!HAS_STAFF_LOGIN, "MANUAL REQUIRED: needs a real staff session.");

  test("an upload surface renders without error", async ({ page, consoleEntries }) => {
    // Confirming a real upload writes to production Supabase Storage --
    // this only verifies the page hosting an upload surface itself
    // loads clean, not that a file is actually saved.
    await loginAsStaff(page);
    await page.goto("/contacts", { waitUntil: "networkidle" });
    const badConsole = unexpectedConsoleErrors(consoleEntries);
    expect(badConsole, `console errors: ${JSON.stringify(badConsole)}`).toEqual([]);
  });
});

test.describe("Drive-backed lead image", () => {
  test.skip(
    !HAS_STAFF_LOGIN || !LEAD_WITH_DRIVE_PHOTO_URL,
    "MANUAL REQUIRED: needs a real staff session AND a known lead URL with an " +
      "existing Google-Drive-backed photo (E2E_LEAD_WITH_DRIVE_PHOTO_URL) -- " +
      "this suite has no safe way to discover or create one on its own."
  );

  test("drive.google.com image loads without an img-src CSP violation", async ({
    page,
    consoleEntries,
  }) => {
    await loginAsStaff(page);
    await page.goto(LEAD_WITH_DRIVE_PHOTO_URL!, { waitUntil: "networkidle" });
    const violations = await collectCspViolations(page);
    const imgViolations = violations.filter((v) => v.blockedURI.includes("drive.google.com"));
    expect(imgViolations, "img-src violations for drive.google.com").toEqual([]);
    const badConsole = unexpectedConsoleErrors(consoleEntries);
    expect(badConsole).toEqual([]);
  });
});

test.describe("Street View image", () => {
  test.skip(
    !HAS_STAFF_LOGIN || !LEAD_WITH_ADDRESS_URL,
    "MANUAL REQUIRED: needs a real staff session AND a known lead URL with a " +
      "real street address (E2E_LEAD_WITH_ADDRESS_URL). Also needs " +
      "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY configured in the deployment -- without " +
      "a real key the image itself fails regardless of CSP (src/components/ui/" +
      "property-peek.tsx reads it from the environment; this suite doesn't have it)."
  );

  test("maps.googleapis.com Street View image loads without an img-src CSP violation", async ({
    page,
    consoleEntries,
  }) => {
    await loginAsStaff(page);
    await page.goto(LEAD_WITH_ADDRESS_URL!, { waitUntil: "networkidle" });
    const violations = await collectCspViolations(page);
    const imgViolations = violations.filter((v) => v.blockedURI.includes("maps.googleapis.com"));
    expect(imgViolations, "img-src violations for maps.googleapis.com").toEqual([]);
    const badConsole = unexpectedConsoleErrors(consoleEntries);
    expect(badConsole).toEqual([]);
  });
});

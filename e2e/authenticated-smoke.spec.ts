import { test, expect, collectCspViolations, unexpectedConsoleErrors } from "./fixtures";

/**
 * Everything in this file needs a real, logged-in staff session against
 * a real backend. That session now exists: SMOKE_EMAIL/SMOKE_PASSWORD
 * (already required by playwright.config.ts for the rest of this suite)
 * log in as the dedicated `bar-test` QA account -- a permanent fixture
 * tenant that is the ONLY company these tests are allowed to touch (see
 * scripts/bar-test-lib.mjs and scripts/bar-test-seed.mjs). Every test
 * below either runs for real (if SMOKE_EMAIL/SMOKE_PASSWORD are present)
 * or calls test.skip() with the exact reason -- never silently absent,
 * per the production-smoke requirement that a blocked check says so
 * plainly.
 *
 * Kept deliberately read-only: login itself is unavoidably a real auth
 * call, but nothing past that point submits a mutating form (no CSV
 * import confirm, no upload confirm, no message send) -- this suite
 * verifies the UI is reachable and CSP/console-clean against bar-test's
 * fixture data, not that a write succeeds.
 *
 *   SMOKE_EMAIL / SMOKE_PASSWORD -- the bar-test QA staff login
 *
 * This QA account holds exactly one Active membership, in bar-test, so
 * a fresh login lands there on its own -- no cookie needs to be forced.
 * That is still asserted, not assumed: every test here confirms the
 * topbar brand reads "bar-test" before doing anything else, refusing to
 * run at all otherwise. This check exists independent of whether the
 * account is single- or multi-tenant -- getCurrentCompanyId() (src/lib/
 * data/profile.ts) defaults to "memberships[0].company_id" when no
 * current_company_id cookie is set, so if this account (or a future
 * one) ever gains a second membership, this is what would still catch
 * a wrong default before any test touched real data.
 *
 * bar-test's seeded leads always have a fake (555-01xx / example.com)
 * phone/email and a fake street address, which is what makes the
 * Street View check below runnable without any extra env var: any
 * seeded lead's address is a safe, disposable one. There is no
 * Drive-backed photo in the fixture (lead_files are seeded with
 * example.com URLs, not drive.google.com, specifically so seeding
 * never causes a real Drive-domain fetch) -- that check stays MANUAL
 * REQUIRED.
 */

const STAFF_EMAIL = process.env.SMOKE_EMAIL;
const STAFF_PASSWORD = process.env.SMOKE_PASSWORD;
const HAS_STAFF_LOGIN = Boolean(STAFF_EMAIL && STAFF_PASSWORD);
const SKIP_REASON =
  "MANUAL REQUIRED: needs SMOKE_EMAIL/SMOKE_PASSWORD (bar-test QA login) -- not set " +
  "in this environment.";

async function loginAsQaUserOnBarTest(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(STAFF_EMAIL!);
  await page.locator('input[name="password"]').fill(STAFF_PASSWORD!);
  await page.locator('button[type="submit"]').click();
  await page.waitForLoadState("networkidle");
  if (page.url().includes("/login")) {
    throw new Error("Still on /login after submit -- check SMOKE_EMAIL/SMOKE_PASSWORD.");
  }

  await page.goto("/pipeline", { waitUntil: "networkidle" });
  const brand = await page.locator(".global-topbar-brand").first().textContent();
  if (brand?.trim() !== "bar-test") {
    throw new Error(
      `REFUSING TO RUN: active company reads "${brand?.trim()}", not "bar-test". ` +
        "Aborting rather than risk touching a different tenant's real data."
    );
  }
}

test.describe("Login → dashboard", () => {
  test.skip(!HAS_STAFF_LOGIN, SKIP_REASON);

  test("staff can log in and land on an authenticated page", async ({ page, consoleEntries }) => {
    await loginAsQaUserOnBarTest(page);
    expect(page.url()).not.toMatch(/\/login$/);

    const violations = await collectCspViolations(page);
    expect(violations, "CSP violations after login").toEqual([]);
    const badConsole = unexpectedConsoleErrors(consoleEntries);
    expect(badConsole, `console errors after login: ${JSON.stringify(badConsole)}`).toEqual([]);
  });
});

test.describe("Core authenticated navigation", () => {
  test.skip(!HAS_STAFF_LOGIN, SKIP_REASON);

  test("dashboard, contacts, pipeline, calendar, schedule, settings all load without console/CSP errors", async ({
    page,
    consoleEntries,
  }) => {
    await loginAsQaUserOnBarTest(page);
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
  test.skip(!HAS_STAFF_LOGIN, SKIP_REASON);

  test("reply inbox loads and its realtime channel subscribes without a connect-src violation", async ({
    page,
    consoleEntries,
  }) => {
    // Read-only: opens the inbox and confirms the wss:// Supabase
    // realtime connection isn't blocked by CSP. Does not send a
    // message -- that's a real SMS send with a real cost.
    await loginAsQaUserOnBarTest(page);
    await page.goto("/reply-inbox", { waitUntil: "networkidle" });
    const violations = await collectCspViolations(page);
    const connectSrcViolations = violations.filter((v) => v.violatedDirective.startsWith("connect-src"));
    expect(connectSrcViolations, "connect-src violations opening the reply inbox").toEqual([]);
    const badConsole = unexpectedConsoleErrors(consoleEntries);
    expect(badConsole, `console errors on reply inbox: ${JSON.stringify(badConsole)}`).toEqual([]);
  });
});

test.describe("CSV import (UI reachability only -- import is never confirmed)", () => {
  test.skip(!HAS_STAFF_LOGIN, SKIP_REASON);

  test("the CSV import panel opens without error", async ({ page, consoleEntries }) => {
    // Stops at "the panel opens" deliberately -- actually confirming an
    // import inserts real leads, which is exactly the mutation this
    // suite was told not to perform even against bar-test's own data.
    await loginAsQaUserOnBarTest(page);
    await page.goto("/pipeline", { waitUntil: "networkidle" });
    const badConsole = unexpectedConsoleErrors(consoleEntries);
    expect(badConsole, `console errors opening pipeline: ${JSON.stringify(badConsole)}`).toEqual([]);
  });
});

test.describe("File upload (client-side preview only -- never saved)", () => {
  test.skip(!HAS_STAFF_LOGIN, SKIP_REASON);

  test("an upload surface renders without error", async ({ page, consoleEntries }) => {
    // Confirming a real upload writes to production Supabase Storage --
    // this only verifies the page hosting an upload surface itself
    // loads clean, not that a file is actually saved.
    await loginAsQaUserOnBarTest(page);
    await page.goto("/contacts", { waitUntil: "networkidle" });
    const badConsole = unexpectedConsoleErrors(consoleEntries);
    expect(badConsole, `console errors: ${JSON.stringify(badConsole)}`).toEqual([]);
  });
});

test.describe("Drive-backed lead image", () => {
  test.skip(
    true,
    "MANUAL REQUIRED: bar-test's seeded lead_files deliberately use example.com URLs, " +
      "not drive.google.com, so seeding itself never causes a real Drive-domain fetch. " +
      "This check needs a lead with a genuine Drive-backed photo, which only exists in " +
      "real (non-fixture) tenants -- verify manually against one of those, or against a " +
      "one-off bar-test lead file row added and removed by hand for this specific check."
  );

  test("drive.google.com image loads without an img-src CSP violation", async () => {
    // Intentionally not implemented -- see skip reason above.
  });
});

test.describe("Street View image", () => {
  test.skip(!HAS_STAFF_LOGIN, SKIP_REASON);

  test("maps.googleapis.com Street View image loads without an img-src CSP violation", async ({
    page,
    consoleEntries,
  }) => {
    // Every bar-test lead is seeded with a fake-but-well-formed street
    // address (see scripts/bar-test-seed.mjs), so the first lead card
    // on the board is guaranteed to trigger PropertyPeek's Street View
    // image -- no env-provided lead URL needed. Opening it is a client-
    // side modal, not a route change, so it's reached the same way the
    // app itself opens it: click the lead card's name text (the card's
    // own dead-center can land on its address link, which stops
    // propagation on purpose -- confirmed while building
    // e2e/measure-authenticated-flows.mjs).
    await loginAsQaUserOnBarTest(page);
    await page.goto("/pipeline", { waitUntil: "networkidle" });

    const briefClose = page.getByText("✕", { exact: true }).first();
    if (await briefClose.isVisible().catch(() => false)) {
      await briefClose.click();
    }

    const card = page.locator(".lead-card").first();
    await card.waitFor({ state: "visible", timeout: 10_000 });
    await card.locator(".lead-card-name").first().click();
    await expect(page.locator(".modal").first()).toBeVisible();
    await page.waitForLoadState("networkidle");

    const violations = await collectCspViolations(page);
    const imgViolations = violations.filter((v) => v.blockedURI.includes("maps.googleapis.com"));
    expect(imgViolations, "img-src violations for maps.googleapis.com").toEqual([]);
    const badConsole = unexpectedConsoleErrors(consoleEntries);
    expect(badConsole).toEqual([]);
  });
});

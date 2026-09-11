// Authenticated dynamic network measurement across the app's main
// screens, using the bar-test QA account (SMOKE_EMAIL/SMOKE_PASSWORD)
// via real UI login -- not the Supabase JS client. Read-only navigation
// only: every flow below is a page.goto() or a single documented click
// into an already-open detail view, never a form submit that would
// create/send/charge anything real.
//
// Run: SMOKE_BASE_URL=https://crm.aibuildpros.com node e2e/measure-authenticated-flows.mjs
// (.env is picked up automatically if SMOKE_BASE_URL isn't already set
// in the shell -- see the loader at the top of playwright.config.ts,
// duplicated here in miniature since this runs outside the test runner.)

import { chromium } from "@playwright/test";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "../.env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    if (process.env[key] === undefined) process.env[key] = t.slice(eq + 1).trim();
  }
}

const BASE_URL = process.env.SMOKE_BASE_URL;
const EMAIL = process.env.SMOKE_EMAIL;
const PASSWORD = process.env.SMOKE_PASSWORD;
if (!BASE_URL || !EMAIL || !PASSWORD) {
  console.error("Missing SMOKE_BASE_URL/SMOKE_EMAIL/SMOKE_PASSWORD (checked shell env and .env).");
  process.exit(1);
}

// Supabase project host, derived from the request log itself rather
// than hard-coded -- classifyRequest() below fills this in once it's
// seen the first supabase.co request.
let supabaseHost = null;

function classify(url) {
  if (supabaseHost && url.includes(supabaseHost)) return "supabase";
  if (url.includes(".supabase.co")) return "supabase";
  if (url.includes("twilio.com")) return "twilio";
  if (url.includes("googleapis.com") || url.includes("drive.google.com")) return "google";
  if (url.includes("/_next/static/")) return "next-static";
  return "other";
}

async function measureFlow(page, name, navigate) {
  const requests = [];
  const responseTimes = new Map();
  const failed = [];
  const websockets = [];

  const onRequest = (req) => {
    // Next.js Server Actions all POST to the current page's own URL --
    // the "next-action" header (a per-action id) is what actually tells
    // two such requests apart, not the URL. Without this, five different
    // background actions (notification poll, device registration, etc.)
    // that all happen to target the same page path get misread as one
    // action "duplicated" 5x.
    const nextAction = req.headers()["next-action"];
    requests.push({
      url: req.url(),
      method: req.method(),
      resourceType: req.resourceType(),
      nextAction: nextAction ?? null,
      startedAt: Date.now(),
    });
    responseTimes.set(req.url() + "|" + req.method(), Date.now());
  };
  const onResponse = (res) => {
    const key = res.url() + "|" + res.request().method();
    const started = responseTimes.get(key);
    const entry = requests.find((r) => r.url === res.url() && r.method === res.request().method() && r.durationMs === undefined);
    if (entry) entry.durationMs = started ? Date.now() - started : undefined;
    if (entry) entry.status = res.status();
  };
  const onFailed = (req) => failed.push({ url: req.url(), failure: req.failure()?.errorText });
  const onWs = (ws) => {
    const rec = { url: ws.url(), openedAt: Date.now(), closedAt: null };
    websockets.push(rec);
    ws.on("close", () => (rec.closedAt = Date.now()));
  };

  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("requestfailed", onFailed);
  page.on("websocket", onWs);

  const t0 = Date.now();
  await navigate();
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  const initialLoadMs = Date.now() - t0;
  const initialRequestCount = requests.length;

  // Settle window: anything that fires AFTER networkidle is a rerender/
  // effect/poll firing on its own, not part of the initial page load.
  const settleStart = requests.length;
  await page.waitForTimeout(6000);
  const settleRequests = requests.slice(settleStart);

  page.off("request", onRequest);
  page.off("response", onResponse);
  page.off("requestfailed", onFailed);
  page.off("websocket", onWs);

  // Learn the supabase host from whatever we just saw, for later flows.
  const supabaseReq = requests.find((r) => r.url.includes(".supabase.co"));
  if (supabaseReq && !supabaseHost) {
    supabaseHost = new URL(supabaseReq.url).host;
  }

  const byType = {};
  for (const r of requests) byType[r.resourceType] = (byType[r.resourceType] ?? 0) + 1;

  const urlCounts = new Map();
  for (const r of requests) {
    // Distinct Server Actions (distinct next-action header) POSTing to
    // the same page URL are NOT duplicates of each other -- key on both.
    const key = r.nextAction
      ? `${r.method} ${r.url.split("?")[0]} [action:${r.nextAction}]`
      : `${r.method} ${r.url.split("?")[0]}`;
    urlCounts.set(key, (urlCounts.get(key) ?? 0) + 1);
  }
  const duplicates = [...urlCounts.entries()].filter(([, n]) => n > 1);

  const supabaseCalls = requests.filter((r) => classify(r.url) === "supabase");
  const thirdParty = requests.filter((r) => ["twilio", "google"].includes(classify(r.url)));
  const slow = requests.filter((r) => (r.durationMs ?? 0) > 800);

  return {
    name,
    initialLoadMs,
    totalRequests: initialRequestCount,
    byResourceType: byType,
    supabaseRequestCount: supabaseCalls.length,
    supabaseUrls: supabaseCalls.map((r) => r.url.replace(/^https?:\/\/[^/]+/, "")),
    duplicateRequestGroups: duplicates.map(([k, n]) => `${n}x ${k}`),
    thirdPartyRequests: thirdParty.map((r) => r.url),
    failedRequests: failed,
    slowRequests: slow.map((r) => `${r.durationMs}ms ${r.method} ${r.url.replace(/^https?:\/\/[^/]+/, "")}`),
    websocketsOpened: websockets.length,
    websocketsClosedBeforeExit: websockets.filter((w) => w.closedAt).length,
    postLoadRequestsIn6s: settleRequests.length,
    postLoadRequestUrls: settleRequests.map((r) => `${r.method} ${r.url.replace(/^https?:\/\/[^/]+/, "")}`),
  };
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();

  console.log(`Logging in as the QA account against ${BASE_URL} ...`);
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForLoadState("networkidle");
  if (page.url().includes("/login")) {
    throw new Error("Still on /login after submit -- check SMOKE_EMAIL/SMOKE_PASSWORD are correct.");
  }
  console.log(`Logged in. Landed on ${page.url()}`);

  // The QA account holds exactly one Active membership, in bar-test, so
  // a fresh login lands there with no cookie-forcing needed -- but this
  // is still asserted, not assumed. getCurrentCompanyId() (src/lib/data/
  // profile.ts) defaults to "memberships[0].company_id" when no
  // current_company_id cookie is set; if this account (or a future one)
  // ever gains a second membership, the default membership could stop
  // being bar-test with no other signal that anything changed. This
  // check is the hard backstop that catches that, every run, before any
  // flow below touches anything.
  await page.goto("/pipeline");
  await page.waitForLoadState("networkidle");
  const brand = await page.locator(".global-topbar-brand").first().textContent().catch(() => null);
  console.log(`Active company: "${brand?.trim()}" (expected: bar-test)`);
  if (brand?.trim() !== "bar-test") {
    throw new Error(
      `REFUSING TO MEASURE: active company reads "${brand?.trim()}", not "bar-test". ` +
        "Aborting rather than risk measuring or clicking into a different tenant's real data."
    );
  }
  console.log("");

  const results = [];

  results.push(await measureFlow(page, "Dashboard", () => page.goto("/")));
  results.push(await measureFlow(page, "Pipeline", () => page.goto("/pipeline")));
  results.push(await measureFlow(page, "Contacts", () => page.goto("/contacts")));
  results.push(await measureFlow(page, "Schedule", () => page.goto("/schedule")));
  results.push(await measureFlow(page, "Calendar", () => page.goto("/calendar")));
  results.push(await measureFlow(page, "Production", () => page.goto("/production")));
  results.push(await measureFlow(page, "Reply Inbox", () => page.goto("/reply-inbox")));
  results.push(await measureFlow(page, "Marketing Analytics", () => page.goto("/marketing-analytics")));
  results.push(await measureFlow(page, "Profit & Loss", () => page.goto("/profit-loss")));

  // Lead detail: open Pipeline, then click the first lead card. This is
  // a read-only UI interaction -- opening a detail panel, never a save.
  await page.goto("/pipeline");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);

  // A "Daily Brief" summary modal auto-opens once per session on
  // Pipeline/Dashboard. Its full-page backdrop sits on top of the board,
  // so it must be dismissed before any card click can reach the board at
  // all (confirmed via scripts/tmp-check-lead-modal.mjs: with the brief
  // left open, a click just closes the brief's own backdrop instead of
  // opening the lead).
  const briefClose = page.getByText("✕", { exact: true }).first();
  if (await briefClose.isVisible().catch(() => false)) {
    await briefClose.click();
    await page.waitForTimeout(500);
  }

  const leadDetailResult = await measureFlow(page, "Lead Detail (opened from Pipeline)", async () => {
    const card = page.locator(".lead-card").first();
    await card.waitFor({ state: "visible", timeout: 10000 });
    await card.scrollIntoViewIfNeeded();
    // The card's own dead-center can land on its embedded address link,
    // which has its own onClick={e => e.stopPropagation()} (so tapping
    // the address opens Google Maps instead of the lead) -- confirmed
    // via scripts/tmp-check-lead-modal.mjs that a plain center-click on
    // .lead-card silently does nothing for exactly this reason. Clicking
    // the name text specifically avoids that dead zone.
    await card.locator(".lead-card-name").first().click({ timeout: 5000 });
    // Give the modal a moment to actually mount before we start counting
    // networkidle from a stable base.
    await page.waitForTimeout(500);
  });
  results.push(leadDetailResult);

  // Guard against silently measuring nothing: confirm the lead detail
  // modal actually opened before trusting the numbers above (this is
  // exactly how the earlier "Lead Detail: 0 requests" run went unnoticed).
  const leadModalOpen = await page.locator(".modal").first().isVisible().catch(() => false);
  if (!leadModalOpen) {
    throw new Error(
      "REFUSING TO TRUST Lead Detail measurement: no .modal is visible after clicking the lead card. " +
        "The click did not open the lead detail panel."
    );
  }
  console.log("Confirmed: lead detail modal is open -- measurement above reflects a real click-through.\n");

  await browser.close();

  console.log("\n=== SUMMARY ===");
  for (const r of results) {
    console.log(
      `\n${r.name}: ${r.totalRequests} requests (${r.initialLoadMs}ms to networkidle), ` +
        `${r.supabaseRequestCount} supabase, ${r.duplicateRequestGroups.length} duplicate group(s), ` +
        `${r.postLoadRequestsIn6s} request(s) in the 6s after load, ` +
        `${r.websocketsOpened} websocket(s) opened, ${r.thirdPartyRequests.length} third-party, ` +
        `${r.slowRequests.length} slow (>800ms), ${r.failedRequests.length} failed`
    );
    if (r.duplicateRequestGroups.length) console.log(`  duplicates: ${r.duplicateRequestGroups.join(", ")}`);
    if (r.postLoadRequestsIn6s) console.log(`  post-load: ${r.postLoadRequestUrls.slice(0, 5).join(", ")}`);
    if (r.thirdPartyRequests.length) console.log(`  third-party: ${r.thirdPartyRequests.join(", ")}`);
    if (r.slowRequests.length) console.log(`  slow: ${r.slowRequests.join(", ")}`);
    if (r.failedRequests.length) console.log(`  FAILED: ${JSON.stringify(r.failedRequests)}`);
  }

  const outPath = path.resolve(__dirname, "measurement-results.json");
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nFull detail written to ${outPath}`);
}

main().catch((err) => {
  console.error("MEASUREMENT FAILED:", err.message);
  process.exit(1);
});

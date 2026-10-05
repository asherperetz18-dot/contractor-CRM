import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

/**
 * A locked company is paused (DECISIONS #131): no texts, no calls, no
 * AI. These tests read the code itself, so a new feature can't quietly
 * go around the check -- the way every one did before it existed.
 */

const SRC = new URL("../../", import.meta.url);
const files = (readdirSync(SRC, { recursive: true }) as string[])
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((f) => ({ path: f, text: readFileSync(new URL(f, SRC), "utf8") }));

test("the AI is reached through one door, which a locked company can't open", () => {
  const constructing = files.filter((f) => /new Anthropic\(/.test(f.text)).map((f) => f.path);
  assert.deepEqual(constructing, ["lib/ai/company-ai.ts"]);
  const door = files.find((f) => f.path === "lib/ai/company-ai.ts")!.text;
  const fn = door.slice(door.indexOf("export async function aiForCompany"));
  assert.ok(fn.indexOf("isCompanyLocked(") > 0 && fn.indexOf("isCompanyLocked(") < fn.indexOf("new Anthropic("));
});

test("every text is sent with the lock-aware Twilio getter", () => {
  const senders = files.filter(
    (f) => f.path !== "lib/twilio-env.ts" && /sendTwilioSms\(|Messages\.json/.test(f.text)
  );
  assert.ok(senders.length >= 9, `found ${senders.length} senders`);
  for (const f of senders) {
    assert.match(f.text, /getTwilioForSending\(/, f.path);
    // portal.ts also shows the company's number to a customer, which needs no lock.
    if (f.path !== "lib/actions/portal.ts") assert.doesNotMatch(f.text, /getTwilioForCompany\(/, f.path);
  }
  const sending = files.find((f) => f.path === "lib/twilio-company.ts")!.text;
  const fn = sending.slice(sending.indexOf("export async function getTwilioForSending"));
  assert.ok(fn.indexOf("isCompanyLocked(") < fn.indexOf("getTwilioForCompany("));
});

test("the screens' send, call and portal-link actions say why they refused", () => {
  const checks: [string, string][] = [
    ["lib/actions/sms.ts", "export async function sendSms"],
    ["lib/actions/estimates.ts", "export async function sendEstimateToCustomer"],
    ["lib/actions/portal.ts", "export async function sendPortalLink"],
    ["lib/actions/progress-billing.ts", "export async function requestProgressPayment"],
    ["lib/actions/voice.ts", "export async function getVoiceAccessToken"],
  ];
  for (const [path, start] of checks) {
    const text = files.find((f) => f.path === path)!.text;
    const body = text.slice(text.indexOf(start), text.indexOf(start) + 2500);
    assert.match(body, /lockedServicesError\(/, path);
  }
});

test("calls placed with a token issued before the lock are refused, and auto-replies stop", () => {
  const twiml = files.find((f) => f.path === "app/api/voice/twiml/route.ts")!.text;
  assert.ok(twiml.indexOf("isCompanyLocked(") > 0 && twiml.indexOf("isCompanyLocked(") < twiml.indexOf("<Dial"));
  const inbound = files.find((f) => f.path === "app/api/sms/webhook/route.ts")!.text;
  assert.match(inbound, /replyMessage && !\(await isCompanyLocked\(inboundCompanyId\)\)/);
  const engine = files.find((f) => f.path === "lib/ai-receptionist-engine.ts")!.text;
  const start = engine.slice(engine.indexOf("export async function maybeStartReceptionist"));
  assert.ok(start.indexOf("isCompanyLocked(") < start.indexOf("ai_receptionist_calls"));
});

test("a closed company is locked everywhere a lapsed one is (DECISIONS #135)", () => {
  const lock = files.find((f) => f.path === "lib/billing/company-lock.ts")!.text;
  const fn = lock.slice(lock.indexOf("export async function isCompanyLocked"));
  assert.match(fn.slice(0, 600), /getCompanyClosure\(companyId\)/);
  assert.match(fn.slice(0, 600), /\|\| closure !== null/);
  const layout = files.find((f) => f.path === "app/(app)/layout.tsx")!.text;
  assert.match(layout, /\(isBillingLocked\(billing\?\.status\) \|\| closure\) && !isPlatformAdmin\(profile\)\) redirect\("\/billing-locked"\)/);
  const runner = files.find((f) => f.path === "lib/cron/run-companies.ts")!.text;
  assert.match(runner, /closedCompanyIds\(\)/);
  const recheck = files.find((f) => f.path === "lib/actions/billing.ts")!.text;
  const rc = recheck.slice(recheck.indexOf("export async function recheckBilling"));
  assert.ok(rc.indexOf("readCompanyClosure(") < rc.indexOf("return { locked: false }"), "closed before the not-billed exit");
});

test("only a platform admin closes or reopens a company", () => {
  const action = files.find((f) => f.path === "lib/actions/company-closure.ts")!.text;
  for (const name of ["closeCompany", "reopenCompany"]) {
    const fn = action.slice(action.indexOf(`export async function ${name}`));
    const guard = fn.indexOf("requirePlatformAdmin()");
    const write = fn.search(/\.(upsert|delete)\(/);
    assert.ok(guard > 0 && guard < write, name);
  }
  assert.match(action, /if \(!isPlatformAdmin\(profile\)\)/);
});

test("the database lock counts closed companies and keeps the same lapsed statuses", () => {
  const dir = new URL("../../../supabase/migrations/", import.meta.url);
  const defining = (readdirSync(dir) as string[])
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort()
    .filter((f) => /create or replace function public\.billing_locked_company_ids/.test(readFileSync(new URL(f, dir), "utf8")));
  const latest = readFileSync(new URL(defining[defining.length - 1], dir), "utf8");
  assert.match(latest, /from public\.company_closures/);
  assert.match(latest, /billing_status in \('canceled', 'unpaid', 'incomplete_expired', 'paused'\)/);
  assert.match(latest, /p\.is_platform_admin/);
  // Nobody signed in removes a company row any more.
  assert.match(latest, /drop policy if exists companies_delete on public\.companies;/);
});

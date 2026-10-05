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

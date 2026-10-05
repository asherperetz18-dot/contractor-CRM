import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aiUsageDeltas, emptyUsage, formatUsageLine, usageMonth, type MonthUsage } from "./usage.ts";

test("usage is kept per calendar month, in UTC", () => {
  assert.equal(usageMonth(new Date("2026-10-05T12:00:00Z")), "2026-10-01");
  assert.equal(usageMonth(new Date("2026-10-31T23:59:59Z")), "2026-10-01");
  assert.equal(usageMonth(new Date("2026-11-01T00:00:00Z")), "2026-11-01");
  assert.equal(usageMonth(new Date("2027-01-15T08:00:00Z")), "2027-01-01");
});

test("one AI answer counts once, with the words it read and wrote", () => {
  assert.deepEqual(aiUsageDeltas({ input_tokens: 1200, output_tokens: 340 }), {
    aiRequests: 1,
    aiInputTokens: 1200,
    aiOutputTokens: 340,
  });
  // Cached prompt reading is still reading.
  assert.deepEqual(
    aiUsageDeltas({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 900, cache_creation_input_tokens: 100 }),
    { aiRequests: 1, aiInputTokens: 1010, aiOutputTokens: 5 }
  );
  // An answer with no usage on it still counts as a use.
  assert.deepEqual(aiUsageDeltas(undefined), { aiRequests: 1, aiInputTokens: 0, aiOutputTokens: 0 });
});

test("a month's usage reads as one line a person understands", () => {
  const u: MonthUsage = { ...emptyUsage(), aiRequests: 12, smsSent: 1, emailsSent: 2500 };
  assert.equal(formatUsageLine(u), "12 AI uses · 1 text · 2,500 emails");
  assert.equal(formatUsageLine(emptyUsage()), "0 AI uses · 0 texts · 0 emails");
  assert.equal(formatUsageLine({ ...emptyUsage(), aiRequests: 1 }), "1 AI use · 0 texts · 0 emails");
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const fnBody = (text: string, start: string) => text.slice(text.indexOf(start), text.indexOf(start) + 4000);

test("texts are counted where they're sent, for the company they're sent for", () => {
  const sender = fnBody(source("../twilio-env.ts"), "export async function sendTwilioSms");
  assert.match(sender, /if \(env\.companyId\) await recordUsage\(env\.companyId, \{ smsSent: 1 \}\)/);
  // Counted only after Twilio said yes.
  assert.ok(sender.indexOf("if (!res.ok)") < sender.indexOf("recordUsage("));
  const getter = fnBody(source("../twilio-company.ts"), "export async function getTwilioForSending");
  assert.match(getter, /\{ \.\.\.twilio, companyId \}/);
  const sendSms = fnBody(source("../actions/sms.ts"), "export async function sendSms");
  assert.match(sendSms, /recordUsage\(profile\.company_id, \{ smsSent: 1 \}\)/);
});

test("company emails are counted; platform mail (setup links, password resets) isn't", () => {
  const sender = fnBody(source("../email-env.ts"), "export async function sendEmail");
  assert.match(sender, /if \(options\.env\?\.companyId\) await recordUsage\(options\.env\.companyId, \{ emailsSent: 1 \}\)/);
  const getter = source("../email-company.ts");
  assert.equal((getter.match(/replyTo: plan\.replyTo, companyId \}/g) ?? []).length, 2);
});

test("every AI answer is counted at the one AI door", () => {
  const door = source("../ai/company-ai.ts");
  assert.match(door, /return \{ client: metered\(new Anthropic\(\{ apiKey \}\), companyId\) \}/);
  assert.match(door, /client\.messages\.create = /);
  assert.match(door, /client\.messages\.stream = /);
});

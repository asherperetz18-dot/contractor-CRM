import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { emptyUsage, formatUsageLine } from "./usage.ts";
import {
  NO_LIMITS,
  formatAgainstLimit,
  formatUsageWithLimits,
  limitMessage,
  limitReached,
  limitsFromRow,
  parseLimitInput,
} from "./limits.ts";

test("no limit is set until a platform admin sets one", () => {
  assert.deepEqual(limitsFromRow(null), NO_LIMITS);
  const busy = { ...emptyUsage(), aiRequests: 1_000_000, smsSent: 1_000_000, emailsSent: 1_000_000 };
  for (const kind of ["ai", "sms", "email"] as const) assert.equal(limitReached(busy, NO_LIMITS, kind), false);
});

test("a limit is reached once the month's count gets to it", () => {
  const limits = { ...NO_LIMITS, sms: 100 };
  assert.equal(limitReached({ ...emptyUsage(), smsSent: 99 }, limits, "sms"), false);
  assert.equal(limitReached({ ...emptyUsage(), smsSent: 100 }, limits, "sms"), true);
  assert.equal(limitReached({ ...emptyUsage(), smsSent: 250 }, limits, "sms"), true);
  // Each kind has its own limit.
  assert.equal(limitReached({ ...emptyUsage(), smsSent: 250 }, limits, "ai"), false);
  // A zero limit means none at all this month.
  assert.equal(limitReached(emptyUsage(), { ...NO_LIMITS, email: 0 }, "email"), true);
});

test("the message says what ran out, how much, and when it comes back", () => {
  assert.equal(
    limitMessage("ai", 500),
    "Your company has used this month's 500 AI answers. It starts again on the 1st; ask AI Build Pros if you need more."
  );
  assert.match(limitMessage("sms", 1000), /this month's 1,000 texts\./);
  assert.match(limitMessage("email", 1), /this month's 1 email\./);
});

test("a limit is typed as a whole number; blank means no limit", () => {
  assert.deepEqual(parseLimitInput(""), { value: null });
  assert.deepEqual(parseLimitInput("  "), { value: null });
  assert.deepEqual(parseLimitInput("500"), { value: 500 });
  assert.deepEqual(parseLimitInput("1,500"), { value: 1500 });
  assert.deepEqual(parseLimitInput("0"), { value: 0 });
  assert.ok(parseLimitInput("-3").error);
  assert.ok(parseLimitInput("12.5").error);
  assert.ok(parseLimitInput("lots").error);
  assert.ok(parseLimitInput("100000001").error);
});

test("usage reads against its limit when there is one", () => {
  assert.equal(formatAgainstLimit(214, 500, "AI use", "AI uses"), "214 of 500 AI uses");
  assert.equal(formatAgainstLimit(1, null, "text", "texts"), "1 text");
  assert.equal(formatAgainstLimit(1200, 1000, "email", "emails"), "1,200 of 1,000 emails");
});

test("with no limits the month reads exactly as before", () => {
  const u = { ...emptyUsage(), aiRequests: 214, smsSent: 1380, emailsSent: 96 };
  assert.equal(formatUsageWithLimits(u, NO_LIMITS), formatUsageLine(u));
  assert.equal(formatUsageWithLimits(u, { ai: 500, sms: null, email: 100 }), "214 of 500 AI uses · 1,380 texts · 96 of 100 emails");
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const fnBody = (text: string, start: string) => text.slice(text.indexOf(start), text.indexOf(start) + 5000);
const before = (body: string, first: string, second: string, what: string) => {
  const a = body.indexOf(first);
  const b = body.indexOf(second);
  assert.ok(a > 0 && b > 0 && a < b, what);
};

test("each limit is checked before the thing goes out, where it is counted", () => {
  before(
    fnBody(source("../twilio-env.ts"), "export async function sendTwilioSms"),
    'usageLimitError(env.companyId, "sms")',
    "await fetch(",
    "texts: before Twilio is asked"
  );
  before(
    fnBody(source("../actions/sms.ts"), "export async function sendSms"),
    'usageLimitError(profile.company_id, "sms")',
    "await fetch(",
    "the screens' texts: before Twilio is asked"
  );
  before(
    fnBody(source("../email-env.ts"), "export async function sendEmail"),
    'usageLimitError(options.env.companyId, "email")',
    "await fetch(",
    "emails: before the mail service is asked"
  );
  const door = fnBody(source("../ai/company-ai.ts"), "export async function aiForCompany");
  before(door, 'usageLimitError(companyId, "ai")', "new Anthropic(", "AI: before a client is handed out");
});

test("only a platform admin sets limits, checked inside the action itself", () => {
  const action = fnBody(source("../actions/limits-admin.ts"), "export async function setCompanyLimits");
  before(action, "isPlatformAdmin(profile)", ".upsert(", "checked before the write");
  assert.match(action, /dropCompanyLimitsCache\(companyId\)/);
});

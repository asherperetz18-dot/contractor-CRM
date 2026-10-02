import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkTwilioSetup, voiceFieldsBlock, type TwilioSetup } from "./twilio-credential-check.ts";

/**
 * Settings → Twilio used to save whatever was typed. A wrong API Key
 * Secret saved fine, the page said "In-app calling is configured", and
 * every call then died with "Could not place the call." -- Twilio had
 * refused the calling pass, and nothing said why. Now the details are
 * checked with Twilio before anything is saved (DECISIONS #106).
 */

// Built at runtime: GitHub's push protection rejects SID-shaped literals.
const AC = "AC" + "0123456789abcdef".repeat(2);
const SK = "SK" + "0123456789abcdef".repeat(2);
const AP = "AP" + "0123456789abcdef".repeat(2);
const VOICE_URL = "https://portal.example.com/api/voice/twiml";

const setup = (over: Partial<TwilioSetup> = {}): TwilioSetup => ({
  accountSid: AC,
  authToken: "t".repeat(32),
  phoneNumber: "+15555550100",
  apiKeySid: SK,
  apiKeySecret: "s".repeat(32),
  twimlAppSid: AP,
  expectedVoiceUrl: VOICE_URL,
  ...over,
});

type Reply = { status: number; body?: unknown } | "throw";
type Seen = { url: string; auth: string };

/** A stand-in for Twilio: answers by which resource was asked for. */
function twilio(replies: { account?: Reply; numbers?: Reply; app?: Reply } = {}) {
  const seen: Seen[] = [];
  const fetchImpl = async (url: string, init: { headers: Record<string, string> }) => {
    seen.push({ url, auth: init.headers.Authorization });
    const which = url.includes("/Applications/")
      ? "app"
      : url.includes("/IncomingPhoneNumbers")
        ? "numbers"
        : "account";
    const defaults: Record<string, Reply> = {
      account: { status: 200, body: { sid: AC, status: "active" } },
      numbers: { status: 200, body: { incoming_phone_numbers: [{ phone_number: "+15555550100" }] } },
      app: { status: 200, body: { voice_url: VOICE_URL, voice_method: "POST" } },
    };
    const reply = replies[which] ?? defaults[which];
    if (reply === "throw") throw new Error("network down");
    return {
      status: reply.status,
      ok: reply.status >= 200 && reply.status < 300,
      json: async () => reply.body ?? {},
    };
  };
  return { seen, fetchImpl };
}

const basic = (user: string, pass: string) => "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");

test("a correct setup passes, each part checked with its own credentials", async () => {
  const { seen, fetchImpl } = twilio();
  assert.equal(await checkTwilioSetup(setup(), fetchImpl), null);
  assert.deepEqual(
    seen.map((s) => s.url),
    [
      `https://api.twilio.com/2010-04-01/Accounts/${AC}.json`,
      `https://api.twilio.com/2010-04-01/Accounts/${AC}/IncomingPhoneNumbers.json?PhoneNumber=%2B15555550100`,
      `https://api.twilio.com/2010-04-01/Accounts/${AC}/Applications/${AP}.json`,
    ]
  );
  // The account and number with the auth token; the TwiML app with the
  // API key -- the same pair the calling pass is signed with.
  assert.equal(seen[0].auth, basic(AC, "t".repeat(32)));
  assert.equal(seen[1].auth, basic(AC, "t".repeat(32)));
  assert.equal(seen[2].auth, basic(SK, "s".repeat(32)));
});

test("texting only: no calling boxes, no calling check", async () => {
  const { seen, fetchImpl } = twilio();
  const textOnly = setup({ apiKeySid: null, apiKeySecret: null, twimlAppSid: null });
  assert.equal(await checkTwilioSetup(textOnly, fetchImpl), null);
  assert.equal(seen.length, 2);
});

test("an Account SID and Auth Token Twilio refuses are named", async () => {
  const { fetchImpl } = twilio({ account: { status: 401 } });
  assert.match((await checkTwilioSetup(setup(), fetchImpl)) ?? "", /Account SID and Auth Token/);
});

test("a number that isn't in this Twilio account is refused", async () => {
  const { fetchImpl } = twilio({ numbers: { status: 200, body: { incoming_phone_numbers: [] } } });
  assert.match((await checkTwilioSetup(setup(), fetchImpl)) ?? "", /\+15555550100 isn't a number in this Twilio account/);
});

test("an API Key SID and Secret that don't belong together are refused", async () => {
  const { fetchImpl } = twilio({ app: { status: 401 } });
  assert.match((await checkTwilioSetup(setup(), fetchImpl)) ?? "", /API Key SID and Secret/);
});

test("a TwiML App from another Twilio account is refused", async () => {
  const { fetchImpl } = twilio({ app: { status: 404 } });
  assert.match((await checkTwilioSetup(setup(), fetchImpl)) ?? "", /TwiML App isn't in this Twilio account/);
});

test("a TwiML App pointing somewhere else is refused, with the URL to use", async () => {
  const { fetchImpl } = twilio({ app: { status: 200, body: { voice_url: "", voice_method: "POST" } } });
  const msg = (await checkTwilioSetup(setup(), fetchImpl)) ?? "";
  assert.match(msg, /Voice Request URL/);
  assert.ok(msg.includes(VOICE_URL), msg);
});

test("the CRM's own URL on another of its domains is accepted", async () => {
  const other = "https://crm.example.com/api/voice/twiml";
  const { fetchImpl } = twilio({ app: { status: 200, body: { voice_url: other, voice_method: "POST" } } });
  assert.equal(await checkTwilioSetup(setup(), fetchImpl), null);
});

test("a TwiML App set to GET is refused -- the CRM only answers POST", async () => {
  const { fetchImpl } = twilio({ app: { status: 200, body: { voice_url: VOICE_URL, voice_method: "GET" } } });
  assert.match((await checkTwilioSetup(setup(), fetchImpl)) ?? "", /HTTP POST/);
});

test("Twilio unreachable: nothing is saved, and it says so", async () => {
  for (const replies of [{ account: "throw" as const }, { account: { status: 500 } }, { app: { status: 503 } }]) {
    const { fetchImpl } = twilio(replies);
    assert.match((await checkTwilioSetup(setup(), fetchImpl)) ?? "", /Couldn't reach Twilio/);
  }
});

test("the calling boxes are all filled or all empty, each in its own shape", () => {
  assert.equal(voiceFieldsBlock({ apiKeySid: null, apiKeySecret: null, twimlAppSid: null }), null);
  assert.equal(voiceFieldsBlock({ apiKeySid: SK, apiKeySecret: "s".repeat(32), twimlAppSid: AP }), null);
  assert.match(voiceFieldsBlock({ apiKeySid: SK, apiKeySecret: null, twimlAppSid: AP }) ?? "", /all three/);
  // The mix-up that started this: the TwiML App SID in the key's box.
  assert.match(voiceFieldsBlock({ apiKeySid: AP, apiKeySecret: "s".repeat(32), twimlAppSid: AP }) ?? "", /starts with SK/);
  assert.match(voiceFieldsBlock({ apiKeySid: SK, apiKeySecret: "s".repeat(32), twimlAppSid: SK }) ?? "", /starts with AP/);
});

test("Settings → Twilio checks with Twilio before it saves anything", () => {
  const src = readFileSync(new URL("./actions/twilio-admin.ts", import.meta.url), "utf8");
  const start = src.indexOf("export async function saveCompanyTwilio(");
  assert.ok(start > 0, "saveCompanyTwilio is missing");
  const fn = src.slice(start, src.indexOf("\nexport ", start + 1));
  const check = fn.indexOf("checkTwilioSetup(");
  assert.ok(check > 0, "saveCompanyTwilio must call checkTwilioSetup");
  assert.ok(check < fn.indexOf(".update("), "the check must come before the save");
  assert.ok(fn.indexOf("voiceFieldsBlock(") > 0, "half-filled calling boxes must be refused");
});

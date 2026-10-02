import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adoptSharedBlock, twilioOverview, twilioSource, type CompanyTwilioRow } from "./twilio-source.ts";

/**
 * Every company texts and calls from its own Twilio account or not at all
 * (DECISIONS #104). These rules say which company has one, and when the
 * server's shared account (the TWILIO_* settings -- La Home Contractor's)
 * may be moved into its owner's own settings (DECISIONS #103).
 */

const SHARED_SID = "AC" + "a".repeat(32);
const OTHER_SID = "AC" + "b".repeat(32);
const SHARED = { accountSid: SHARED_SID, phoneNumber: "+15555550100" };

const row = (over: Partial<CompanyTwilioRow> = {}): CompanyTwilioRow => ({
  company_id: "A",
  company_name: "Company A",
  twilio_account_sid: null,
  twilio_phone_number: null,
  has_token: false,
  has_voice: false,
  ...over,
});

const own = (over: Partial<CompanyTwilioRow> = {}) =>
  row({ twilio_account_sid: OTHER_SID, twilio_phone_number: "+15555550111", has_token: true, ...over });

test("a company with its account, token and number sends from its own", () => {
  assert.equal(twilioSource(own()), "own");
});

test("anything less can't text or call -- nothing is lent", () => {
  assert.equal(twilioSource(row()), "none");
  // A number without a token cannot send -- it is not "own" yet.
  assert.equal(twilioSource(row({ twilio_account_sid: OTHER_SID, twilio_phone_number: "+15555550111" })), "none");
});

test("the shared account moves into a company that has none of its own", () => {
  assert.equal(adoptSharedBlock("A", [row(), row({ company_id: "B", company_name: "Company B" })], SHARED), null);
});

test("nothing to move when the server has no shared account", () => {
  assert.match(adoptSharedBlock("A", [row()], null) ?? "", /no shared Twilio account/i);
});

test("a company that already has its own account must disconnect it first", () => {
  assert.match(adoptSharedBlock("A", [own()], SHARED) ?? "", /already has its own/i);
});

test("moving twice is refused politely", () => {
  assert.match(
    adoptSharedBlock("A", [own({ twilio_account_sid: SHARED_SID, twilio_phone_number: SHARED.phoneNumber })], SHARED) ?? "",
    /already/i
  );
});

test("another company already holding the shared account or number is named", () => {
  const b = own({ company_id: "B", company_name: "Ca Pro", twilio_account_sid: SHARED_SID });
  assert.match(adoptSharedBlock("A", [row(), b], SHARED) ?? "", /Ca Pro/);
  const c = own({ company_id: "C", company_name: "Third Co", twilio_phone_number: SHARED.phoneNumber });
  assert.match(adoptSharedBlock("A", [row(), c], SHARED) ?? "", /Third Co/);
});

test("the overview says who sends from what, and flags a shared account", () => {
  const rows = [
    own({ company_id: "A", company_name: "La Home", twilio_account_sid: SHARED_SID, twilio_phone_number: SHARED.phoneNumber, has_voice: true }),
    row({ company_id: "B", company_name: "Ca Pro" }),
    own({ company_id: "C", company_name: "Third Co", twilio_account_sid: SHARED_SID, twilio_phone_number: "+15555550122" }),
  ];
  const view = twilioOverview(rows);
  assert.deepEqual(
    view.map((v) => [v.companyName, v.source, v.sendsFrom, v.voice, v.sharesAccountWith]),
    [
      ["Ca Pro", "none", null, false, []],
      ["La Home", "own", SHARED.phoneNumber, true, ["Third Co"]],
      ["Third Co", "own", "+15555550122", false, ["La Home"]],
    ]
  );
});

test("only a platform admin can move the shared account, and its secrets never leave the server", () => {
  const src = readFileSync(new URL("./actions/twilio-admin.ts", import.meta.url), "utf8");
  const start = src.indexOf("export async function adoptSharedTwilio(");
  assert.ok(start > 0, "adoptSharedTwilio is missing");
  const fn = src.slice(start);
  assert.ok(fn.indexOf("isPlatformAdmin(profile)") > 0, "must require a platform admin");
  assert.ok(
    fn.indexOf("isPlatformAdmin(profile)") < fn.indexOf("getTwilioEnv()"),
    "the check must come before the shared credentials are read"
  );
  assert.match(fn, /Promise<\{ error\?: string; ok\?: boolean \}>/, "returns only ok/error, never credentials");
});

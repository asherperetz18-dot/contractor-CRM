import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cdrsToCalls,
  extensionRepMap,
  normalizeServer,
  nsDatetime,
  parseNsDatetime,
  shouldAlertNewLead,
  tokenMatches,
  uriUser,
  type NsCdr,
} from "./primecall.ts";

/**
 * PrimeCall runs on NetSapiens, whose v2 API hands back one CDR per call
 * LEG -- an inbound call that rings a three-phone ring group is three
 * rows sharing one call-orig-call-id. These tests pin how legs become
 * the one call a rep sees in Call Reports, and the small parsing rules
 * the sync leans on (server address, SIP URIs, the datetime format).
 */

function leg(overrides: Partial<NsCdr>): NsCdr {
  return {
    id: "cdr-1",
    "call-orig-call-id": "orig-1",
    "call-term-call-id": "term-1",
    "call-orig-from-user": "8185551234",
    "call-orig-from-name": "JANE DOE",
    "call-orig-to-user": "8445977463",
    "call-start-datetime": "2026-09-24T17:00:00Z",
    "call-answer-datetime": "",
    "call-talking-duration-seconds": 0,
    "call-total-duration-seconds": 20,
    ...overrides,
  };
}

test("an answered inbound call: the leg that talked names the extension", () => {
  const calls = cdrsToCalls(
    [
      leg({ id: "a", "call-term-user": "101", "call-term-call-id": "t-101" }),
      leg({
        id: "b",
        "call-term-user": "102",
        "call-term-call-id": "t-102",
        "call-answer-datetime": "2026-09-24T17:00:08Z",
        "call-talking-duration-seconds": 245,
      }),
    ],
    "inbound"
  );
  assert.equal(calls.length, 1);
  const [c] = calls;
  assert.equal(c.callId, "orig-1");
  assert.equal(c.direction, "inbound");
  assert.equal(c.externalNumber, "8185551234");
  assert.equal(c.companyNumber, "8445977463");
  assert.equal(c.answered, true);
  assert.equal(c.durationSeconds, 245);
  assert.equal(c.extension, "102");
  assert.equal(c.callerName, "JANE DOE");
  assert.equal(c.startedAt, "2026-09-24T17:00:00.000Z");
  // The recording can sit under either id; the orig id is tried first.
  assert.deepEqual(c.recordingCallIds, ["orig-1", "t-102"]);
});

test("nobody picked up: missed, no extension, no recording to look for", () => {
  const [c] = cdrsToCalls(
    [leg({ "call-term-user": "101" }), leg({ id: "b", "call-term-user": "102" })],
    "inbound"
  );
  assert.equal(c.answered, false);
  assert.equal(c.durationSeconds, 0);
  assert.equal(c.extension, null);
  assert.deepEqual(c.recordingCallIds, []);
});

test("an answer time with zero talk still counts as answered", () => {
  const [c] = cdrsToCalls(
    [leg({ "call-answer-datetime": "2026-09-24T17:00:05Z", "call-term-user": "101" })],
    "inbound"
  );
  assert.equal(c.answered, true);
  assert.equal(c.extension, "101");
});

test("NetSapiens' all-zero datetime means 'never answered'", () => {
  const [c] = cdrsToCalls([leg({ "call-answer-datetime": "0000-00-00 00:00:00" })], "inbound");
  assert.equal(c.answered, false);
});

test("caller number falls back through caller id and the SIP URI", () => {
  const [a] = cdrsToCalls(
    [leg({ "call-orig-from-user": "", "call-orig-caller-id": 13105550000 })],
    "inbound"
  );
  assert.equal(a.externalNumber, "13105550000");
  const [b] = cdrsToCalls(
    [
      leg({
        "call-orig-from-user": "",
        "call-orig-caller-id": null,
        "call-orig-from-uri": "sip:+13105550001@10.0.0.1",
      }),
    ],
    "inbound"
  );
  assert.equal(b.externalNumber, "+13105550001");
});

test("outbound: the dialed number is the customer, the placing extension is the rep", () => {
  const [c] = cdrsToCalls(
    [
      leg({
        "call-orig-user": 103,
        "call-orig-from-user": "103",
        "call-orig-caller-id": 8445977463,
        "call-orig-to-user": "18185559999",
        "call-answer-datetime": "2026-09-24T17:00:04Z",
        "call-talking-duration-seconds": 60,
      }),
    ],
    "outbound"
  );
  assert.equal(c.direction, "outbound");
  assert.equal(c.externalNumber, "18185559999");
  assert.equal(c.companyNumber, "8445977463");
  assert.equal(c.extension, "103");
  assert.equal(c.answered, true);
});

test("separate calls stay separate; a leg without any call id falls back to its cdr id", () => {
  const calls = cdrsToCalls(
    [
      leg({ id: "x" }),
      leg({ id: "y", "call-orig-call-id": "orig-2" }),
      leg({ id: "z", "call-orig-call-id": "" }),
    ],
    "inbound"
  );
  assert.deepEqual(
    calls.map((c) => c.callId),
    ["orig-1", "orig-2", "z"]
  );
});

test("a leg with no customer number is dropped rather than logged blank", () => {
  const calls = cdrsToCalls(
    [
      leg({
        "call-orig-from-user": "",
        "call-orig-caller-id": null,
        "call-orig-from-uri": "",
      }),
    ],
    "inbound"
  );
  assert.deepEqual(calls, []);
});

test("uriUser reads the user part of sip:, tel: and bare values", () => {
  assert.equal(uriUser("sip:8185551234@primecall.example"), "8185551234");
  assert.equal(uriUser("<sip:101@domain;user=phone>"), "101");
  assert.equal(uriUser("tel:+18185551234"), "+18185551234");
  assert.equal(uriUser("8185551234"), "8185551234");
  assert.equal(uriUser(null), "");
});

test("server address: whatever the admin pastes becomes one https origin", () => {
  assert.equal(normalizeServer("portal.primecall.com"), "https://portal.primecall.com");
  assert.equal(
    normalizeServer(" https://portal.primecall.com/ns-api/v2/ "),
    "https://portal.primecall.com"
  );
  assert.equal(normalizeServer("http://api.example.net/portal/"), "https://api.example.net");
  assert.equal(normalizeServer(""), null);
  assert.equal(normalizeServer("not a host"), null);
  // Never a private address: the API key would be sent there.
  assert.equal(normalizeServer("localhost"), null);
  assert.equal(normalizeServer("127.0.0.1"), null);
});

test("datetimes: queries go out in UTC, answers without a zone read as UTC", () => {
  assert.equal(nsDatetime(new Date("2026-09-24T17:05:09.123Z")), "2026-09-24T17:05:09Z");
  assert.equal(parseNsDatetime("2026-09-24 17:05:09"), "2026-09-24T17:05:09.000Z");
  assert.equal(parseNsDatetime("2026-09-24T10:05:09-07:00"), "2026-09-24T17:05:09.000Z");
  assert.equal(parseNsDatetime("2026-09-24T17:05:09Z[America/Phoenix]"), "2026-09-24T17:05:09.000Z");
  assert.equal(parseNsDatetime("0000-00-00 00:00:00"), null);
  assert.equal(parseNsDatetime(""), null);
  assert.equal(parseNsDatetime(undefined), null);
});

test("extensions map to CRM users by email -- only when exactly one matches", () => {
  const map = extensionRepMap(
    [
      { user: "101", "email-address": "Mike@LAHome.com" },
      { user: "102", "email-address": "shared@lahome.com" },
      { user: "103", "email-address": "" },
      { user: "104", "email-address": "nobody@lahome.com" },
    ],
    [
      { id: "p-mike", email: "mike@lahome.com" },
      { id: "p-a", email: "shared@lahome.com" },
      { id: "p-b", email: "SHARED@lahome.com" },
    ]
  );
  assert.equal(map.get("101"), "p-mike");
  assert.equal(map.has("102"), false);
  assert.equal(map.has("103"), false);
  assert.equal(map.has("104"), false);
});

test("a new-caller text alert only for a call from the last two hours", () => {
  const now = new Date("2026-09-24T18:00:00Z");
  assert.equal(shouldAlertNewLead("2026-09-24T17:30:00.000Z", now), true);
  assert.equal(shouldAlertNewLead("2026-09-24T15:59:00.000Z", now), false);
  // No start time: can't prove it's fresh, so nobody's phone buzzes.
  assert.equal(shouldAlertNewLead(null, now), false);
});

test("webhook token compare: exact match only", () => {
  assert.equal(tokenMatches("abc123", "abc123"), true);
  assert.equal(tokenMatches("abc124", "abc123"), false);
  assert.equal(tokenMatches("abc", "abc123"), false);
  assert.equal(tokenMatches("", ""), false);
  assert.equal(tokenMatches(null, "abc123"), false);
});

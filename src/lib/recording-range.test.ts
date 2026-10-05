import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  recordingCredentialChoice,
  recordingResponseInit,
  twilioRecordingUrlAllowed,
  upstreamRecordingHeaders,
} from "./recording-range.ts";

/**
 * A recording is only seekable when the proxy answers a "Range:" request
 * with the provider's own 206 and Content-Range. Serve a plain 200 with
 * no length instead and Chrome greys the timeline out: the player can
 * play from the start and nothing else. These pin the passthrough.
 */

test("the browser's Range header rides along on the upstream fetch, beside the auth header", () => {
  assert.deepEqual(upstreamRecordingHeaders("bytes=1024-", { Authorization: "Basic abc" }), {
    Authorization: "Basic abc",
    Range: "bytes=1024-",
  });
});

test("no Range from the browser means no Range upstream -- the whole file, as before", () => {
  assert.deepEqual(upstreamRecordingHeaders(null, { Authorization: "Basic abc" }), {
    Authorization: "Basic abc",
  });
  assert.deepEqual(upstreamRecordingHeaders(null), {});
});

test("a 206 slice comes back as a 206 with its Content-Range and Content-Length", () => {
  const init = recordingResponseInit({
    status: 206,
    headers: new Headers({
      "content-type": "audio/mpeg",
      "content-range": "bytes 1024-2047/4096",
      "content-length": "1024",
    }),
  });
  assert.equal(init.status, 206);
  assert.equal(init.headers["Content-Type"], "audio/mpeg");
  assert.equal(init.headers["Content-Range"], "bytes 1024-2047/4096");
  assert.equal(init.headers["Content-Length"], "1024");
  assert.equal(init.headers["Accept-Ranges"], "bytes");
});

test("a whole-file 200 stays a 200, still advertising ranges so a later seek asks for a slice", () => {
  const init = recordingResponseInit({
    status: 200,
    headers: new Headers({ "content-type": "audio/x-wav", "content-length": "4096" }),
  });
  assert.equal(init.status, 200);
  assert.equal(init.headers["Content-Type"], "audio/x-wav");
  assert.equal(init.headers["Content-Length"], "4096");
  assert.equal(init.headers["Accept-Ranges"], "bytes");
  assert.equal("Content-Range" in init.headers, false);
});

test("audio/mpeg is assumed when the provider names no type, and the reply is private-cacheable", () => {
  const init = recordingResponseInit({ status: 200, headers: new Headers() });
  assert.equal(init.headers["Content-Type"], "audio/mpeg");
  assert.equal(init.headers["Cache-Control"], "private, max-age=3600");
  assert.equal("Content-Length" in init.headers, false);
});

test("a compressed upstream body drops its Content-Length -- fetch inflates it, so the count would lie", () => {
  const init = recordingResponseInit({
    status: 200,
    headers: new Headers({ "content-length": "900", "content-encoding": "gzip" }),
  });
  assert.equal("Content-Length" in init.headers, false);
});

test("any other 2xx is served as a plain 200 (a 203 or 204 upstream is not a slice)", () => {
  assert.equal(recordingResponseInit({ status: 203, headers: new Headers() }).status, 200);
});

// ── twilioRecordingUrlAllowed ────────────────────────────────────────
// The Twilio branch sends the company's account SID and auth token with
// the fetch, so the stored URL decides who receives them. Only Twilio's
// own API, and only that account's recordings, ever get them.

// Built, not written out: a literal in this shape trips GitHub's secret
// scanning, which reads it as a real Twilio account SID.
const SID = "AC" + "0123456789abcdef".repeat(2);
const OWN = `https://api.twilio.com/2010-04-01/Accounts/${SID}/Recordings/RE0123456789abcdef0123456789abcdef.mp3`;

test("a recording on the company's own Twilio account is fetched", () => {
  assert.equal(twilioRecordingUrlAllowed(OWN, SID), true);
});

test("a Twilio regional API host is fetched too", () => {
  assert.equal(twilioRecordingUrlAllowed(OWN.replace("api.twilio.com", "api.dublin.ie1.twilio.com"), SID), true);
});

test("any other host never receives the credentials", () => {
  for (const url of [
    OWN.replace("api.twilio.com", "example.com"),
    OWN.replace("api.twilio.com", "api.twilio.com.example.com"),
    OWN.replace("api.twilio.com", "eviltwilio.com"),
    `https://example.com/?u=${encodeURIComponent(OWN)}`,
    `https://api.twilio.com@example.com/2010-04-01/Accounts/${SID}/Recordings/RE1.mp3`,
  ]) {
    assert.equal(twilioRecordingUrlAllowed(url, SID), false, url);
  }
});

test("plain http, another account's recording, or a non-recording path is refused", () => {
  assert.equal(twilioRecordingUrlAllowed(OWN.replace("https:", "http:"), SID), false);
  assert.equal(twilioRecordingUrlAllowed(OWN.replace(SID, "AC" + "f".repeat(32)), SID), false);
  assert.equal(
    twilioRecordingUrlAllowed(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, SID),
    false
  );
  assert.equal(
    twilioRecordingUrlAllowed(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Recordings/../Messages.json`, SID),
    false
  );
});

test("junk is refused, not thrown", () => {
  assert.equal(twilioRecordingUrlAllowed("not a url", SID), false);
  assert.equal(twilioRecordingUrlAllowed(OWN, ""), false);
});

test("the recording proxy checks the URL before sending Twilio credentials", () => {
  const route = readFileSync(new URL("../app/api/voice/recording/[id]/route.ts", import.meta.url), "utf8");
  // The own account is checked with recordingCredentialChoice; the shared
  // account only through legacySharedRecordingCreds, which checks the URL
  // and the list made at the switch (twilio-no-fallback.test.ts).
  const own = route.indexOf("recordingCredentialChoice(recordingUrl, own, null, false)");
  const shared = route.indexOf("legacySharedRecordingCreds(id, recordingUrl)");
  const credentialedFetch = route.indexOf("Basic ${basicAuth}");
  assert.ok(own > 0, "the company's own account is used only for its own recordings");
  assert.ok(shared > 0, "the shared account only through legacySharedRecordingCreds");
  assert.ok(own < credentialedFetch && shared < credentialedFetch, "the checks come before the credentialed fetch");
});

// ---- Recordings made on the shared account while a company borrowed it
// (DECISIONS #113). Before every company had its own Twilio, Ca Pro's and
// others' calls were recorded on La Home's account. Once they moved to
// their own (or to none), the player refused those older recordings. They
// play again with the shared account -- but only the ones listed once, at
// the switch, in a table nobody in the CRM can write to.

const OWN_ACCT = { accountSid: "AC" + "1".repeat(32) };
const SHARED_ACCT = { accountSid: "AC" + "2".repeat(32) };
const rec = (account: string) =>
  `https://api.twilio.com/2010-04-01/Accounts/${account}/Recordings/RE${"3".repeat(32)}.mp3`;

test("a recording on the company's own account plays with its own account", () => {
  assert.equal(recordingCredentialChoice(rec(OWN_ACCT.accountSid), OWN_ACCT, SHARED_ACCT, false), "own");
});

test("a recording from the borrowing days plays with the shared account, if it was listed at the switch", () => {
  assert.equal(recordingCredentialChoice(rec(SHARED_ACCT.accountSid), OWN_ACCT, SHARED_ACCT, true), "shared");
  // A company with no Twilio of its own any more still hears its old calls.
  assert.equal(recordingCredentialChoice(rec(SHARED_ACCT.accountSid), null, SHARED_ACCT, true), "shared");
});

test("an unlisted recording on the shared account is never fetched with it", () => {
  // A call_logs row a company member edited to point at La Home's recording.
  assert.equal(recordingCredentialChoice(rec(SHARED_ACCT.accountSid), OWN_ACCT, SHARED_ACCT, false), null);
});

test("the shared account fetches only its own recordings, and only from Twilio", () => {
  const other = "AC" + "4".repeat(32);
  assert.equal(recordingCredentialChoice(rec(other), OWN_ACCT, SHARED_ACCT, true), null);
  assert.equal(
    recordingCredentialChoice(`https://evil.example/2010-04-01/Accounts/${SHARED_ACCT.accountSid}/Recordings/RE${"3".repeat(32)}`, OWN_ACCT, SHARED_ACCT, true),
    null
  );
  assert.equal(recordingCredentialChoice(rec(SHARED_ACCT.accountSid), OWN_ACCT, null, true), null);
});

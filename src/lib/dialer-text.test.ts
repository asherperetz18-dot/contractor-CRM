import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Text from the dialer (DECISIONS #113). The dialer could only call; a
 * number that wasn't on a contact could only be texted by building a
 * /reply-inbox?phone= link by hand. Text now sits next to Call.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const dialer = read("../app/(app)/voice-dialer.tsx");
const sms = read("./actions/sms.ts");
const layout = read("../app/(app)/layout.tsx");

function fnBody(src: string, name: string): string {
  const at = src.indexOf(`export async function ${name}(`);
  assert.ok(at !== -1, `${name} exists`);
  const next = src.indexOf("\nexport ", at + 1);
  return src.slice(at, next === -1 ? undefined : next);
}

test("Text sits next to Call, only for people who may send texts", () => {
  assert.match(layout, /<VoiceDialer canText=\{canEditDispatch\(profile\)\} \/>/);
  assert.match(dialer, /\{canText && \(\s*<button[\s\S]{0,200}?>\s*Text\s*<\/button>/);
  assert.match(dialer, /sendDialerText\(/);
});

test("a typed number is texted in a form the phone network takes", () => {
  const body = fnBody(sms, "sendDialerText");
  assert.match(body, /toE164\(phone\)/);
});

test("the text lands on the contact who owns the number, as the dialer's calls do", () => {
  const body = fnBody(sms, "sendDialerText");
  // Read as the signed-in user, so it never files on a contact they can't
  // see -- the same lookup call-logs.ts makes for a dialed number.
  assert.match(body, /leadForPhoneNumber\(supabase, profile\.company_id, to\)/);
  assert.match(body, /const supabase = await createClient\(\)/);
  assert.doesNotMatch(body, /createAdminClient/);
  assert.match(body, /sendSms\(leadId, to, body\)/, "through the one send path, with its permission check");
});

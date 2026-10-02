import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The TWILIO_* deployment settings are one business's account (La Home
 * Contractor's, from when the CRM served one company). A company's
 * customers must get texts and calls from that company's own number,
 * and a reply or call to a number no company owns must never be
 * verified with -- or filed under -- somebody else's account. So nothing
 * may read the shared account except: its definition, the identifiers
 * the Platform Admin page shows, and the one-time move of that account
 * into its owner's own settings (DECISIONS #103, #104). Same rule as
 * Stripe's deposits (stripe-company.test.ts).
 */

const SRC = fileURLToPath(new URL("../", import.meta.url));
const ALLOWED = new Set(["lib/twilio-env.ts", "lib/twilio-company.ts", "lib/actions/twilio-admin.ts"]);
const READS_SHARED = /\bgetTwilio(Voice)?Env\(|process\.env\.TWILIO_/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
  });
}

test("nothing outside three files reads the shared Twilio account", () => {
  const readers = sourceFiles(SRC)
    .map((f) => relative(SRC, f).split("\\").join("/"))
    .filter((f) => !ALLOWED.has(f) && READS_SHARED.test(readFileSync(join(SRC, f), "utf8")));
  assert.deepEqual(readers, []);
});

/** The source of one exported function, up to the next export. */
function body(src: string, name: string): string {
  const start = src.search(new RegExp(`export (async )?function ${name}\\(`));
  assert.ok(start >= 0, `${name} not found`);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

test("a company's credentials are its own or nothing", () => {
  const src = readFileSync(join(SRC, "lib/twilio-company.ts"), "utf8");
  for (const name of ["getTwilioForCompany", "getTwilioVoiceForCompany"]) {
    assert.doesNotMatch(body(src, name), READS_SHARED, `${name} lends the shared account`);
  }
  // The only other use there hands out identifiers, never the token.
  const shared = body(src, "sharedTwilio");
  assert.match(shared, /accountSid: env\.accountSid, phoneNumber: env\.phoneNumber/);
  assert.doesNotMatch(shared, /authToken/);
});

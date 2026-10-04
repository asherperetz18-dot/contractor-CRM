import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The guard rails around a company's email sender (DECISIONS #110):
 * the shared account never sends from a company's own address, a new
 * address is proven with a real send before it is saved, and every
 * customer email says where replies go.
 */

const src = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the shared account never sends from a company's own address", () => {
  const company = src("./email-company.ts");
  assert.match(company, /companyEmailPlan\(/, "the choice is made by the tested companyEmailPlan");
  assert.doesNotMatch(
    company,
    /platform\.apiKey,\s*from,\s*source:\s*"company"/,
    "the old fallback that lent the shared key to a company's own address is gone"
  );
});

test("a company's own address is proven with a real send before it is saved", () => {
  const actions = src("./actions/email-admin.ts");
  const start = actions.indexOf("export async function saveCompanyEmail(");
  assert.ok(start > 0, "saveCompanyEmail is missing");
  const fn = actions.slice(start, actions.indexOf("\nexport ", start + 1));
  const send = fn.indexOf("sendEmail(");
  assert.ok(send > 0, "a test email must be sent through the company's own key");
  assert.ok(send < fn.indexOf(".update("), "the test send must come before the save");
  assert.match(fn, /resend\.dev/, "Resend's sandbox address is refused: it only ever reaches the account owner");
  assert.match(fn, /storedKey/, "saving without retyping the key keeps the key already stored");
});

test("every customer email names where replies go", () => {
  for (const [file, sends] of [
    ["./actions/portal.ts", 2],
    ["./actions/bulk-email.ts", 1],
    ["./actions/estimates.ts", 1],
  ] as const) {
    const code = src(file);
    const calls = [...code.matchAll(/sendEmail\([^;]*?\{([^;]*?)\}\s*\)/g)].map((m) => m[1]);
    assert.equal(calls.length, sends, `${file}: expected ${sends} sendEmail call(s)`);
    for (const opts of calls) assert.match(opts, /replyTo:/, `${file}: a send without replyTo`);
  }
});

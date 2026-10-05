import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { metaSecretWrite, pickMetaSecrets } from "./page-secrets-rules.ts";

/**
 * A company's Facebook Page token and app secret were stored in plain
 * text in company_profile, which every member of the company can read --
 * a field rep could read the token that downloads the company's Facebook
 * leads. They are now encrypted like every other saved key, and the plain
 * copies are moved out of reach (DECISIONS #113).
 */

const decrypt = (v: string | null | undefined) => (v ? v.replace(/^enc:/, "") : null);
const encrypt = (v: string) => `enc:${v}`;

test("the encrypted copy wins", () => {
  const got = pickMetaSecrets(
    { meta_page_access_token_enc: "enc:tok", meta_app_secret_enc: "enc:sec", meta_page_access_token: "old", meta_app_secret: "old" },
    null,
    decrypt
  );
  assert.deepEqual(got, { pageAccessToken: "tok", appSecret: "sec", needsHealing: true });
});

test("a plain copy left from before is still used, and marked to be encrypted", () => {
  const got = pickMetaSecrets({ meta_page_access_token: "tok", meta_app_secret: null }, null, decrypt);
  assert.deepEqual(got, { pageAccessToken: "tok", appSecret: null, needsHealing: true });
});

test("a key moved out of reach by the migration is found and encrypted", () => {
  const got = pickMetaSecrets({}, { page_access_token: "tok", app_secret: "sec" }, decrypt);
  assert.deepEqual(got, { pageAccessToken: "tok", appSecret: "sec", needsHealing: true });
});

test("nothing stored: nothing to use, nothing to heal", () => {
  assert.deepEqual(pickMetaSecrets({}, null, decrypt), { pageAccessToken: null, appSecret: null, needsHealing: false });
  assert.deepEqual(
    pickMetaSecrets({ meta_page_access_token_enc: "enc:tok" }, null, decrypt),
    { pageAccessToken: "tok", appSecret: null, needsHealing: false }
  );
});

test("a save writes only the encrypted copy and always clears the plain one", () => {
  assert.deepEqual(metaSecretWrite({ pageAccessToken: "tok", appSecret: "sec" }, encrypt), {
    meta_page_access_token_enc: "enc:tok",
    meta_page_access_token: null,
    meta_app_secret_enc: "enc:sec",
    meta_app_secret: null,
  });
  // undefined: leave that key as it is. null: forget it.
  assert.deepEqual(metaSecretWrite({ pageAccessToken: "tok" }, encrypt), {
    meta_page_access_token_enc: "enc:tok",
    meta_page_access_token: null,
  });
  assert.deepEqual(metaSecretWrite({ pageAccessToken: null, appSecret: null }, encrypt), {
    meta_page_access_token_enc: null,
    meta_page_access_token: null,
    meta_app_secret_enc: null,
    meta_app_secret: null,
  });
});

const SRC = fileURLToPath(new URL("../../", import.meta.url));
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
  });
}

test("only the page-secrets module touches the plain columns", () => {
  const plain = /meta_page_access_token(?!_enc)|meta_app_secret(?!_enc)/;
  const users = sourceFiles(SRC)
    .map((f) => relative(SRC, f).split("\\").join("/"))
    .filter((f) => !f.startsWith("lib/meta/page-secrets") && plain.test(readFileSync(join(SRC, f), "utf8")));
  assert.deepEqual(users, []);
});

test("the settings page never sends a saved key to the browser", () => {
  const page = readFileSync(join(SRC, "app/(app)/settings/facebook-lead-ads/page.tsx"), "utf8");
  assert.doesNotMatch(page, /pageAccessToken:|appSecret:/, "only whether one is saved");
  assert.match(page, /hasPageAccessToken/);
  const action = readFileSync(join(SRC, "lib/actions/settings.ts"), "utf8");
  const start = action.indexOf("export async function saveMetaConfig(");
  const fn = action.slice(start, action.indexOf("\nexport ", start + 1));
  assert.match(fn, /isAdminRole\(/, "only an admin saves Facebook keys");
  assert.match(fn, /saveMetaSecrets\(/, "saved encrypted");
});

test("the migration moves the plain keys out of reach", () => {
  const sql = readFileSync(join(SRC, "../supabase/migrations/0192_meta_secrets_encrypted.sql"), "utf8");
  assert.match(sql, /add column if not exists meta_page_access_token_enc text/);
  assert.match(sql, /add column if not exists meta_app_secret_enc text/);
  assert.match(sql, /revoke all on public\.meta_secrets_legacy from anon, authenticated/);
  assert.match(sql, /set meta_page_access_token = null,\s*meta_app_secret = null/);
  assert.doesNotMatch(sql, /create policy/i);
});

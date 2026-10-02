import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKUP_TABLES, companyScopeColumn, withoutSecrets } from "./backup-scope.ts";

/**
 * Settings → Backup is run by a company's Office or Admin, and must hand
 * them their own company and nothing else -- the export reads with the
 * service role, which RLS never sees, so the narrowing is this code's
 * job. The nightly job alone still exports everything (DECISIONS #099).
 */

test("the company row is found by its own id", () => {
  assert.equal(companyScopeColumn("companies"), "id");
});

test("people come from the company's member list, never profiles.company_id", () => {
  // profiles.company_id is the legacy first company; someone who joined
  // a second company later would be missed by it, and someone who left
  // would be included.
  assert.equal(companyScopeColumn("profiles"), "members");
});

test("every other table is narrowed by its company_id", () => {
  const others = BACKUP_TABLES.filter((t) => t !== "companies" && t !== "profiles");
  assert.ok(others.length > 30, "the table list should still be the full backup list");
  for (const t of others) assert.equal(companyScopeColumn(t), "company_id", t);
});

test("saved keys, tokens and passwords leave the company's own download", () => {
  const row = {
    name: "Summit Builders Co",
    twilio_account_sid: "AC123",
    twilio_phone_number: "+15555550100",
    twilio_auth_token_enc: "x",
    twilio_api_key_secret_enc: "x",
    stripe_secret_key_enc: "x",
    stripe_webhook_secret_enc: "x",
    callrail_api_key_enc: "x",
    callrail_signing_key_enc: "x",
    primecall_api_key_enc: "x",
    primecall_webhook_token_enc: "x",
    resend_api_key_enc: "x",
    webhook_secret: "x",
    meta_app_secret: "x",
    meta_page_access_token: "x",
    meta_verify_token: "x",
    inbound_email_token: "x",
  };
  assert.deepEqual(withoutSecrets(row), {
    name: "Summit Builders Co",
    twilio_account_sid: "AC123",
    twilio_phone_number: "+15555550100",
  });
});

test("ordinary columns that merely contain 'key' stay", () => {
  assert.deepEqual(withoutSecrets({ key: "on_my_way", page_key: "leads" }), {
    key: "on_my_way",
    page_key: "leads",
  });
});

const SRC = fileURLToPath(new URL("../", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
  });
}

// The full export is the nightly job's alone. A new caller that asks for
// "all" -- a page, an action -- would hand one company everyone's data.
test("only the nightly cron route asks for every company's data", () => {
  const callers = sourceFiles(SRC)
    .filter((f) => /\b(buildBackup|countBackupRows)\(\s*"all"\s*\)/.test(readFileSync(f, "utf8")))
    .map((f) => relative(SRC, f).split("\\").join("/"));
  assert.deepEqual(callers, ["app/api/cron/backup/route.ts"]);
});

test("the Settings download and page pass the current company", () => {
  const action = readFileSync(join(SRC, "lib/actions/backup.ts"), "utf8");
  const page = readFileSync(join(SRC, "app/(app)/settings/backup/page.tsx"), "utf8");
  assert.match(action, /buildBackup\(\{ companyId: profile\.company_id \}\)/);
  assert.match(page, /countBackupRows\(\{ companyId: profile\.company_id \}\)/);
});

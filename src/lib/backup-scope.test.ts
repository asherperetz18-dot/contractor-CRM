import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKUP_LEFT_OUT, BACKUP_TABLES, companyScopeColumn, withoutSecrets } from "./backup-scope.ts";

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

/**
 * Every table that holds a company's rows, read from the database files
 * themselves: created with a company_id column, or given one later.
 */
function companyTables(): Set<string> {
  const dir = fileURLToPath(new URL("../../supabase/", import.meta.url));
  const files = [join(dir, "schema.sql"), ...readdirSync(join(dir, "migrations")).map((f) => join(dir, "migrations", f))];
  const found = new Set<string>();
  for (const file of files) {
    const sql = readFileSync(file, "utf8").replace(/--[^\n]*/g, "");
    for (const m of sql.matchAll(/create table (?:if not exists )?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
      if (/\bcompany_id\b/.test(m[2])) found.add(m[1].toLowerCase());
    }
    for (const m of sql.matchAll(/alter table (?:only )?(?:if exists )?(?:public\.)?(\w+)\s+add column (?:if not exists )?company_id\b/gi)) {
      found.add(m[1].toLowerCase());
    }
  }
  return found;
}

test("every table that holds a company's rows is in the backup, or left out on purpose", () => {
  const tables = companyTables();
  assert.ok(tables.size > 50, `found ${tables.size} company tables`);
  const covered = new Set<string>([...BACKUP_TABLES, ...Object.keys(BACKUP_LEFT_OUT)]);
  const forgotten = [...tables].filter((t) => !covered.has(t)).sort();
  assert.deepEqual(forgotten, [], "add these to BACKUP_TABLES, or to BACKUP_LEFT_OUT with the reason");
  // And nothing is both.
  for (const t of Object.keys(BACKUP_LEFT_OUT)) assert.ok(!(BACKUP_TABLES as readonly string[]).includes(t), t);
});

test("the business data that had fallen out of the backup is in it now", () => {
  for (const t of ["vendor_bills", "vendor_bill_payments", "payment_accounts", "rep_commission_payouts", "marketing_spend", "time_punches", "ai_receptionist_calls", "lead_shared_notes"]) {
    assert.ok((BACKUP_TABLES as readonly string[]).includes(t), t);
  }
  // A table comes after the ones it points at, so a restore can load in order.
  const at = (t: string) => (BACKUP_TABLES as readonly string[]).indexOf(t);
  assert.ok(at("payment_accounts") < at("vendor_bill_payments"));
  assert.ok(at("vendor_bills") < at("vendor_bill_payments"));
  assert.ok(at("time_punches") < at("time_punch_changes"));
  assert.ok(at("vendors") < at("vendor_bills") && at("estimates") < at("rep_commission_payouts"));
});

test("a platform admin can export any one company; nobody else can choose the company", () => {
  const action = readFileSync(join(SRC, "lib/actions/backup.ts"), "utf8");
  const fn = action.slice(action.indexOf("export async function exportCompanyData"));
  const guard = fn.indexOf("isPlatformAdmin(profile)");
  assert.ok(guard > 0 && guard < fn.indexOf("buildBackup("), "checked before anything is read");
  // One company, never everyone's.
  assert.match(fn, /buildBackup\(\{ companyId: company\.id \}\)/);
});

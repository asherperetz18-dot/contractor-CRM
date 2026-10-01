import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

/**
 * 0175's restrictive billing_lock policy is stamped onto the tenant
 * tables that exist when apply_billing_lock_policies() runs. A table a
 * later migration creates is unlocked until some migration at or after
 * it calls the function again -- 0182 and 0183 both forgot, and a lapsed
 * company could still read those two tables through the API. This holds
 * every future migration to the rule (TECH_DEBT, DECISIONS #075).
 */

const DIR = new URL("../../../supabase/migrations/", import.meta.url);
const LOCK_MIGRATION = 175;
// The tables the function itself skips, so the lock screen can still
// tell who is signed in (0175).
const NEVER_LOCKED = new Set(["company_members", "profiles", "company_billing", "signup_invites"]);

const migrations = readdirSync(DIR)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort()
  .map((file) => ({ file, n: Number(file.slice(0, 4)), sql: readFileSync(new URL(file, DIR), "utf8") }));

const callsLock = (sql: string) => /select\s+public\.apply_billing_lock_policies\(\)\s*;/i.test(sql);

test("every company table made after 0175 is followed by a billing-lock call", () => {
  const unlocked: string[] = [];
  for (const m of migrations.filter((x) => x.n > LOCK_MIGRATION)) {
    for (const [, table, body] of m.sql.matchAll(/create table (?:if not exists )?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
      if (NEVER_LOCKED.has(table) || !/\bcompany_id\s+uuid\b/i.test(body)) continue;
      const locked = migrations.some((later) => later.n >= m.n && callsLock(later.sql));
      if (!locked) unlocked.push(`${m.file}: ${table}`);
    }
  }
  assert.deepEqual(unlocked, [], "add `select public.apply_billing_lock_policies();` at the end of the migration");
});

test("the check sees the tables it is meant to (0176's payment_accounts locks itself)", () => {
  const m = migrations.find((x) => x.file.startsWith("0176_"));
  assert.ok(m && /create table if not exists payment_accounts/.test(m.sql) && callsLock(m.sql));
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

/**
 * A row that names a contact must belong to that contact's company.
 * RLS checks the row's own company_id, not the contact's, so an Office
 * user of one company could file an estimate, note or appointment under
 * another company's contact -- and admin-client code (the no-show cron,
 * estimate emails) then trusted that contact id. 0189's
 * lead_in_same_company trigger refuses such a row, for every caller.
 * apply_lead_company_checks() stamps it on the tables that exist when it
 * runs, so a later table with a lead reference needs it called again --
 * the same shape as the billing lock (billing-lock-migrations.test.ts).
 */

const DIR = new URL("../../../supabase/migrations/", import.meta.url);
const CHECK_MIGRATION = 189;

const migrations = readdirSync(DIR)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort()
  .map((file) => ({ file, n: Number(file.slice(0, 4)), sql: readFileSync(new URL(file, DIR), "utf8") }));

const callsCheck = (sql: string) => /select\s+public\.apply_lead_company_checks\(\)\s*;/i.test(sql);

test("0189 defines the trigger and stamps it on today's tables", () => {
  const m = migrations.find((x) => x.n === CHECK_MIGRATION);
  assert.ok(m, "supabase/migrations/0189_*.sql is missing");
  assert.match(m.sql, /create or replace function public\.lead_in_same_company\(\)/i);
  assert.match(m.sql, /security definer/i, "the check must see the contact whatever the caller's RLS hides");
  assert.match(m.sql, /create or replace function public\.apply_lead_company_checks\(\)/i);
  assert.ok(callsCheck(m.sql), "0189 must run apply_lead_company_checks()");
});

test("every table made after 0189 with a lead reference is followed by the check", () => {
  const unchecked: string[] = [];
  for (const m of migrations.filter((x) => x.n > CHECK_MIGRATION)) {
    for (const [, table, body] of m.sql.matchAll(/create table (?:if not exists )?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
      if (!/references\s+(?:public\.)?leads\s*\(/i.test(body) || !/\bcompany_id\s+uuid\b/i.test(body)) continue;
      const checked = migrations.some((later) => later.n >= m.n && callsCheck(later.sql));
      if (!checked) unchecked.push(`${m.file}: ${table}`);
    }
  }
  assert.deepEqual(unchecked, [], "add `select public.apply_lead_company_checks();` at the end of the migration");
});

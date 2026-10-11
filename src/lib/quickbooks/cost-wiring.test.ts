import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Step 4 (DECISIONS #199): lender fees go to QuickBooks as expenses. Every
 * check on source text for step 4 lives here -- the migration, where the
 * lender's-fee mark is set, and (as later parts land) the job, its screens
 * and its wiring -- so they're found in one place.
 */

const source = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const SRC = fileURLToPath(new URL("../../", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    // App code only: tests name these things to check them.
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** One exported function's text, from its header to the next export. */
function body(text: string, name: string): string {
  const start = text.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} is there`);
  const next = text.indexOf("\nexport ", start + 1);
  return text.slice(start, next < 0 ? undefined : next);
}

// ---------------------------------------------------------------- the database (0230)

test("0230 adds what step 4 records", () => {
  const sql = source("../../../supabase/migrations/0230_quickbooks_job_costs.sql");
  // Its own switch and start date, when the job last looked and its claim, and where lender payouts land.
  assert.match(sql, /add column if not exists send_costs boolean not null default false/);
  assert.match(sql, /add column if not exists send_costs_from date/);
  assert.match(sql, /add column if not exists costs_checked_at timestamptz/);
  assert.match(sql, /add column if not exists costs_claimed_until timestamptz/);
  assert.match(sql, /add column if not exists lender_payouts_account_id text/);
  // The mark, and the fees Funded saved before it existed (PR #404 onwards).
  assert.match(sql, /add column if not exists lender_fee boolean not null default false/);
  assert.match(
    sql,
    /update public\.job_expenses\s+set lender_fee = true\s+where source = 'manual'\s+and category = 'Financing fee'\s+and created_at >= '2026-10-07 15:50:58\+00'\s+and lender_fee is not true;/
  );
  // Only the server sets it: the guard runs as the caller, so a signed-in person's insert or change can't.
  const guard = sql.slice(
    sql.indexOf("create or replace function public.job_expenses_lender_fee_guard()"),
    sql.indexOf("as $$", sql.indexOf("create or replace function public.job_expenses_lender_fee_guard()"))
  );
  assert.match(guard, /returns trigger/);
  assert.doesNotMatch(guard, /security definer/i);
  assert.match(sql, /if current_user in \('authenticated', 'anon'\) then/);
  assert.match(sql, /if tg_op = 'INSERT' then\s+new\.lender_fee := false;\s+else\s+new\.lender_fee := old\.lender_fee;/);
  // A server insert of a fee from after the cutoff without the mark (an older build, an old trash snapshot) gets it.
  assert.match(
    sql,
    /elsif tg_op = 'INSERT'\s+and new\.source = 'manual'\s+and new\.category = 'Financing fee'\s+and new\.created_at >= '2026-10-07 15:50:58\+00' then\s+(--[^\n]*\n\s*)*new\.lender_fee := true;/
  );
  assert.match(sql, /before insert or update of lender_fee on public\.job_expenses/);
  assert.match(sql, /revoke all on function public\.job_expenses_lender_fee_guard\(\) from public, anon, authenticated;/);
  // The guard comes after the backfill, so the backfill isn't held to it.
  assert.ok(sql.indexOf("set lender_fee = true") < sql.indexOf("create trigger job_expenses_lender_fee_guard"));
  assert.match(sql, /create index if not exists job_expenses_manual_day_idx\s+on public\.job_expenses \(company_id, spent_on\) where source = 'manual';/);
  // The customer a cost's records were on, so a deleted customer's expenses are told apart from Edit deletes.
  assert.match(sql, /alter table public\.quickbooks_sync\s+add column if not exists lead_id uuid;/);
  assert.doesNotMatch(sql, /lead_id uuid references/);
  assert.match(sql, /select public\.apply_billing_lock_policies\(\);/);
  assert.match(sql, /as quickbooks_job_costs_ready;/);
});

test("0230's list of record types is the CRM's: all 13", () => {
  const sql = source("../../../supabase/migrations/0230_quickbooks_job_costs.sql");
  const check = /add constraint quickbooks_sync_record_type_check check \(record_type in \(([^)]*)\)\)/.exec(sql);
  assert.ok(check, "the check is there");
  const inSql = [...check[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  const expected = [
    "bill", "bill_payment", "receipt",
    "customer", "job", "invoice", "deposit", "customer_payment", "credit", "credit_link", "refund",
    "expense", "expense_receipt",
  ];
  assert.deepEqual(inSql, expected);
  // The same list as RecordType, so a record the job keeps is never refused by the database.
  const status = source("./bill-status.ts");
  const union = /export type RecordType =([^;]*);/.exec(status);
  assert.ok(union, "RecordType is there");
  assert.deepEqual([...union[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort(), [...expected].sort());
});

// ---------------------------------------------------------------- the mark

test("Funded marks the lender's fee it saves, and still saves it before 0230", () => {
  const funded = body(source("../actions/financing.ts"), "recordFinancingStatus");
  assert.match(funded, /lender_fee: true,/);
  assert.match(funded, /let \{ error: feeError \} = await admin\.from\("job_expenses"\)\.insert\(feeRow\);/);
  // Without the column the insert is tried again without the mark (0230's backfill marks it later).
  assert.match(
    funded,
    /if \(feeError && isMissingSchemaError\(feeError\)\) \{\s*delete feeRow\.lender_fee;\s*\(\{ error: feeError \} = await admin\.from\("job_expenses"\)\.insert\(feeRow\)\);\s*\}/
  );
  // Bills to Pay lists the fee under Paid on entry, so it's refreshed too.
  assert.match(funded, /if \(feeRecorded\) \{\s*revalidatePath\("\/profit-loss"\);\s*revalidatePath\("\/bills"\);\s*\}/);
});

test("only Funded and Bills to Pay add job costs; the dead createJobExpense is gone", () => {
  const inserters: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, "utf8");
    assert.ok(!text.includes("createJobExpense"), `${relative(SRC, file)} names createJobExpense`);
    for (const m of text.matchAll(/\.from\(\s*["'`]job_expenses["'`]\s*\)/g)) {
      // The rest of that statement.
      const end = text.indexOf(";", m.index);
      const statement = text.slice(m.index, end < 0 ? undefined : end);
      if (/\.(insert|upsert)\(/.test(statement)) inserters.push(relative(SRC, file).split("\\").join("/"));
    }
  }
  // A 'manual' "Financing fee" cost the server inserts is marked by 0230's trigger, so no other place may insert one.
  assert.deepEqual([...new Set(inserters)].sort(), ["lib/actions/financing.ts", "lib/actions/vendor-bills.ts"]);
});

// ---------------------------------------------------------------- the pure parts

test("the job-cost chips and wordings stay safe for the browser: no node:crypto, only bill-status", () => {
  // Bills to Pay's browser code shows the chips, so this file mustn't pull in anything server-only.
  const status = source("./cost-status.ts");
  const imports = [...status.matchAll(/^import [^;]*? from "([^"]+)";/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ["./bill-status.ts"]);
  assert.doesNotMatch(status, /["']node:|["']server-only["']/);
  // The planner hashes, so it may use node:crypto; it shares the wordings rather than copying them.
  const plan = source("./cost-sync.ts");
  assert.match(plan, /from "\.\/cost-status\.ts";/);
  assert.doesNotMatch(plan, /"The CRM doesn't know what paid for this cost/);
});

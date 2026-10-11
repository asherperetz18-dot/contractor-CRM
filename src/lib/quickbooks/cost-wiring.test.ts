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

// ---------------------------------------------------------------- the job (cost-sync-run.ts)

/** The `{ … }` block that opens at the first "{" at or after `from`, braces balanced. */
function block(text: string, from: number): string {
  const open = text.indexOf("{", from);
  assert.ok(open >= 0, "a block opens");
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    if (text[i] === "}" && --depth === 0) return text.slice(open, i + 1);
  }
  assert.fail("the block closes");
}

/** Every `Promise.all([ … ])` in the text, brackets balanced. */
function promiseAlls(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/Promise\.all\(\[/g)) {
    let depth = 0;
    for (let i = m.index + "Promise.all(".length; i < text.length; i += 1) {
      if (text[i] === "[") depth += 1;
      if (text[i] === "]" && --depth === 0) {
        out.push(text.slice(m.index, i + 1));
        break;
      }
    }
  }
  return out;
}

test("the job-costs job claims the company, keeps to its QuickBooks company, and never adds an expense twice", () => {
  const run = source("./cost-sync-run.ts");
  assert.match(run, /^import "server-only";/);
  assert.match(run, /export async function syncCompanyCosts\(/);
  assert.match(run, /costs_claimed_until/);
  assert.match(run, /\.eq\("realm_id", realmId\)/);
  assert.match(run, /planCostSync\(/);
  assert.match(run, /quickBooksAccess\(/);
  // The exact request is written down before an add goes, and repeated (same id) if no answer came.
  assert.match(run, /requestId: newRequestId\(\)/);
  assert.match(run, /case "resolve":/);
  // A lender fee's receipt is downloaded from storage, cut off with the run, and attached to the expense.
  assert.match(run, /storage\.from\(RECEIPT_BUCKET\)\.download\(/);
  assert.match(run, /\.download\(path, \{\}, \{ signal \}\)/);
  assert.match(run, /entity: "Purchase"/);
  // A fee deleted with its receipt: QuickBooks' closing date is checked before the receipt is touched.
  assert.match(run, /forDelete/);
  // A failed read stops the run: never read as "nothing sent" or "every cost deleted".
  assert.doesNotMatch(run, /selectAll/);
  // Bills' job is its own: only its summary's shape is borrowed.
  assert.deepEqual(
    [...run.matchAll(/^import ([^;]*?) from "\.\/bill-sync-run";/gm)].map((m) => m[1]),
    ["type { BillSyncSummary }"]
  );
  // Customers and jobs are the invoices job's to add (DECISIONS #184).
  assert.doesNotMatch(run, /createSales\(|findCustomer\(/);
});

test("the job-costs job uses the Financing fee match only, never the default account (decision 4)", () => {
  const run = source("./cost-sync-run.ts");
  assert.match(run, /\.eq\("category_key", categoryKey\("Financing fee"\)\)/);
  assert.doesNotMatch(run, /category_key === ""/);
  assert.doesNotMatch(run, /\.eq\("category_key", ""\)/);
  // "Lender payouts land in" counts only while QuickBooks still lists it as a Bank account (decision 3).
  assert.match(run, /payoutAccountOf\(/);
});

test("the job-costs job only reads job costs: it never writes one, nor locks one from editing", () => {
  const run = source("./cost-sync-run.ts");
  for (const m of run.matchAll(/\.from\(\s*"job_expenses"\s*\)/g)) {
    const end = run.indexOf(";", m.index);
    const statement = run.slice(m.index, end < 0 ? undefined : end);
    assert.doesNotMatch(statement, /\.(update|insert|upsert|delete)\(/, statement);
  }
  // qb_txn_id / qb_txn_type lock a cost from ✎ Edit (expense-edit.ts).
  assert.doesNotMatch(run, /qb_txn_id|qb_txn_type/);
});

test("QuickBooks' closing date is read fresh (or the invoices job's, under 10 minutes old); a failed read stops before anything", () => {
  const run = source("./cost-sync-run.ts");
  assert.match(run, /closeDateFor\(/);
  const read = run.indexOf("readPreferences(");
  assert.ok(read >= 0, "readPreferences is called");
  // Before the records are read: a run never goes on as if the books were open.
  assert.ok(read < run.indexOf('from("quickbooks_sync")'), "the closing date comes before the records");
  const failed = block(run, run.indexOf('if ("error" in ', read));
  assert.match(failed, /return \{ \.\.\.summary, error:/);
  // Read under the claim, so a busy run doesn't read it.
  assert.ok(run.indexOf("costs_claimed_until") < read);
});

test("a deleted customer's expenses are never deleted in QuickBooks: trash before the costs, leads and trash again after", () => {
  const run = source("./cost-sync-run.ts");
  const trash = [...run.matchAll(/from\("lead_trash"\)/g)].map((m) => m.index);
  assert.equal(trash.length, 2, "lead_trash is read twice");
  const costs = [...run.matchAll(/from\("job_expenses"\)/g)].map((m) => m.index);
  assert.ok(costs.length >= 1, "the costs are read");
  const leads = [...run.matchAll(/from\("leads"\)/g)].map((m) => m.index);
  assert.ok(leads.length >= 1, "the customers are read");
  // The records first (whose customers the trash is checked for), then the trash, then the costs.
  assert.ok(run.indexOf('from("quickbooks_sync")') < trash[0]);
  assert.ok(trash[0] < Math.min(...costs), "the first trash read comes before the costs");
  // A customer deleted meanwhile reads as gone, never as costs deleted with ✎ Edit.
  for (const at of leads) assert.ok(at > Math.max(...costs), "the customers are read after the costs");
  assert.ok(trash[1] > Math.max(...costs), "the second trash read comes after the costs");
  // Never at the same time as the costs: a read that starts first may finish last.
  for (const all of promiseAlls(run)) {
    if (!all.includes('from("job_expenses")')) continue;
    assert.doesNotMatch(all, /from\("leads"\)|from\("lead_trash"\)/, all);
  }
});

test("a cost whose customer is deleted after the costs were read is left alone that run", () => {
  const run = source("./cost-sync-run.ts");
  // Planned, it would go without its customer's name in the memo: a change sent for a deleted customer.
  assert.match(run, /const leftAlone = costRows\.filter\(\(x\) => !leadById\.has\(x\.lead_id\)\)\.map\(\(x\) => x\.id\);/);
  // Like a bill's cost: no step for it or its records; next run reads it gone with its customer.
  assert.match(run, /billCosts: new Set\(\[\.\.\.billCosts, \.\.\.leftAlone\]\),/);
  const shaped = run.slice(run.indexOf("const costs: SyncCost[] = costRows"), run.indexOf("const steps = planCostSync("));
  assert.match(shaped, /\.filter\(\(x\) => x\.source === "manual" && !billCosts\.has\(x\.id\) && !leftAlone\.includes\(x\.id\)\)/);
});

// ---------------------------------------------------------------- step 3 adds their customers and jobs (invoice-sync-run.ts)

test("the invoices job adds and keeps the customers and jobs sent job costs are tagged with", () => {
  const run = source("./invoice-sync-run.ts");
  // Every cost already in QuickBooks, whatever bills' switch says: only the invoices job adds customers and jobs.
  assert.match(run, /record_type === "expense" && inQuickBooks\(r\)/);
  const sentCosts = run.indexOf("const sentCosts = ");
  assert.ok(sentCosts >= 0, "the sent costs are listed");
  const read = run.slice(sentCosts, run.indexOf("links.set(id, link)", sentCosts));
  assert.doesNotMatch(read, /send_bills|send_costs/);
  // Read by id, in this company only (a database without 0230 has no such records, so reads nothing).
  assert.match(
    read,
    /admin\.from\("job_expenses"\)\.select\("id, lead_id, estimate_payment_id"\)\.eq\("company_id", companyId\)\.in\("id", chunk\)/
  );
  // Linked to their jobs the way bills are (bill-jobs.ts), into the same list the plan gets.
  assert.match(run, /for \(const \[id, link\] of await billJobLinks\(admin, companyId, costRows\)\) links\.set\(id, link\);/);
  // Before the contracts and customers behind the links are read, so theirs load too.
  const merged = run.indexOf("links.set(id, link)");
  assert.ok(merged > run.indexOf("const links = await billJobLinks("), "bills' links come first");
  assert.ok(merged < run.indexOf("await loadDocs([...links.values()]"), "merged before the contracts are read");
  assert.ok(merged < run.indexOf("const leadIds = "), "merged before the customers are read");
  // The invoices job only reads job costs: it never writes one (that would lock it from ✎ Edit).
  for (const m of run.matchAll(/\.from\(\s*"job_expenses"\s*\)/g)) {
    const end = run.indexOf(";", m.index);
    assert.doesNotMatch(run.slice(m.index, end < 0 ? undefined : end), /\.(update|insert|upsert|delete)\(/);
  }
});

// ---------------------------------------------------------------- the five-minute job and Send now

test("the five-minute job sends lender fees last, after invoices and bills, and still runs bills and invoices before 0230", () => {
  const route = source("../../app/api/cron/quickbooks-sync/route.ts");
  assert.match(route, /^import \{ syncCompanyCosts \} from "@\/lib\/quickbooks\/cost-sync-run";$/m);
  // Every company that turned on any of the three.
  assert.match(route, /\.select\("company_id, send_bills, send_invoices, send_costs"\)/);
  assert.match(route, /\.or\("send_bills\.eq\.true,send_invoices\.eq\.true,send_costs\.eq\.true"\)/);
  // Before 0230 there's no job-costs switch, and before 0227 no invoices switch: the older reads, tried in that order.
  const tiers = [
    route.indexOf('"send_bills.eq.true,send_invoices.eq.true,send_costs.eq.true"'),
    route.indexOf('.or("send_bills.eq.true,send_invoices.eq.true")'),
    route.indexOf('.eq("send_bills", true)'),
  ];
  assert.ok(tiers.every((at) => at >= 0), "all three reads are there");
  assert.ok(tiers[0] < tiers[1] && tiers[1] < tiers[2], "newest first, each tried only when the one before it failed");
  assert.match(route, /const both = all\.error\s*\?/);
  assert.match(route, /const \{ data, error \} = both\.error\s*\?/);
  // Invoices add the jobs the others are tagged with, so they go first; then bills; then lender fees.
  const invoices = route.indexOf("syncCompanyInvoices(admin");
  const bills = route.indexOf("syncCompanyBills(admin");
  const costs = route.indexOf("syncCompanyCosts(admin");
  assert.ok(invoices >= 0 && bills >= 0 && costs >= 0, "all three jobs run");
  assert.ok(invoices < bills && bills < costs, "invoices, then bills, then job costs");
  assert.match(
    route,
    /if \(company\.send_costs && \(!ran \|\| room\(\)\)\) add\(await syncCompanyCosts\(admin, company\.company_id, \{ budgetMs: budget\(\), fetchImpl \}\)\);/
  );
  // A company's 90 seconds are split between the jobs it has on (1: 90 s, 2: 45 s, 3: 30 s).
  assert.match(route, /const jobs = \[company\.send_invoices, company\.send_bills, company\.send_costs\]\.filter\(Boolean\)\.length;/);
  assert.match(route, /Math\.min\(Math\.floor\(90_000 \/ Math\.max\(1, jobs\)\), 230_000 - \(Date\.now\(\) - started\)\)/);
});

test("Send now for job costs: Office or Admin, never while locked, at once and with refusals tried again", () => {
  const actions = source("../actions/quickbooks.ts");
  assert.match(actions, /^import \{ syncCompanyCosts \} from "@\/lib\/quickbooks\/cost-sync-run";$/m);
  const send = body(actions, "sendCostsToQuickBooksNow");
  assert.match(send, /^export async function sendCostsToQuickBooksNow\(\): Promise<SendNowResult> \{/);
  const who = send.indexOf("officeAdmin()");
  const locked = send.indexOf("isCompanyLocked(");
  const run = send.indexOf("syncCompanyCosts(who.admin, companyId, { writeCap: 40, budgetMs: 20_000, force: true })");
  assert.ok(who >= 0 && locked > who && run > locked, "who's asking, then the lock, then the run");
  // Settings and Bills to Pay show the new chips and counts, even when the run threw.
  const after = block(send, send.indexOf("finally"));
  assert.match(after, /revalidatePath\("\/settings\/quickbooks"\);/);
  assert.match(after, /revalidatePath\("\/bills"\);/);
  assert.match(send, /"QuickBooks is already sending this company's job costs\. Look again in a minute\."/);
  // Only job costs: a brand-new fee goes untagged anyway, and its job follows on the next five-minute run.
  assert.doesNotMatch(send, /syncCompanyInvoices\(|syncCompanyBills\(/);
});

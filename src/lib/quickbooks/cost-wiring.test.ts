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

// ---------------------------------------------------------------- Settings › QuickBooks (actions/quickbooks.ts and its view)

/** A top-level function's text, from its header to its closing brace at the start of a line. */
function fn(text: string, header: string): string {
  const start = text.indexOf(header);
  assert.ok(start >= 0, `${header} is there`);
  const end = text.indexOf("\n}\n", start);
  return text.slice(start, end < 0 ? undefined : end + 2);
}

/** Each `admin.from(…)…` statement in the text, up to its `;`. */
function statements(text: string): string[] {
  return [...text.matchAll(/\.from\("/g)].map((m) => {
    const end = text.indexOf(";", m.index);
    return text.slice(m.index, end < 0 ? undefined : end);
  });
}

test("Settings reads job costs' switch and picks on their own, and says to run 0230 until it's there", () => {
  const actions = source("../actions/quickbooks.ts");
  assert.match(actions, /const NEEDS_0230 = "Sending job costs needs a database update first: run 0230_quickbooks_job_costs\.sql in Supabase\.";/);
  assert.match(actions, /const COST_TYPES = \["expense", "expense_receipt"\];/);
  assert.match(actions, /^ {2}costs: QuickBooksCostSending;$/m);
  const read = fn(actions, "async function readCostSending(");
  // Its own read: a database without 0230 still shows bills and invoices.
  assert.match(read, /\.select\("send_costs, send_costs_from, costs_checked_at, lender_payouts_account_id"\)/);
  assert.match(read, /if \(error\) return \{ \.\.\.off, ready: !isMissingSchemaError\(error\) \};/);
  // "Lender payouts land in": bank accounts only (decision 3).
  assert.match(read, /bank: accounts\.filter\(\(a\) => a\.type === "Bank"\)\.sort\(/);
  // Counted only for the connected QuickBooks company.
  assert.match(read, /if \(!realmId\) return base;/);
  // Every read is this company's, and every record read is for its QuickBooks company.
  const reads = statements(read);
  assert.ok(reads.length >= 6, "the switch, the records, customers, trash, costs and vendors are read");
  for (const s of reads) {
    assert.match(s, /\.eq\("company_id", companyId\)/, s);
    if (s.startsWith('.from("quickbooks_sync")')) assert.match(s, /\.eq\("realm_id", realmId\)/, s);
  }
  assert.doesNotMatch(actions, /select\("\*"\)/);
});

test("Settings counts job costs as the tested rule says, and leaves a deleted customer's out", () => {
  const read = fn(source("../actions/quickbooks.ts"), "async function readCostSending(");
  // In QuickBooks: every expense sent (a deleted customer's are still there, so they count).
  assert.match(read, /\.eq\("record_type", "expense"\)\s*\.eq\("status", "sent"\)/);
  // Waiting and Didn't go, from every waiting, refused or gone record, paged (there are few).
  assert.match(read, /\.in\("record_type", COST_TYPES\)\s*\.in\("status", \["waiting", "failed", "gone"\]\)/);
  assert.match(read, /\.range\(at, at \+ 999\)/);
  // Whose customer is gone or in the trash: not counted or listed. Both read, or nothing is left out.
  assert.match(read, /from\("leads"\)/);
  assert.match(read, /from\("lead_trash"\)/);
  assert.match(read, /const goneLeads = leads && trash \? new Set\(\[\.\.\.leadIds\.filter\(\(id\) => !leadById\.has\(id\)\), \.\.\.trash\.map\(\(t\) => t\.lead_id\)\]\) : null;/);
  assert.match(read, /const \{ waiting, failed, attention: open \} = costTrouble\(rows, goneLeads\);/);
  assert.match(read, /counts: \{ sent, waiting, failed \}/);
  // Named by its cost: "Home Depot · $412.37 on Oct 2 · Rachel Kim". A cost that couldn't be read isn't called deleted.
  assert.match(read, /\.select\("id, vendor, vendor_id, amount_cents, spent_on, lead_id"\)/);
  assert.match(read, /deleted: !!costs && !cost,/);
  assert.match(read, /\|\| "A cost"/);
});

test("Settings lists Financing fee under Where job costs go once 0230 has run, and says whether it's matched", () => {
  const get = body(source("../actions/quickbooks.ts"), "getQuickBooksSettings");
  assert.match(get, /readCostSending\(admin, companyId, connection\?\.connected \? connection\.realmId : null, connection\?\.accounts \?\? \[\]\)/);
  // Matched before the first fee, or before the switch goes on: fees never fall back to the default (decision 4).
  assert.match(get, /\.\.\.\(costs\.ready \? \["Financing fee"\] : \[\]\)/);
  assert.match(get, /costs: \{ \.\.\.costs, feeMatched: matched\.has\(categoryKey\("Financing fee"\)\) \}/);
});

test("saving job costs' switch: Office or Admin, connected, after 0230; a start date and no lock only to turn it on", () => {
  const actions = source("../actions/quickbooks.ts");
  const save = body(actions, "saveQuickBooksCostSending");
  assert.match(save, /^export async function saveQuickBooksCostSending\(input: CostSendingInput\): Promise<\{ error\?: string \}> \{/);
  assert.match(actions, /export type CostSendingInput = \{ on: boolean; from: string \| null; lenderPayoutsAccount: string \| null \};/);
  const who = save.indexOf("officeAdmin()");
  const connected = save.indexOf('return { error: "Connect QuickBooks first." }');
  const ready = save.indexOf("if (!current.ready) return { error: NEEDS_0230 };");
  const on = save.indexOf("if (input.on)");
  const write = save.indexOf(".update(");
  assert.ok(who >= 0 && connected > who && ready > connected && on > ready && write > on, "who, connected, 0230, then the checks to turn it on, then the save");
  const turningOn = block(save, on);
  assert.match(turningOn, /isCompanyLocked\(/);
  assert.match(turningOn, /if \(!isDay\(input\.from\)\) return \{ error: "Pick the date job costs start from\." \};/);
  // Only then: turning it off works on a locked company, and needs no date.
  assert.doesNotMatch(save.slice(0, on) + save.slice(on + turningOn.length), /isCompanyLocked\(|isDay\(/);
  // The payout account isn't needed to turn it on: fees wait until it's picked (decision 3).
  assert.doesNotMatch(turningOn, /lenderPayoutsAccount/);
  // A bank account QuickBooks lists, or none.
  assert.match(save, /lender_payouts_account_id: pick\(input\.lenderPayoutsAccount, bankIds\),/);
  assert.match(save, /send_costs: !!input\.on,/);
  assert.match(save, /send_costs_from: input\.on \? input\.from : undefined,/);
  assert.match(save, /\.eq\("company_id", companyId\)/);
  assert.match(save, /if \(error\) return \{ error: isMissingSchemaError\(error\) \? NEEDS_0230 : error\.message \};/);
  assert.match(save, /revalidatePath\("\/settings\/quickbooks"\);/);
  assert.match(save, /revalidatePath\("\/bills"\);/);
});

const settingsView = () => source("../../app/(app)/settings/quickbooks/quickbooks-view.tsx");

test("the job-costs card sits after invoices and before the matches, on this side of Intuit only", () => {
  const view = settingsView();
  const invoices = view.indexOf("{connected && !otherSide && <InvoiceSending settings={settings} />}");
  const costs = view.indexOf("{connected && !otherSide && <JobCostSending settings={settings} />}");
  const matches = view.indexOf("{connected && !otherSide && <MatchForm settings={settings} />}");
  assert.ok(invoices >= 0 && costs > invoices && matches > costs);
});

test("the job-costs card says what goes (lender fees) and what's entered by hand (other costs), as decision 6 has it", () => {
  const card = fn(settingsView(), "function JobCostSending(");
  assert.match(card, /<h2 className="est-pay-title">Send job costs to QuickBooks<\/h2>/);
  assert.match(
    card,
    /\{!k\.ready && <p className="error-note">Sending job costs needs a database update first: run 0230_quickbooks_job_costs\.sql in Supabase\.<\/p>\}/
  );
  assert.match(card, /<strong>Lender fees and other job costs<\/strong>/);
  assert.match(
    card,
    /On: each lender fee goes to QuickBooks as an expense on its job a few minutes after it&apos;s saved\. Other costs under Bills to Pay › Paid ›\s+&ldquo;Paid on entry&rdquo; dated from the start date say to enter them in QuickBooks by hand\./
  );
  // The mockup's "each one goes" isn't true: other "Already paid" costs never go.
  assert.doesNotMatch(card, /each one goes/i);
  assert.match(card, /aria-label="Send job costs to QuickBooks"/);
  assert.match(card, /disabled=\{pending \|\| !k\.ready\}/);
});

test("the job-costs card: its start date, the deposit warning, and when a fee's payout doesn't go", () => {
  const card = fn(settingsView(), "function JobCostSending(");
  // First offered: the invoices start date, so a fee and its payout start together.
  assert.match(card, /useState\(k\.from \?\? settings\.invoices\.from \?\? k\.today\)/);
  assert.match(card, /<span className="field-label">Start with job costs dated from<\/span>/);
  assert.match(
    card,
    /Costs dated before this stay out of QuickBooks\. Pick the day your bookkeeper stops entering lender fees by hand\. From then on,\s+deposit each lender payout in QuickBooks at its full amount: the fee goes as its own expense\./
  );
  // Against the invoices card as saved: a payout that isn't sent may be entered net of its fee.
  assert.match(
    card,
    /\{!settings\.invoices\.on \? \(\s*<p className="est-tax-note">\s*Sending invoices is off, so lender payouts don&apos;t go to QuickBooks\. Whoever enters a payout there by hand must enter it at\s+its full amount, or its fee is counted twice\.\s*<\/p>\s*\) : settings\.invoices\.from && from < settings\.invoices\.from \? \(/
  );
  assert.match(
    card,
    /`Invoices go from \$\{fmtDate\(settings\.invoices\.from\)\}\. A fee dated before then goes, but its payout doesn't: enter that payout in QuickBooks by hand at its full amount, or the fee is counted twice\.`/
  );
});

test("the job-costs card: where lender payouts land (bank accounts), and what fees wait for", () => {
  const card = fn(settingsView(), "function JobCostSending(");
  assert.match(card, /<span>Lender payouts land in<\/span>/);
  assert.match(card, /pick\(payout, setPayout, k\.choices\.bank, "Where lender payouts land", "Pick an account"\)/);
  assert.match(
    card,
    /The bank account your lenders pay into\. Each fee comes out of it, so the full payout minus the fee matches the bank\. Bank\s+accounts only\./
  );
  assert.match(card, /\{k\.on && !k\.lenderPayoutsAccount && <p className="est-tax-note">Lender fees wait until you pick where lender payouts land\.<\/p>\}/);
  assert.match(
    card,
    /\{k\.on && !k\.feeMatched && \(\s*<p className="est-tax-note">\s*Lender fees wait until &ldquo;Financing fee&rdquo; is matched under &ldquo;Where job costs go&rdquo; below\.\s*<\/p>\s*\)\}/
  );
  // Saved: the switch, the date, and the payout account.
  assert.match(card, /const changed = on !== k\.on \|\| \(on && from !== k\.from\) \|\| payout !== \(k\.lenderPayoutsAccount \?\? ""\);/);
  assert.match(card, /saveQuickBooksCostSending\(\{ on, from: on \? from : null, lenderPayoutsAccount: payout \|\| null \}\)/);
  assert.match(card, /disabled=\{pending \|\| !k\.ready \|\| \(on && !from\)\}/);
});

test("the job-costs card: counts, Needs a look named by vendor and customer, Send now and Last checked", () => {
  const card = fn(settingsView(), "function JobCostSending(");
  assert.match(card, /\{k\.on && \(/);
  assert.match(card, /<b>\{k\.counts\.sent\}<\/b>/);
  assert.match(card, /<b>\{k\.counts\.waiting\}<\/b>/);
  assert.match(card, /<b>\{k\.counts\.failed\}<\/b>/);
  // "Home Depot · $412.37 on Oct 2 · Rachel Kim"
  assert.match(card, /\{a\.vendor\}\s*\{a\.amountCents !== null \? ` · \$\{money\(a\.amountCents\)\}` : ""\}\s*\{a\.kind === "receipt" \? " receipt" : ""\}/);
  assert.match(card, /\{a\.deleted \? " \(deleted in the CRM\)" : a\.day \? ` on \$\{fmtDate\(a\.day\)\}` : ""\}\s*\{a\.customer \? ` · \$\{a\.customer\}` : ""\}/);
  assert.match(card, /sentMessage\(await sendCostsToQuickBooksNow\(\)\)/);
  assert.match(card, /k\.checkedAt \? `Last checked \$\{ago\(k\.checkedAt\)\}` : "Not checked yet: the first run is within five minutes\."/);
});

test("Settings' plan: job costs are live now; How it works says which costs go and what a delete does", () => {
  const view = settingsView();
  assert.match(
    view,
    /<li className="is-now">\s*<strong>Job costs, including lender fees<\/strong> <span className="est-badge est-badge-signed">Live<\/span>\s*<\/li>/
  );
  assert.match(view, /<li>\s*Customers, invoices and customer payments <span className="est-badge est-badge-signed">Live<\/span>\s*<\/li>/);
  assert.equal([...view.matchAll(/className="is-now"/g)].length, 1);
  assert.match(
    view,
    /Each lender fee goes as an expense on its job: paid out of &ldquo;Lender payouts land in&rdquo;, dated the payout day, not\s+billable\. A customer&apos;s own lender has no fee, so nothing goes for it\. Other &ldquo;Already paid&rdquo; job costs\s+dated from the start date are to be entered by hand: the CRM never recorded what paid for them\./
  );
  assert.match(
    view,
    /A job cost deleted with ✎ Edit is deleted in QuickBooks\. Deleting a customer doesn&apos;t take anything out of QuickBooks,\s+and restoring them sends nothing twice\./
  );
  // After the receipts line.
  assert.ok(view.indexOf("Each lender fee goes as an expense") > view.indexOf("A bill&apos;s receipt (the photo or PDF"));
});

test("Where job costs go: lender fees' category is matched there, and they never land in the default", () => {
  const match = fn(settingsView(), "function MatchForm(");
  const section = match.slice(match.indexOf("Where job costs go"));
  assert.match(
    section,
    /The QuickBooks expense account each cost lands in: bills&apos; costs, and lender fees\. A bill&apos;s cost goes to the default\s+unless you match its category\./
  );
  // Under the table, as the mockup has it, once 0230 has run (the Financing fee row comes with it).
  const table = section.indexOf("</table>");
  const note = section.indexOf(
    "Lender fees wait until &ldquo;Financing fee&rdquo; is matched, so they never land in the default account by mistake."
  );
  assert.ok(table >= 0 && note > table && note < section.indexOf('{error && <p className="error-note">'));
  assert.match(section, /\{settings\.costs\.ready && \(/);
  // The job-costs job adds a lender QuickBooks doesn't have yet, as bills' job adds a vendor.
  assert.match(section, /one QuickBooks doesn&apos;t have yet is added when its first bill or lender fee goes\./);
});

test("the page and the settings list name lender fees", () => {
  assert.match(
    source("../../app/(app)/settings/quickbooks/page.tsx"),
    /<p className="module-sub">Send your bills, invoices, payments and lender fees to QuickBooks Online, so nobody types them twice\.<\/p>/
  );
  assert.match(
    source("../data/settings-catalog.ts"),
    /desc: "Connect QuickBooks Online, match your accounts, and send your bills, invoices, payments and lender fees to your books",/
  );
});

// ---------------------------------------------------------------- Bills to Pay and ✎ Edit

const billsPage = () => source("../../app/(app)/bills/page.tsx");
const billsView = () => source("../../app/(app)/bills/bills-view.tsx");

test("Bills to Pay knows job costs' switch and which costs are lender fees (null before 0230)", () => {
  const status = source("./bill-status.ts");
  const type = status.slice(status.indexOf("export type BillsQuickBooks = {"));
  assert.match(type, /^ {2}costs: \{ sending: boolean; sendFrom: string \| null; fees: string\[\] \| null \} \| null;$/m);
});

test("Bills to Pay reads job costs' switch and the lender fees apart, so a database without 0230 still shows bills", () => {
  const page = billsPage();
  const status = fn(page, "async function quickBooksStatus(");
  // Bills' own read and the other-side line stay as they were.
  assert.match(status, /\.select\("realm_id, environment, disconnected_at, send_bills, send_bills_from"\)/);
  assert.match(status, /if \(onOtherSide\(conn\.environment, quickbooksCredentials\(\)\?\.environment\)\) return null;/);
  // The switch in a read of its own: an error there (no 0230) leaves bills' lines as they are, and no cost lines.
  const at = status.indexOf('.select("send_costs, send_costs_from")');
  assert.ok(at >= 0, "the job-costs switch is read");
  const switchRead = status.slice(status.lastIndexOf(".from(", at), status.indexOf(".maybeSingle", at));
  assert.match(switchRead, /^\.from\("quickbooks_connections"\)/);
  assert.doesNotMatch(switchRead, /realm_id|send_bills/);
  assert.match(switchRead, /\.eq\("company_id", companyId\)/);
  assert.match(
    status,
    /const costs = costConn\.error\s*\? null\s*: \{ sending: !!costConn\.data\?\.send_costs && !conn\.disconnected_at, sendFrom: costConn\.data\?\.send_costs_from \?\? null, fees \};/
  );
  assert.ok(status.indexOf('.select("send_costs, send_costs_from")') > status.indexOf("if (onOtherSide("), "read only on this side of Intuit");
  // Shown when either is sending, or something was sent.
  assert.match(status, /if \(!sending && !costs\?\.sending && !records\.length\) return null;/);
  assert.match(status, /^ {4}costs,$/m);
  // The lender fees: their own read of this company's costs, null when it fails (then a cost not looked at yet says nothing).
  const fees = fn(page, "async function lenderFeeIds(");
  assert.match(fees, /^async function lenderFeeIds\(companyId: string\): Promise<string\[\] \| null> \{/);
  assert.match(fees, /\.from\("job_expenses"\)\s*\.select\("id"\)\s*\.eq\("company_id", companyId\)\s*\.eq\("lender_fee", true\)/);
  assert.match(fees, /if \(error\) return null;/);
  assert.match(fees, /\.range\(from, from \+ 999\)/);
  // The page's own cost list names no 0230 column (selectAll would quietly return nothing before 0230).
  const list = statements(page).find((s) => s.startsWith('.from("job_expenses")') && s.includes("receipt_path"));
  assert.ok(list, "the page lists its costs");
  assert.doesNotMatch(list, /lender_fee/);
});

test("Paid on entry rows show where each cost stands with QuickBooks, with Open in QuickBooks", () => {
  const view = billsView();
  assert.match(view, /<PaidOnEntry[^>]*\bqb=\{qb\}[^>]*\bqbRecord=\{qbRecord\}/);
  const paid = fn(view, "function PaidOnEntry(");
  // Under the vendor and What for, whenever job costs can be read (0230 has run).
  assert.match(paid, /\{qb\?\.costs && \(\s*<CostQbStatus/);
  assert.match(paid, /record=\{qbRecord\.get\(`expense:\$\{r\.id\}`\) \?\? null\}/);
  assert.match(paid, /receipt=\{\{ has: !!r\.receipt_path, record: qbRecord\.get\(`expense_receipt:\$\{r\.id\}`\) \?\? null \}\}/);
  // A cost not looked at yet: a lender fee says it goes, another says to enter it by hand, unknown says nothing.
  assert.match(paid, /fee=\{qb\.costs\.fees \? feeIds\.has\(r\.id\) : null\}/);
  assert.match(paid, /const feeIds = useMemo\(\(\) => new Set\(qb\?\.costs\?\.fees \?\? \[\]\), \[qb\]\);/);
  const chips = fn(view, "function CostQbStatus(");
  assert.match(chips, /costQbChips\(\{/);
  assert.match(chips, /sending: costs\.sending,/);
  assert.match(chips, /sendFrom: costs\.sendFrom,/);
  assert.match(chips, /cost: \{ spentOn: cost\.spent_on, source: cost\.source, lenderFee: fee \},/);
  assert.match(chips, /day: shortDay,/);
  assert.match(chips, /qbWebUrl\(qb\.environment, "expense", qbId, qb\.realmId\)/);
  assert.match(chips, /className=\{`est-badge qb-chip \$\{QB_TONE\[c\.tone\]\}`\} suppressHydrationWarning/);
  assert.match(chips, /Open in QuickBooks ↗/);
});

test("✎ Edit on Bills to Pay is told where the cost's expense stands, from the records the page already has", () => {
  const paid = fn(billsView(), "function PaidOnEntry(");
  const modal = paid.slice(paid.indexOf("<EditPaidBillModal"));
  assert.match(modal, /quickBooks=\{qb\?\.costs \? costQbState\(qbRecord\.get\(`expense:\$\{editing\.id\}`\), qb\.costs\.sending\) : null\}/);
});

test("✎ Edit says when Save and Delete reach QuickBooks, and asks the server when it isn't told", () => {
  const modal = source("../../components/bills/edit-paid-bill-modal.tsx");
  assert.match(modal, /quickBooks\?: CostQbState;/);
  assert.match(modal, /const \[qbState, setQb\] = useState<CostQbState>\(quickBooks \?\? null\);/);
  // Projects › Transactions doesn't say: the window asks (any error leaves it saying nothing).
  const ask = modal.slice(modal.indexOf("jobCostInQuickBooks(expense.id)") - 200, modal.indexOf("jobCostInQuickBooks(expense.id)"));
  assert.match(ask, /if \(quickBooks !== undefined\) return;/);
  assert.match(modal, /jobCostInQuickBooks\(expense\.id\)\s*\.then\(setQb\)\s*\.catch\(\(\) => \{\}\)/);
  // The line, just above Save / Cancel / Delete.
  const note = modal.indexOf('{qbState && <p className="hint-note">{COST_EDIT_NOTE[qbState]}</p>}');
  assert.ok(note >= 0, "the note is there");
  assert.ok(note > modal.indexOf('{error && <p className="error-note">') && note < modal.indexOf('className="btn-primary" onClick={() => void save()}'));
  // Delete says it comes out of QuickBooks too (or will, once sending is on again).
  assert.match(
    modal,
    /It comes off the job's costs\$\{\s*qbState === "on"\s*\? " and out of QuickBooks"\s*: qbState === "paused"\s*\? " \(and out of QuickBooks once sending job costs is on again\)"\s*: ""\s*\}, and its receipt is deleted too\./
  );
});

test("jobCostInQuickBooks: cost editors only, this company, this QuickBooks company, the switch read on its own", () => {
  const actions = source("../actions/job-expenses.ts");
  const ask = body(actions, "jobCostInQuickBooks");
  assert.match(ask, /^export async function jobCostInQuickBooks\(expenseId: string\): Promise<CostQbState> \{/);
  assert.match(ask, /if \(!profile \|\| !canEditJobCosts\(profile\)\) return null;/);
  assert.match(ask, /onOtherSide\(conn\.environment, quickbooksCredentials\(\)\?\.environment\)/);
  const reads = statements(ask);
  assert.equal(reads.length, 3, "the connection, the switch and the expense's record");
  for (const s of reads) assert.match(s, /\.eq\("company_id", profile\.company_id\)/, s);
  // The switch apart, so before 0230 (no column) it simply says nothing.
  const switchRead = reads.find((s) => s.includes('.select("send_costs")'));
  assert.ok(switchRead, "the switch is read on its own");
  assert.doesNotMatch(switchRead, /realm_id/);
  const record = reads.find((s) => s.startsWith('.from("quickbooks_sync")'));
  assert.ok(record, "the expense's record is read");
  assert.match(record, /\.eq\("realm_id", conn\.realm_id\)/);
  assert.match(record, /\.eq\("record_type", "expense"\)/);
  assert.match(record, /\.eq\("record_id", expenseId\)/);
  assert.match(ask, /return costQbState\(row, !!costs\?\.send_costs && !conn\.disconnected_at\);/);
});

test("Bills to Pay is refreshed whenever a job cost changes", () => {
  const actions = source("../actions/job-expenses.ts");
  for (const name of ["deleteJobExpense", "assignExpensePhase", "fileCostsToContract", "updateJobExpense", "setJobExpenseReceipt"]) {
    assert.match(body(actions, name), /revalidatePath\("\/bills"\);/, name);
  }
  // Every cost, not only a bill payment's: Paid on entry lists the others (and their QuickBooks line).
  assert.doesNotMatch(actions, /if \(cost\.source === "bill"\) revalidatePath\("\/bills"\)/);
});

test("✎ Edit on Projects gets each cost's vendor and receipt, so Save never clears them", () => {
  // The window is opened from the job's Transactions with getJobExpenses' rows (not the Projects page's own cost sums).
  assert.match(source("../../app/(app)/projects/job-ledger.tsx"), /const expenseById = new Map\(ledger\.expenses\.map\(\(e\) => \[e\.id, e\]\)\);/);
  assert.match(source("../actions/job-ledger.ts"), /getJobExpenses\(contract\.lead_id\),/);
  const columns = /const COLUMNS =\s*([^;]*);/.exec(source("../actions/job-expenses.ts"));
  assert.ok(columns, "getJobExpenses' columns");
  for (const c of ["vendor_id", "vendor,", "receipt_url", "receipt_path"]) assert.ok(columns[1].includes(c), c);
});

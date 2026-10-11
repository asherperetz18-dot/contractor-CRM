import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onOtherSide, otherSideNote } from "./connection-side.ts";
import { clearForNewCompany } from "./connect-reset.ts";

/**
 * Ready for real books (DECISIONS #192). The CRM runs on Intuit's practice
 * companies until QUICKBOOKS_ENVIRONMENT says production. On the day it
 * switches, a company still connected to a practice company has to be
 * told to connect again, and connecting the real company must clear
 * everything picked for the practice one, or stop.
 */

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

// ---------------------------------------------------------------- the other side

test("a practice company after the switch to real books says connect again", () => {
  const note = otherSideNote({ connected: true, environment: "sandbox" }, "production");
  assert.ok(note);
  assert.match(note, /practice company/);
  assert.match(note, /nothing goes to QuickBooks/i);
  assert.match(note, /Connect again/);
});

test("a real company while the CRM is on practice companies says so too", () => {
  const note = otherSideNote({ connected: true, environment: "production" }, "sandbox");
  assert.ok(note);
  assert.match(note, /practice companies/);
  assert.match(note, /nothing goes to QuickBooks/i);
});

test("while QuickBooks isn't set up on the CRM there's no other side to speak of", () => {
  assert.equal(otherSideNote({ connected: true, environment: "production" }, null), null);
  const view = source("../../app/(app)/settings/quickbooks/quickbooks-view.tsx");
  assert.match(view, /otherSideNote\(c, settings\.configured \? settings\.environment : null\)/);
});

test("the same side, a disconnected company, or none: nothing to say", () => {
  assert.equal(otherSideNote({ connected: true, environment: "sandbox" }, "sandbox"), null);
  assert.equal(otherSideNote({ connected: true, environment: "production" }, "production"), null);
  assert.equal(otherSideNote({ connected: false, environment: "sandbox" }, "production"), null);
  assert.equal(otherSideNote(null, "production"), null);
});

test("the other side, compared plainly; nothing to compare while QuickBooks isn't set up", () => {
  assert.equal(onOtherSide("sandbox", "production"), true);
  assert.equal(onOtherSide("production", "sandbox"), true);
  assert.equal(onOtherSide("production", "production"), false);
  assert.equal(onOtherSide("sandbox", null), false);
  assert.equal(onOtherSide(null, "production"), false);
});

test("Bills to Pay, the Invoices page and the payment schedule show no QuickBooks lines for the other side", () => {
  // Otherwise they'd say "goes in a few minutes" while nothing goes, and "In QuickBooks" for the practice company.
  const bills = source("../../app/(app)/bills/page.tsx");
  assert.match(bills, /if \(onOtherSide\(conn\.environment, quickbooksCredentials\(\)\?\.environment\)\) return null;/);
  const chips = source("./invoice-chips.ts");
  assert.match(chips, /if \(onOtherSide\(conn\.environment, quickbooksCredentials\(\)\?\.environment\)\) return null;/);
});

test("Settings shows it: Connect again instead of Connected, and the button", () => {
  const view = source("../../app/(app)/settings/quickbooks/quickbooks-view.tsx");
  assert.match(view, /otherSideNote\(/);
  // The Connected badge only when the connection is on the CRM's side.
  assert.match(view, /connected && !otherSide && <span className="est-badge est-badge-signed">Connected<\/span>/);
  assert.match(view, /\(otherSide \|\| \(c\?\.lastError && \/connect again\/i\.test\(c\.lastError\)\)\) && \(/);
  // "This sends to your practice company" only while it really does.
  assert.doesNotMatch(view, /settings\.connection\?\.environment === "sandbox" && \(/);
  // The box doesn't say Connected in green; the sending and matching sections wait for the new connection.
  assert.match(view, /qb-status\$\{otherSide \? " is-other" : ""\}/);
  assert.match(view, /otherSide \? "Last connected to " : "Connected to "/);
  assert.match(view, /\{connected && !otherSide && <BillSending settings=\{settings\} \/>\}/);
  assert.match(view, /\{connected && !otherSide && <InvoiceSending settings=\{settings\} \/>\}/);
  assert.match(view, /\{connected && !otherSide && <MatchForm settings=\{settings\} \/>\}/);
  // Disconnect doesn't promise the matches are kept, since a different company starts fresh.
  assert.match(view, /Connecting a different company means picking its accounts again\./);
});

test("after connecting a different company, Settings says sending is off and why", () => {
  const view = source("../../app/(app)/settings/quickbooks/quickbooks-view.tsx");
  assert.match(view, /This is a different QuickBooks company, so sending bills and invoices is off/);
  const page = source("../../app/(app)/settings/quickbooks/page.tsx");
  assert.match(page, /newCompany=\{sp\.connected === "new"\}/);
  assert.match(source("../../app/api/oauth/quickbooks/callback/route.ts"), /return done\(undefined, !!cleared\.cleared\);/);
});

// ---------------------------------------------------------------- connecting a different company

type Call = { table: string; op: "select" | "update" | "delete"; columns?: string; values?: Record<string, unknown>; filters: [string, unknown][] };
type Result = { data?: unknown; error?: { code?: string; message: string } | null };

/** Just enough of Supabase's query builder: records each call, answers from `answer`. */
function fakeAdmin(answer: (call: Call) => Result) {
  const calls: Call[] = [];
  const builder = (call: Call) => {
    const run = () => {
      calls.push(call);
      const r = answer(call);
      return { data: r.data ?? null, error: r.error ?? null };
    };
    const chain = {
      eq: (column: string, value: unknown) => {
        call.filters.push([column, value]);
        return chain;
      },
      maybeSingle: async () => run(),
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, bad),
    };
    return chain;
  };
  const admin = {
    from: (table: string) => ({
      select: (columns: string) => builder({ table, op: "select", columns, filters: [] }),
      update: (values: Record<string, unknown>) => builder({ table, op: "update", values, filters: [] }),
      delete: () => builder({ table, op: "delete", filters: [] }),
    }),
  };
  return { admin: admin as never, calls };
}

const PRACTICE = { realm_id: "9341452000000001", environment: "sandbox" };
const REAL = { realmId: "123145000000002", environment: "production" as const };
const writes = (calls: Call[]) => calls.filter((c) => c.op !== "select").map((c) => `${c.op} ${c.table}`);

test("a different QuickBooks company: switches off first, then every pick cleared, only this company's", async () => {
  const { admin, calls } = fakeAdmin((c) => (c.op === "select" ? { data: PRACTICE } : {}));
  assert.deepEqual(await clearForNewCompany(admin, "co-1", REAL), { cleared: true });
  // It reads both the company id and the side, and every read and write is this company's alone.
  const read = calls.find((c) => c.op === "select");
  assert.equal(read?.columns, "realm_id, environment");
  for (const c of calls) assert.deepEqual(c.filters, [["company_id", "co-1"]]);
  assert.deepEqual(writes(calls), [
    "update quickbooks_connections",
    "update quickbooks_connections",
    "update quickbooks_connections",
    "update payment_accounts",
    "delete quickbooks_expense_accounts",
  ]);
  const [bills, invoices, costs] = calls.filter((c) => c.op === "update" && c.table === "quickbooks_connections");
  assert.deepEqual(bills.values, { send_bills: false, send_bills_from: null });
  assert.equal(invoices.values?.send_invoices, false);
  assert.equal(invoices.values?.invoice_item_id, null);
  assert.equal(invoices.values?.hand_refunds_account_id, null);
  assert.equal(invoices.values?.qb_prefs, null);
  // Job costs' switch and the bank account lender payouts land in were the old company's (DECISIONS #199).
  assert.deepEqual(costs.values, { send_costs: false, send_costs_from: null, lender_payouts_account_id: null });
});

test("the same QuickBooks company id but the other side of Intuit counts as different", async () => {
  const { admin, calls } = fakeAdmin((c) => (c.op === "select" ? { data: { realm_id: REAL.realmId, environment: "sandbox" } } : {}));
  assert.deepEqual(await clearForNewCompany(admin, "co-1", REAL), { cleared: true });
  assert.equal(writes(calls).length, 5);
});

test("the same company again, or the first connection: nothing cleared", async () => {
  const again = fakeAdmin((c) => (c.op === "select" ? { data: { realm_id: REAL.realmId, environment: "production" } } : {}));
  assert.deepEqual(await clearForNewCompany(again.admin, "co-1", REAL), {});
  assert.deepEqual(writes(again.calls), []);
  const first = fakeAdmin(() => ({ data: null }));
  assert.deepEqual(await clearForNewCompany(first.admin, "co-1", REAL), {});
  assert.deepEqual(writes(first.calls), []);
});

test("the current connection can't be read: connecting stops, nothing changes", async () => {
  const { admin, calls } = fakeAdmin((c) => (c.op === "select" ? { error: { message: "timeout" } } : {}));
  const res = await clearForNewCompany(admin, "co-1", REAL);
  assert.ok(res.error);
  assert.match(res.error, /wasn't connected/);
  assert.deepEqual(writes(calls), []);
});

test("before 0221 there's nothing to clear; the save that follows says to run it", async () => {
  const { admin, calls } = fakeAdmin((c) =>
    c.op === "select" ? { error: { code: "42P01", message: 'relation "public.quickbooks_connections" does not exist' } } : {}
  );
  assert.deepEqual(await clearForNewCompany(admin, "co-1", REAL), {});
  assert.deepEqual(writes(calls), []);
});

test("a clearing write that fails stops connecting at once", async () => {
  const { admin, calls } = fakeAdmin((c) =>
    c.op === "select" ? { data: PRACTICE } : c.table === "payment_accounts" ? { error: { message: "network" } } : {}
  );
  const res = await clearForNewCompany(admin, "co-1", REAL);
  assert.ok(res.error);
  assert.match(res.error, /wasn't connected/);
  // Switches were already off; the expense accounts weren't touched.
  assert.deepEqual(writes(calls), [
    "update quickbooks_connections",
    "update quickbooks_connections",
    "update quickbooks_connections",
    "update payment_accounts",
  ]);
});

test("clearing job costs' switch fails: connecting stops before the paid-from and expense accounts", async () => {
  const { admin, calls } = fakeAdmin((c) =>
    c.op === "select" ? { data: PRACTICE } : c.values && "send_costs" in c.values ? { error: { message: "network" } } : {}
  );
  const res = await clearForNewCompany(admin, "co-1", REAL);
  assert.ok(res.error);
  assert.match(res.error, /wasn't connected/);
  assert.deepEqual(writes(calls), ["update quickbooks_connections", "update quickbooks_connections", "update quickbooks_connections"]);
});

test("before 0227 the invoice columns don't exist: that one is skipped, the rest go on", async () => {
  const { admin, calls } = fakeAdmin((c) =>
    c.op === "select"
      ? { data: PRACTICE }
      : c.values && "send_invoices" in c.values
        ? { error: { code: "PGRST204", message: "Could not find the 'send_invoices' column" } }
        : {}
  );
  assert.deepEqual(await clearForNewCompany(admin, "co-1", REAL), { cleared: true });
  assert.equal(writes(calls).length, 5);
});

test("before 0230 the job-costs columns don't exist: that one is skipped, the rest go on", async () => {
  const { admin, calls } = fakeAdmin((c) =>
    c.op === "select"
      ? { data: PRACTICE }
      : c.values && "send_costs" in c.values
        ? { error: { code: "PGRST204", message: "Could not find the 'send_costs' column" } }
        : {}
  );
  assert.deepEqual(await clearForNewCompany(admin, "co-1", REAL), { cleared: true });
  assert.equal(writes(calls).length, 5);
  assert.deepEqual(writes(calls).slice(3), ["update payment_accounts", "delete quickbooks_expense_accounts"]);
});

test("before 0222 there's no bills switch: that one is skipped too, and the matches are still cleared", async () => {
  const { admin, calls } = fakeAdmin((c) =>
    c.op === "select"
      ? { data: PRACTICE }
      : c.values && "send_bills" in c.values
        ? { error: { code: "PGRST204", message: "Could not find the 'send_bills' column" } }
        : {}
  );
  assert.deepEqual(await clearForNewCompany(admin, "co-1", REAL), { cleared: true });
  assert.deepEqual(writes(calls).slice(3), ["update payment_accounts", "delete quickbooks_expense_accounts"]);
});

test("the sign-in callback clears through it and stops on its error, before saving the new login", () => {
  const back = source("../../app/api/oauth/quickbooks/callback/route.ts");
  const clear = back.indexOf("clearForNewCompany(admin, companyId,");
  const save = back.indexOf('.from("quickbooks_connections").upsert(');
  assert.ok(clear > 0 && save > clear);
  assert.match(back, /if \(cleared\.error\) return done\(cleared\.error\);/);
  // The old inline clearing, which ignored a failed read, is gone.
  assert.doesNotMatch(back, /before\?\.realm_id && before\.realm_id !== realmId/);
});

// ---------------------------------------------------------------- privacy

test("the privacy page says what goes to a company's own QuickBooks and that it stays there, and its date moved", () => {
  const page = source("../../app/privacy/page.tsx");
  // Not among the services that work for us: it's the company's own account.
  assert.doesNotMatch(page, /<li>[^<]*QuickBooks/);
  assert.match(page, /If your company connects its own QuickBooks Online \(Intuit\), the CRM sends it what your company turns on:/);
  // Only what stays: deleted bills, credits and refunds are deleted there while sending is on.
  assert.match(page, /Customers and vendors stay in\s+QuickBooks even if they&apos;re deleted in the CRM/);
  assert.doesNotMatch(page, /deleting something in the CRM/);
  assert.doesNotMatch(source("../app-store/legal.ts"), /LEGAL_UPDATED = "September 27, 2026"/);
});

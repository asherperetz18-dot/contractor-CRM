import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { otherSideNote } from "./connection-side.ts";
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

test("the same side, a disconnected company, or none: nothing to say", () => {
  assert.equal(otherSideNote({ connected: true, environment: "sandbox" }, "sandbox"), null);
  assert.equal(otherSideNote({ connected: true, environment: "production" }, "production"), null);
  assert.equal(otherSideNote({ connected: false, environment: "sandbox" }, "production"), null);
  assert.equal(otherSideNote(null, "production"), null);
});

test("Settings shows it: Connect again instead of Connected, and the button", () => {
  const view = source("../../app/(app)/settings/quickbooks/quickbooks-view.tsx");
  assert.match(view, /otherSideNote\(/);
  // The Connected badge only when the connection is on the CRM's side.
  assert.match(view, /connected && !otherSide && <span className="est-badge est-badge-signed">Connected<\/span>/);
  assert.match(view, /\(otherSide \|\| \(c\?\.lastError && \/connect again\/i\.test\(c\.lastError\)\)\) && \(/);
  // "This sends to your practice company" only while it really does.
  assert.doesNotMatch(view, /settings\.connection\?\.environment === "sandbox" && \(/);
});

// ---------------------------------------------------------------- connecting a different company

type Call = { table: string; op: "select" | "update" | "delete"; values?: Record<string, unknown> };
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
      eq: () => chain,
      maybeSingle: async () => run(),
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, bad),
    };
    return chain;
  };
  const admin = {
    from: (table: string) => ({
      select: () => builder({ table, op: "select" }),
      update: (values: Record<string, unknown>) => builder({ table, op: "update", values }),
      delete: () => builder({ table, op: "delete" }),
    }),
  };
  return { admin: admin as never, calls };
}

const PRACTICE = { realm_id: "9341452000000001", environment: "sandbox" };
const REAL = { realmId: "123145000000002", environment: "production" as const };
const writes = (calls: Call[]) => calls.filter((c) => c.op !== "select").map((c) => `${c.op} ${c.table}`);

test("a different QuickBooks company: switches off first, then every pick cleared", async () => {
  const { admin, calls } = fakeAdmin((c) => (c.op === "select" ? { data: PRACTICE } : {}));
  assert.deepEqual(await clearForNewCompany(admin, "co-1", REAL), {});
  assert.deepEqual(writes(calls), [
    "update quickbooks_connections",
    "update quickbooks_connections",
    "update payment_accounts",
    "delete quickbooks_expense_accounts",
  ]);
  const [bills, invoices] = calls.filter((c) => c.op === "update" && c.table === "quickbooks_connections");
  assert.deepEqual(bills.values, { send_bills: false, send_bills_from: null });
  assert.equal(invoices.values?.send_invoices, false);
  assert.equal(invoices.values?.invoice_item_id, null);
  assert.equal(invoices.values?.hand_refunds_account_id, null);
  assert.equal(invoices.values?.qb_prefs, null);
});

test("the same QuickBooks company id but the other side of Intuit counts as different", async () => {
  const { admin, calls } = fakeAdmin((c) => (c.op === "select" ? { data: { realm_id: REAL.realmId, environment: "sandbox" } } : {}));
  assert.deepEqual(await clearForNewCompany(admin, "co-1", REAL), {});
  assert.equal(writes(calls).length, 4);
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
  assert.deepEqual(writes(calls), ["update quickbooks_connections", "update quickbooks_connections", "update payment_accounts"]);
});

test("before 0227 the invoice columns don't exist: that one is skipped, the rest go on", async () => {
  const { admin, calls } = fakeAdmin((c) =>
    c.op === "select"
      ? { data: PRACTICE }
      : c.values && "send_invoices" in c.values
        ? { error: { code: "PGRST204", message: "Could not find the 'send_invoices' column" } }
        : {}
  );
  assert.deepEqual(await clearForNewCompany(admin, "co-1", REAL), {});
  assert.equal(writes(calls).length, 4);
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

test("the privacy page names QuickBooks among the services, and its date moved", () => {
  const page = source("../../app/privacy/page.tsx");
  assert.match(page, /<li>Intuit QuickBooks Online \(accounting, if your company connects it\)<\/li>/);
  assert.doesNotMatch(source("../app-store/legal.ts"), /LEGAL_UPDATED = "September 27, 2026"/);
});

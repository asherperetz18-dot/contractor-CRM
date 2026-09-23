import { test } from "node:test";
import assert from "node:assert/strict";
import { paidOnEntryReceipts } from "./bills.ts";
import type { JobExpense } from "./types.ts";

const exp = (id: string, over: Partial<JobExpense> = {}): JobExpense => ({
  id,
  company_id: "c1",
  lead_id: "l1",
  estimate_payment_id: null,
  vendor: "Vera",
  vendor_id: null,
  category: null,
  description: null,
  amount_cents: 1000,
  spent_on: "2026-09-01",
  source: "manual",
  qb_txn_id: null,
  qb_txn_type: null,
  qb_project_id: null,
  receipt_url: null,
  receipt_path: null,
  created_at: "2026-09-01T00:00:00Z",
  ...over,
});

test("a cost saved as 'Already paid' shows as a paid receipt", () => {
  const rows = paidOnEntryReceipts([exp("a")], []);
  assert.deepEqual(rows.map((r) => r.id), ["a"]);
});

test("a cost created by paying a bill is left out -- the paid bill already lists it", () => {
  const rows = paidOnEntryReceipts(
    [exp("a", { source: "bill" }), exp("b"), exp("c")],
    [{ job_expense_id: "c" }]
  );
  assert.deepEqual(rows.map((r) => r.id), ["b"]);
});

test("newest payment date first", () => {
  const rows = paidOnEntryReceipts(
    [exp("old", { spent_on: "2026-08-11" }), exp("new", { spent_on: "2026-09-23" })],
    []
  );
  assert.deepEqual(rows.map((r) => r.id), ["new", "old"]);
});

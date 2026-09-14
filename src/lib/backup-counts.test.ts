import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeBackupCounts } from "./backup-counts.ts";

/**
 * The Backup settings page shows what a backup would contain. It used to
 * get those numbers by actually fetching every row of every table --
 * which, the day 73k leads were imported, took minutes and killed the
 * Vercel build (the page was statically prerendered, and static
 * generation caps a page at 60 seconds). The page now asks the database
 * to count; this shapes those per-table answers into the view's props.
 */

test("counts land per table and sum into totalRows", () => {
  const out = summarizeBackupCounts([
    { table: "companies", count: 3, error: null },
    { table: "leads", count: 73546, error: null },
    { table: "call_logs", count: 900, error: null },
  ]);
  assert.deepEqual(out.counts, { companies: 3, leads: 73546, call_logs: 900 });
  assert.deepEqual(out.skipped, {});
  assert.equal(out.totalRows, 74449);
});

test("a table that errors is skipped with its reason, never counted", () => {
  const out = summarizeBackupCounts([
    { table: "companies", count: 3, error: null },
    { table: "documents", count: null, error: "permission denied for table documents" },
  ]);
  assert.deepEqual(out.counts, { companies: 3 });
  assert.deepEqual(out.skipped, { documents: "permission denied for table documents" });
  assert.equal(out.totalRows, 3);
});

test("a null count without an error reads as empty, not as broken", () => {
  const out = summarizeBackupCounts([{ table: "vendors", count: null, error: null }]);
  assert.deepEqual(out.counts, { vendors: 0 });
  assert.deepEqual(out.skipped, {});
  assert.equal(out.totalRows, 0);
});

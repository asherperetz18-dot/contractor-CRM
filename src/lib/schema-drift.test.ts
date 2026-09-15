import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXPECTED_COLUMNS,
  buildDriftReport,
  isMissingSchemaError,
  type ProbeOutcome,
} from "./schema-drift.ts";

/**
 * Twice in one day a merged migration was never pasted into the
 * Supabase SQL editor, and every write to the affected table failed in
 * production (leads.phone2, call_logs.correlation_id). These tests pin
 * the two judgments the health check makes: which probe errors mean
 * "the migration wasn't run" versus "the probe itself failed", and how
 * findings are grouped so the fix is named as a migration file to run.
 */

function outcome(
  table: string,
  column: string,
  migration: string,
  error: ProbeOutcome["error"]
): ProbeOutcome {
  return { table, column, migration, error };
}

test("a clean run is ok, with every probe counted", () => {
  const report = buildDriftReport(
    EXPECTED_COLUMNS.map((p) => ({ ...p, error: null }))
  );
  assert.equal(report.ok, true);
  assert.equal(report.checked, EXPECTED_COLUMNS.length);
  assert.deepEqual(report.missing, []);
  assert.deepEqual(report.failed, []);
});

test("missing columns are grouped under the one migration file to run", () => {
  const gone = { code: "42703", message: "column leads.phone2 does not exist" };
  const report = buildDriftReport([
    outcome("leads", "phone2", "0150_lead_phone2_phone3.sql", gone),
    outcome("leads", "phone3", "0150_lead_phone2_phone3.sql", {
      code: "42703",
      message: "column leads.phone3 does not exist",
    }),
    outcome("screen_shares", "kind", "0149_cobrowse_share_kind.sql", null),
  ]);
  assert.equal(report.ok, false);
  assert.deepEqual(report.missing, [
    {
      migration: "0150_lead_phone2_phone3.sql",
      columns: ["leads.phone2", "leads.phone3"],
    },
  ]);
  assert.deepEqual(report.failed, []);
});

test("migration groups come back in file order, whatever order the probes ran", () => {
  const gone = { code: "42703", message: "does not exist" };
  const report = buildDriftReport([
    outcome("leads", "phone2", "0150_lead_phone2_phone3.sql", gone),
    outcome("screen_shares", "kind", "0149_cobrowse_share_kind.sql", gone),
  ]);
  assert.deepEqual(
    report.missing.map((m) => m.migration),
    ["0149_cobrowse_share_kind.sql", "0150_lead_phone2_phone3.sql"]
  );
});

test("every way Postgres/PostgREST says 'not there' reads as missing", () => {
  // Straight Postgres: unknown column / unknown table.
  assert.equal(isMissingSchemaError({ code: "42703", message: "column x does not exist" }), true);
  assert.equal(isMissingSchemaError({ code: "42P01", message: "relation x does not exist" }), true);
  // PostgREST's schema cache: the exact production error that started this.
  assert.equal(
    isMissingSchemaError({
      code: "PGRST204",
      message: "Could not find the 'phone2' column of 'leads' in the schema cache",
    }),
    true
  );
  assert.equal(
    isMissingSchemaError({
      code: "PGRST205",
      message: "Could not find the table 'public.x' in the schema cache",
    }),
    true
  );
  // Message-only fallback, for a client that surfaces no code.
  assert.equal(
    isMissingSchemaError({ message: "Could not find the 'kind' column of 'screen_shares' in the schema cache" }),
    true
  );
});

test("a probe failing for any other reason is reported as a failure, never as drift", () => {
  const report = buildDriftReport([
    outcome("leads", "phone2", "0150_lead_phone2_phone3.sql", {
      code: "42501",
      message: "permission denied for table leads",
    }),
    outcome("screen_shares", "kind", "0149_cobrowse_share_kind.sql", null),
  ]);
  // Not proven missing -- but not proven healthy either.
  assert.equal(report.ok, false);
  assert.deepEqual(report.missing, []);
  assert.deepEqual(report.failed, [
    { column: "leads.phone2", message: "permission denied for table leads" },
  ]);
  assert.equal(isMissingSchemaError({ message: "TypeError: fetch failed" }), false);
  assert.equal(isMissingSchemaError(null), false);
});

test("the manifest names real migration files, newest window only", () => {
  // Guards against a typo'd file name being shown as the thing to run.
  for (const probe of EXPECTED_COLUMNS) {
    assert.match(probe.migration, /^\d{4}_[a-z0-9_]+\.sql$/);
    assert.ok(probe.table.length > 0);
    assert.ok(probe.column.length > 0);
  }
});

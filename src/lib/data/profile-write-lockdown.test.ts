import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * profiles carries the flags that open every company at once
 * (is_platform_admin, is_super_admin) and the email that signup and the
 * platform-admin grant look people up by. Until 0188, the database let a
 * signed-in person write any column of their own row, and Office write
 * the rows of anyone sharing a company with them. 0188 leaves the API
 * exactly the columns a person may set on themselves; everything else is
 * the server's.
 */

const MIGRATIONS = new URL("../../../supabase/migrations/", import.meta.url);
const file = readdirSync(MIGRATIONS).find((f) => f.startsWith("0188_"));
const sql = file ? readFileSync(new URL(file, MIGRATIONS), "utf8") : "";

// What a person may change on their own profile through the API.
const SELF_EDITABLE = ["name", "phone", "estimate_funnel_order", "dashboard_panel_order"];

function grantedColumns(text: string): string[] {
  const m = text.match(/grant\s+update\s*\(([^)]*)\)\s+on\s+(?:table\s+)?public\.profiles\s+to\s+authenticated/i);
  return m ? m[1].split(",").map((c) => c.trim()).sort() : [];
}

test("0188 exists", () => {
  assert.ok(file, "supabase/migrations/0188_*.sql is missing");
});

test("the API loses the right to write profiles wholesale", () => {
  assert.match(sql, /revoke\s+insert\s*,\s*update\s*,\s*delete\s+on\s+(?:table\s+)?public\.profiles\s+from\s+anon\s*,\s*authenticated/i);
});

test("a person may set only their own harmless columns", () => {
  assert.deepEqual(grantedColumns(sql), [...SELF_EDITABLE].sort());
  for (const flag of ["is_platform_admin", "is_super_admin", "email", "roles", "company_id", "status"]) {
    assert.ok(!grantedColumns(sql).includes(flag), `${flag} must stay server-only`);
  }
});

test("Office no longer writes other people's profiles through the API", () => {
  assert.match(sql, /drop\s+policy\s+if\s+exists\s+"?profiles_office_manage"?\s+on\s+public\.profiles/i);
});

test("revoking a platform admin is the server's call, not anyone's", () => {
  assert.match(
    sql,
    /revoke\s+execute\s+on\s+function\s+public\.revoke_platform_admin_if_not_last\(uuid\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i
  );
});

// The app names its signed-in client `supabase` and the service-role one
// `admin`, throughout. A profile write through the signed-in client that
// touches a column 0188 doesn't grant would fail in production with
// "permission denied" -- so a new one fails here first.
const SRC = fileURLToPath(new URL("../../", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
  });
}

test("every profile write through the signed-in client stays inside the grant", () => {
  const write = /\bsupabase\s*\.from\("profiles"\)\s*\.(update|upsert|insert|delete)\(\s*(\{[^}]*\})?/g;
  const outside: string[] = [];
  let seen = 0;
  for (const path of sourceFiles(SRC)) {
    for (const [, verb, body] of readFileSync(path, "utf8").matchAll(write)) {
      seen++;
      const keys = [...(body ?? "").matchAll(/(\w+)\s*:/g)].map((k) => k[1]);
      const bad = verb !== "update" || keys.length === 0 ? [verb] : keys.filter((k) => !SELF_EDITABLE.includes(k));
      if (bad.length) outside.push(`${relative(SRC, path)}: ${bad.join(", ")}`);
    }
  }
  // The funnel order and dashboard layout saves -- if this drops to zero
  // the pattern has stopped matching, not the writes stopped existing.
  assert.ok(seen >= 2, `expected to find the funnel and dashboard saves, found ${seen}`);
  assert.deepEqual(outside, []);
});

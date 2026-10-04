import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The guard rails around private file storage (DECISIONS #108): no code
 * may mint a permanent public link to a job file, receipt or company
 * document again, the file route checks the person before it signs
 * anything, and the migration turns the public buckets off.
 */

const SRC = fileURLToPath(new URL("../../", import.meta.url));
const ROOT = join(SRC, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
  });
}

test("only the company logo is still given a public link", () => {
  const callers = sourceFiles(SRC)
    .filter((f) => readFileSync(f, "utf8").includes("getPublicUrl("))
    .map((f) => relative(SRC, f).split("\\").join("/"));
  assert.deepEqual(callers, ["lib/actions/settings.ts"]);
  // ...and there only for the logo, which the portal shows before the
  // customer has signed in.
  const settings = readFileSync(join(SRC, "lib/actions/settings.ts"), "utf8");
  const buckets = [...settings.matchAll(/\.from\(([^)]+)\)\s*\.getPublicUrl\(/g)].map((m) => m[1]);
  assert.deepEqual(buckets, ['"logos"']);
});

test("the file route decides who is asking before it signs a link", () => {
  const route = readFileSync(join(SRC, "app/api/files/[bucket]/[...path]/route.ts"), "utf8");
  const sign = route.indexOf("createSignedUrl(");
  assert.ok(sign > 0, "the route must hand out a signed, expiring link");
  for (const check of ["staffCanReadFile(", "portalCanReadFile(", "fileRouteTarget("]) {
    const at = route.indexOf(check);
    assert.ok(at > 0 && at < sign, `${check} must run before the link is signed`);
  }
  assert.match(route, /portalAccessActive\(/, "a lapsed portal login opens nothing");
  assert.match(route, /"private, no-store"/, "a refusal is never cached");
  assert.match(route, /"private, max-age=300"/, "only the person's own browser may reuse a link, briefly");
  assert.doesNotMatch(route, /public,|s-maxage/, "never a shared cache: the answer is per person");
});

test("the migration closes both buckets and rewrites every saved link", () => {
  const sql = readFileSync(join(ROOT, "supabase/migrations/0190_private_file_buckets.sql"), "utf8");
  assert.match(sql, /update storage\.buckets set public = false\s+where id in \('lead-files', 'company-docs'\)/);
  for (const [table, column, bucket] of [
    ["lead_files", "file_url", "lead-files"],
    ["company_documents", "file_url", "company-docs"],
    ["job_expenses", "receipt_url", "lead-files"],
    ["vendor_bills", "receipt_url", "lead-files"],
  ]) {
    assert.match(
      sql,
      new RegExp(`update public\\.${table}\\s+set ${column} = regexp_replace\\(${column}, '[^']*/storage/v1/object/public/${bucket}/', '/api/files/${bucket}/'\\)`),
      `${table}.${column}`
    );
  }
  assert.doesNotMatch(sql, /'logos'/, "logos stay public");
});

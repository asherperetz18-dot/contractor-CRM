import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { canSeeActivityOf } from "./activity-visibility.ts";

/**
 * A super admin's activity -- page visits, time on screen, who's online,
 * which contacts they opened -- is seen by super admins only. Every other
 * viewer, an Admin included, sees no trace of it.
 */

const superAdmin = { is_super_admin: true };
const admin = { is_super_admin: false };
const office = {};

test("an Admin or Office viewer sees nothing of a super admin", () => {
  assert.equal(canSeeActivityOf(admin, superAdmin), false);
  assert.equal(canSeeActivityOf(office, superAdmin), false);
});

test("a super admin sees a super admin's activity, their own included", () => {
  assert.equal(canSeeActivityOf(superAdmin, superAdmin), true);
});

test("everyone else's activity stays visible, to any viewer", () => {
  // The "Asher Peretz" rep account holds no super admin flag, so it is
  // reported like anyone else -- only the "Asher" super admin account hides.
  const rep = { is_super_admin: false };
  assert.equal(canSeeActivityOf(admin, rep), true);
  assert.equal(canSeeActivityOf(office, {}), true);
  assert.equal(canSeeActivityOf(superAdmin, rep), true);
});

test("no viewer sees nothing of a super admin", () => {
  assert.equal(canSeeActivityOf(null, superAdmin), false);
});

const SRC = fileURLToPath(new URL("../../", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
  });
}

const APPLIES_RULE = /from "@\/lib\/data\/(activity-visibility|hidden-activity)"/;

test("every read of activity_events or lead_views applies the super admin rule", () => {
  // Several of these read with the service role, which RLS never sees,
  // so the database's line alone does not cover them. A new report that
  // reads either table without the rule fails here before it ships.
  const reads = /\.from\("(activity_events|lead_views)"\)\s*\.select\(/;
  const missing = sourceFiles(SRC)
    .filter((file) => reads.test(readFileSync(file, "utf8")))
    .filter((file) => !APPLIES_RULE.test(readFileSync(file, "utf8")))
    .map((file) => relative(SRC, file));
  assert.deepEqual(missing, [], "narrow these reads with hiddenActivityUserIds / canSeeActivityOf");
});

test("Team Activity's list of people leaves out whoever the viewer may not see", () => {
  // The roster feeds the report's people table and its User filter, so a
  // super admin with no rows in range would still be listed by name.
  const page = readFileSync(join(SRC, "app/(app)/settings/team-activity/page.tsx"), "utf8");
  assert.match(page, APPLIES_RULE);
  assert.match(page, /canSeeActivityOf\(/);
});

const MIGRATIONS = new URL("../../../supabase/migrations/", import.meta.url);
const allMigrations = readdirSync(MIGRATIONS)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort()
  .map((f) => readFileSync(new URL(f, MIGRATIONS), "utf8"))
  .join("\n");

for (const table of ["activity_events", "lead_views"]) {
  test(`the database hides a super admin's ${table} rows from everyone else`, () => {
    // Office and Admin can read these tables straight through the API, so
    // the screens alone are not the line. The last word on the policy in
    // migration order must be the restrictive one -- a later migration that
    // drops it without putting it back fails here.
    const statements = [
      ...allMigrations.matchAll(
        new RegExp(
          `(drop|create) policy (?:if exists )?"?super_admin_activity_hidden"? on (?:public\\.)?${table}\\b[^;]*;`,
          "gi"
        )
      ),
    ];
    const last = statements.at(-1);
    assert.ok(last, `no super_admin_activity_hidden policy on ${table}`);
    assert.equal(last[1].toLowerCase(), "create", `super_admin_activity_hidden on ${table} was dropped`);
    assert.match(last[0], /as restrictive\s+for select/i);
    assert.match(last[0], /super_admin_profile_ids\(\)/);
  });

  test(`the super admin's ${table} history is deleted`, () => {
    assert.match(
      allMigrations,
      new RegExp(
        `delete from (?:public\\.)?${table}\\s+where user_id in \\(select public\\.super_admin_profile_ids\\(\\)\\);`,
        "i"
      )
    );
  });
}

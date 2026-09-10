import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Two SQL functions answer "which leads does this sales-scoped user
// own": current_visible_lead_ids() (the set, used by the policies 0117
// rewrote) and lead_visible_to_current_user(id) (the per-row original,
// still gating estimate_items, estimate_signers, estimate_payments and
// portal_payments through estimate_visible_to_current_user).
//
// 0134 added the closer seat to one and not the other, and a closer's
// freshly written estimate opened empty: the estimates row answered to
// the new rule, every line item on it to the old one. This test pins
// the two rules to the same answer -- whoever next edits either
// function edits both, or reads this.
const GRANTS = ["assigned_to", "dispatcher_id", "closer_id"];

const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "supabase",
  "migrations"
);

/** Body of the newest `create [or replace] function <name>` across migrations. */
function latestDefinition(name: string): { file: string; body: string } {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  let found: { file: string; body: string } | null = null;
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    const def = new RegExp(
      String.raw`create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?${name}\s*\(`,
      "i"
    ).exec(sql);
    if (!def) continue;
    // The body sits between the first $$ pair after the signature.
    const open = sql.indexOf("$$", def.index);
    const close = open >= 0 ? sql.indexOf("$$", open + 2) : -1;
    assert.ok(close > open, `${file}: unterminated $$ body for ${name}`);
    found = { file, body: sql.slice(open + 2, close) };
  }
  assert.ok(found, `no migration defines ${name}`);
  return found;
}

for (const fn of ["current_visible_lead_ids", "lead_visible_to_current_user"]) {
  test(`${fn} grants the lead to its assigned rep, dispatcher and closer`, () => {
    const { file, body } = latestDefinition(fn);
    for (const grant of GRANTS) {
      assert.ok(
        body.includes(grant),
        `${fn} (latest definition in ${file}) does not check leads.${grant} -- ` +
          `the two lead-visibility functions must grant the same seats, ` +
          `or an estimate becomes visible while its line items are not`
      );
    }
  });
}

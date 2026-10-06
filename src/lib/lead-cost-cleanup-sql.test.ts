import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * 0211 takes the stamped $375 off bought-list contacts and keeps each
 * figure in lead_cost_cleared_0211 so it can be put back. The owner runs
 * it again after ticking more sources (it's safe to run twice), so its
 * clearing step must re-check the tick: otherwise a source that was
 * un-ticked and had its cost restored from that table gets $0 again on
 * the next run (reproduced on a copy of the database, DECISIONS #156).
 */

const sql = readFileSync(new URL("../../supabase/migrations/0211_contacts_not_leads.sql", import.meta.url), "utf8");

test("0211's clearing step only clears a contact whose source is still a bought list", () => {
  const clearing = sql.match(/update public\.leads l\s+set lead_cost = 0[\s\S]*?;/i)?.[0];
  assert.ok(clearing, "the clearing update is in 0211");
  assert.match(clearing, /from public\.lead_cost_cleared_0211 b/i);
  assert.match(clearing, /s\.bought_list/i, "re-checks the source's bought-list tick");
  assert.match(clearing, /lower\(btrim\(s\.name\)\) = lower\(btrim\(l\.source\)\)/i);
});

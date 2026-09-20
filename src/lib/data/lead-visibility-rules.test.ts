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
//
// second_assigned_to is the appointment seat (0152): a rep booked onto
// a lead's appointment -- either chair -- sees the lead, its estimates
// and their contents, exactly like the closer. The string only occurs
// in the events clause, so it pins that whole grant.
//
// partner_rep_id is the partnership seat (0163): the second rep who
// shares the sale with the owner, and holds the lead the same way.
const GRANTS = [
  "assigned_to",
  "dispatcher_id",
  "closer_id",
  "second_assigned_to",
  "partner_rep_id",
];

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

/** Newest full `create/alter policy "<name>"` statement across migrations. */
function latestPolicyStatement(name: string): { file: string; text: string } {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  const head = new RegExp(
    String.raw`(?:create|alter)\s+policy\s+"${name}"`,
    "i"
  );
  let found: { file: string; text: string } | null = null;
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    const def = head.exec(sql);
    if (!def) continue;
    const end = sql.indexOf(";", def.index);
    assert.ok(end > def.index, `${file}: unterminated ${name} policy statement`);
    found = { file, text: sql.slice(def.index, end) };
  }
  assert.ok(found, `no migration states policy ${name}`);
  return found;
}

/** Newest full `create function <name>` statement, attributes included. */
function latestFunctionStatement(name: string): { file: string; text: string } {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  let found: { file: string; text: string } | null = null;
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    const def = new RegExp(
      String.raw`create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?${name}\s*\(`,
      "i"
    ).exec(sql);
    if (!def) continue;
    const open = sql.indexOf("$$", def.index);
    const close = open >= 0 ? sql.indexOf("$$", open + 2) : -1;
    const end = close >= 0 ? sql.indexOf(";", close + 2) : -1;
    assert.ok(end > 0, `${file}: unterminated statement for ${name}`);
    found = { file, text: sql.slice(def.index, end) };
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

// 0152 wrote the appointment-seat grant into leads_select as an inline
// subquery on public.events. A subquery inside a policy expression runs
// under the referenced table's own RLS -- and events_update_dispatch
// (0090) reads leads inline the same way -- so the moment 0152 ran, any
// UPDATE on events (moving an appointment, changing its time) expanded
// events policies -> leads_select -> events policies again and died:
// "infinite recursion detected in policy for relation events".
//
// The rule these two tests pin: leads_select never names another
// RLS-governed table directly. A cross-table grant goes through a
// security definer function (current_setter_lead_ids is the model),
// which the rewriter treats as opaque -- no cycle. 0159 is the fix.
test("leads_select reads appointment seats through the security definer helper", () => {
  const { file, text } = latestPolicyStatement("leads_select");
  assert.ok(
    !/from\s+(?:public\.)?events\b/i.test(text),
    `leads_select (latest statement in ${file}) subqueries events inline -- ` +
      `events' dispatch policy reads leads inline too, so every appointment ` +
      `save recurses ("infinite recursion detected in policy for relation ` +
      `events"). Route the grant through current_appointment_lead_ids()`
  );
  assert.ok(
    text.includes("current_appointment_lead_ids"),
    `leads_select (latest statement in ${file}) dropped the appointment-seat ` +
      `grant -- a rep booked onto a lead's appointment must still hold the lead (0152)`
  );
});

test("current_appointment_lead_ids grants both chairs and is security definer", () => {
  const { file, text } = latestFunctionStatement("current_appointment_lead_ids");
  assert.ok(
    /security\s+definer/i.test(text),
    `current_appointment_lead_ids (${file}) must be security definer -- as an ` +
      `invoker function its events read would re-enter events RLS, the exact ` +
      `recursion this helper exists to break`
  );
  for (const seat of ["assigned_to", "second_assigned_to"]) {
    assert.ok(
      text.includes(seat),
      `current_appointment_lead_ids (${file}) does not grant events.${seat} -- ` +
        `both appointment chairs hold the lead (0152), moving the clause into ` +
        `a helper must not narrow it`
    );
  }
});

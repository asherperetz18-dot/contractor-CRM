import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Who sees which texts (DECISIONS #112).
 *
 * Every member of a company used to read every text in it: the Reply
 * Inbox, a contact's Texts tab and Text Reports all showed one rep's
 * conversations to every other rep. The owner's rule: Admin, Office,
 * Dispatch and Call Center see every text; everyone else sees only their
 * own conversations. A text's owner is whoever sent it; a customer's
 * reply belongs to whoever texted that number last, and with nobody to
 * go by, to the contact's assigned rep.
 *
 * The boundary is RLS on sms_messages (migration 0191), not the screens,
 * so this pins the migration itself.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const sql = read("../../supabase/migrations/0191_text_privacy.sql");

/** The whole statement starting at `pattern` -- a function body to its closing $$. */
function statement(pattern: RegExp): string {
  const at = sql.search(pattern);
  assert.ok(at !== -1, `migration has ${pattern}`);
  const body = sql.indexOf("$$", at);
  const nextEnd = sql.indexOf(";\n", at);
  const end = body !== -1 && body < nextEnd ? sql.indexOf("$$;", sql.indexOf("$$", body + 2)) + 3 : nextEnd + 1;
  return sql.slice(at, end);
}

test("only Admin, Office, Dispatch and Call Center see every text", () => {
  const policy = statement(/alter policy "sms_messages_select"/);
  const seeAll = [...policy.matchAll(/current_role_company_ids\('([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(seeAll, ["Call Center", "Dispatch", "Office"]);
  assert.match(policy, /current_member_company_ids/, "still never another company's texts");
});

test("Admin is in that list without being named: every role check lets Admin through", () => {
  const helper = read("../../supabase/migrations/0108_rls_evaluate_once_per_query.sql");
  const fn = helper.slice(helper.indexOf("function public.current_role_company_ids"));
  assert.match(fn.slice(0, fn.indexOf("$$;")), /'Admin' = any\(cm\.roles\)/);
});

test("everyone else sees the texts they own or sent", () => {
  const policy = statement(/alter policy "sms_messages_select"/);
  assert.match(policy, /owner_id = \(select auth\.uid\(\)\)/);
  assert.match(policy, /sent_by = \(select auth\.uid\(\)\)/);
});

test("every new text is given its owner as it is saved", () => {
  const trigger = statement(/create trigger sms_messages_set_owner/);
  assert.match(trigger, /before insert on public\.sms_messages/);
  const fn = statement(/create or replace function public\.sms_messages_set_owner/);
  // Someone's own text is theirs.
  assert.match(fn, /new\.owner_id := new\.sent_by/);
  // A reply goes to whoever texted that number last, compared on the
  // last ten digits: outbound numbers are saved as typed, replies as +1.
  assert.match(fn, /contact_phone_key\(o\.to_number\) = public\.contact_phone_key\(new\.from_number\)/);
  assert.match(fn, /order by o\.created_at desc/);
  // Nobody to go by: the contact's assigned rep.
  assert.match(fn, /select l\.assigned_to into new\.owner_id/);
  // The trigger reads other people's texts, which the inserting user
  // can no longer see.
  assert.match(fn, /security definer/);
});

test("texts already saved get owners by the same rule", () => {
  assert.match(sql, /update public\.sms_messages m\s+set owner_id = m\.sent_by/);
  assert.match(sql, /and o\.created_at <= m\.created_at/, "a reply goes to who texted before it, not after");
  assert.match(sql, /set owner_id = l\.assigned_to/);
});

test("safe to paste twice", () => {
  assert.match(sql, /add column if not exists owner_id/);
  assert.doesNotMatch(sql, /create index (?!if not exists)/);
  assert.match(sql, /drop trigger if exists sms_messages_set_owner/);
  const updates = sql.match(/update public\.sms_messages[\s\S]*?;/g) ?? [];
  assert.ok(updates.length >= 3);
  for (const u of updates) assert.match(u, /owner_id is null/, "a backfill never overwrites an owner");
});

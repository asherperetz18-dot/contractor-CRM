import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { LeadLite } from "./data/types.ts";
import {
  CONVERSATIONS_PER_PAGE,
  INBOX_CHANNELS,
  MAX_WINDOWS_PER_PAGE,
  SCAN_WINDOW,
  THREAD_MAX,
  THREAD_PAGE,
  conversationKey,
  conversationPages,
  initialConversationKey,
  latestPerConversation,
  mergeConversationLists,
  parseConversationKey,
  scanConversations,
  summarizeConversations,
  threadFromNewestFirst,
  threadLimit,
  withPendingTarget,
  type ConversationSummary,
  type InboxMessage,
} from "./reply-inbox.ts";

/**
 * The Reply Inbox used to load every text the company ever sent or got,
 * on every visit and again on every new text, and group them in the
 * browser (DECISIONS #141). It now reads the newest texts until it has a
 * page of conversations, and a conversation's messages only when it is
 * opened. These pin the rules that moved.
 */

let seq = 0;
function msg(m: Partial<InboxMessage> & { at: string }): InboxMessage {
  seq += 1;
  return {
    id: m.id ?? `m${seq}`,
    lead_id: m.lead_id ?? null,
    direction: m.direction ?? "inbound",
    from_number: m.from_number ?? "+15555550100",
    to_number: m.to_number ?? "+15555550199",
    body: m.body ?? "hi",
    created_at: m.at,
  };
}

const LEAD_A = "11111111-1111-4111-8111-111111111111";
const LEAD_B = "22222222-2222-4222-8222-222222222222";

function lead(id: string, first: string, phone: string | null, second: string | null = null): LeadLite {
  return {
    id,
    contact_type: "Individual",
    company_name: null,
    first_name: first,
    last_name: "Demo",
    phone,
    second_contact_phone: second,
    address: null,
  };
}

test("a conversation is its contact, or the other end's number when the text was never linked", () => {
  assert.equal(conversationKey(msg({ at: "1", lead_id: LEAD_A })), LEAD_A);
  // Inbound: the other end sent it. Outbound: the other end received it.
  assert.equal(conversationKey(msg({ at: "1", from_number: "+1 (555) 555-0123" })), "phone:5555550123");
  assert.equal(
    conversationKey(msg({ at: "1", direction: "outbound", from_number: "+15555550199", to_number: "555-555-0124" })),
    "phone:5555550124"
  );
});

test("each conversation shows once, with its newest text", () => {
  const newestFirst = [
    msg({ at: "5", lead_id: LEAD_A, body: "newest from A" }),
    msg({ at: "4", from_number: "+15555550123", body: "stranger" }),
    msg({ at: "3", lead_id: LEAD_A, body: "older from A" }),
    msg({ at: "2", from_number: "555-555-0123", body: "stranger, older" }),
  ];
  assert.deepEqual(
    latestPerConversation(newestFirst).map((m) => m.body),
    ["newest from A", "stranger"]
  );
});

/** A fake database: `total` texts, newest first, `perConvo` texts in a row per conversation. */
function fakeWindows(total: number, perConvo: number) {
  const calls: [number, number][] = [];
  const rows = Array.from({ length: total }, (_, i) =>
    msg({ at: String(1_000_000 - i), from_number: `+1555${String(Math.floor(i / perConvo)).padStart(7, "0")}` })
  );
  return {
    calls,
    fetch: async (from: number, to: number) => {
      calls.push([from, to]);
      return rows.slice(from, to + 1);
    },
  };
}

test("the list reads the newest texts only until it has a page of conversations", async () => {
  // One text per conversation: the first window already holds hundreds.
  const db = fakeWindows(5000, 1);
  const { latest, hasMore } = await scanConversations(db.fetch, 1);
  assert.deepEqual(db.calls, [[0, SCAN_WINDOW - 1]]);
  assert.ok(latest.length >= CONVERSATIONS_PER_PAGE);
  assert.equal(hasMore, true);
});

test("busy conversations: it keeps reading, but never more than a few windows per page", async () => {
  // 100 texts per conversation: a window of 500 holds only 5 conversations.
  const db = fakeWindows(100_000, 100);
  const one = await scanConversations(db.fetch, 1);
  assert.equal(db.calls.length, MAX_WINDOWS_PER_PAGE);
  assert.equal(one.hasMore, true);
  // Pages read from the top again, further each time.
  db.calls.length = 0;
  await scanConversations(db.fetch, 2);
  assert.equal(db.calls.length, MAX_WINDOWS_PER_PAGE * 2);
  assert.deepEqual(db.calls[1], [SCAN_WINDOW, 2 * SCAN_WINDOW - 1]);
});

test("a short window is the end: nothing older to show", async () => {
  const db = fakeWindows(120, 10);
  const { latest, hasMore } = await scanConversations(db.fetch, 1);
  assert.equal(latest.length, 12);
  assert.equal(hasMore, false);
  assert.equal(db.calls.length, 1);
});

test("names: the contact, a contact matched by phone, a teammate, or just the number", () => {
  const latest = [
    msg({ at: "4", lead_id: LEAD_A, body: "yes" }),
    msg({ at: "3", from_number: "+15555550124", body: "who's this?" }),
    msg({ at: "2", from_number: "+15555550177", body: "running late" }),
    msg({ at: "1", from_number: "+15555550150", body: "STOP" }),
  ];
  const leads = [lead(LEAD_A, "Ana", "(555) 555-0123"), lead(LEAD_B, "Ben", "555-555-0124")];
  const reps = [{ name: "Carl Crew", email: "carl@example.com", phone: "555.555.0177" }];
  const s = summarizeConversations(latest, leads, reps);
  assert.deepEqual(
    s.map((c) => [c.key, c.leadId, c.name, c.phone, c.isCrew, c.lastBody, c.lastAt]),
    [
      [LEAD_A, LEAD_A, "Ana Demo", "(555) 555-0123", false, "yes", "4"],
      // Never linked, but the number is Ben's: his name, and his number to reply to.
      ["phone:5555550124", LEAD_B, "Ben Demo", "555-555-0124", false, "who's this?", "3"],
      // A teammate is said plainly, and never inferred from the name.
      ["phone:5555550177", null, "👷 Carl Crew", "+15555550177", true, "running late", "2"],
      ["phone:5555550150", null, "+15555550150", "+15555550150", false, "STOP", "1"],
    ]
  );
});

test("a conversation the browser asks for must look like one -- nothing else reaches a query", () => {
  assert.deepEqual(parseConversationKey(LEAD_A), { leadId: LEAD_A });
  assert.deepEqual(parseConversationKey("phone:5555550123"), { phoneKey: "5555550123" });
  assert.deepEqual(parseConversationKey("phone:12345"), { phoneKey: "12345" });
  for (const bad of ["", "phone:", "phone:12a", `phone:1,lead_id.eq.${LEAD_A}`, "not-a-uuid", `${LEAD_A})`, 7, null]) {
    assert.equal(parseConversationKey(bad), null, String(bad));
  }
});

test("a thread is read newest first and shown oldest first, saying when more is older", () => {
  const rows = [msg({ at: "3", body: "c" }), msg({ at: "2", body: "b" }), msg({ at: "1", body: "a" })];
  const two = threadFromNewestFirst(rows, 2);
  assert.deepEqual(two.messages.map((m) => m.body), ["b", "c"]);
  assert.equal(two.hasEarlier, true);
  const all = threadFromNewestFirst(rows, 5);
  assert.deepEqual(all.messages.map((m) => m.body), ["a", "b", "c"]);
  assert.equal(all.hasEarlier, false);
});

test("how much is read is decided here, not by whatever the browser sends", () => {
  assert.equal(threadLimit(undefined), THREAD_PAGE);
  assert.equal(threadLimit(-5), THREAD_PAGE);
  assert.equal(threadLimit(THREAD_PAGE * 2), THREAD_PAGE * 2);
  assert.equal(threadLimit(1e9), THREAD_MAX);
  // One more than the limit is read to tell whether older ones exist; it must fit
  // under PostgREST's 1000-row ceiling or "older" would silently read as "none".
  assert.ok(THREAD_MAX + 1 <= 1000);
  assert.equal(conversationPages("x"), 1);
  assert.equal(conversationPages(3), 3);
  assert.equal(conversationPages(999), 20);
});

function summary(key: string, lastAt: string): ConversationSummary {
  return { key, leadId: null, name: key, phone: "", isCrew: false, lastBody: "", lastAt };
}

test("after Show older, a refresh keeps the older ones and never shows a conversation twice", () => {
  const first = [summary("a", "9"), summary("b", "8")];
  // Read from the top earlier: c has since had a new text and moved into the first page.
  const extended = [summary("b", "8"), summary("c", "5"), summary("d", "4"), summary("e", "3")];
  const freshFirst = [summary("c", "10"), summary("a", "9")];
  assert.deepEqual(mergeConversationLists(first, null).map((c) => c.key), ["a", "b"]);
  assert.deepEqual(mergeConversationLists(freshFirst, extended).map((c) => c.key), ["c", "a", "b", "d", "e"]);
});

test("a contact opened from elsewhere is listed even with no texts yet, once", () => {
  const list = [summary(LEAD_A, "9")];
  const target = { leadId: LEAD_B, name: "Ben Demo", phone: "555-555-0124" };
  const withB = withPendingTarget(list, target);
  assert.deepEqual(withB.map((c) => [c.key, c.name, c.phone]), [
    [LEAD_A, LEAD_A, ""],
    [LEAD_B, "Ben Demo", "555-555-0124"],
  ]);
  assert.equal(withPendingTarget(withB, target).length, 2);
  const byPhone = withPendingTarget(list, { leadId: null, name: "+15555550150", phone: "+15555550150" });
  assert.equal(byPhone[1].key, "phone:5555550150");
  assert.equal(withPendingTarget(list, null), list);
});

test("the thread the page loads first is the one the view will open", () => {
  const list = [summary("phone:5555550150", "9")];
  assert.equal(initialConversationKey(LEAD_A, null, list), LEAD_A);
  assert.equal(initialConversationKey(undefined, "+1 555-555-0124", list), "phone:5555550124");
  assert.equal(initialConversationKey(undefined, undefined, list), "phone:5555550150");
  assert.equal(initialConversationKey(undefined, undefined, []), null);
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the page no longer reads every text, and the browser never decides the company", () => {
  const page = source("../app/(app)/reply-inbox/page.tsx");
  assert.doesNotMatch(page, /selectAll|from\("sms_messages"\)/);
  assert.match(page, /loadInboxConversations\(supabase, companyId, 1\)/);
  const actions = source("./actions/reply-inbox.ts");
  assert.match(actions, /^"use server";/);
  // Every action reads the signed-in person's company, and checks the key before any query.
  for (const fn of ["getReplyInboxThread", "getReplyInboxConversations"]) {
    const body = actions.slice(actions.indexOf(`export async function ${fn}`)).split("\n}\n")[0];
    assert.match(body, /getCurrentProfile\(\)/, fn);
    assert.match(body, /profile\.company_id/, fn);
    assert.doesNotMatch(body, /companyId: string|company_id: string/, fn);
  }
  assert.match(actions, /parseConversationKey\(key\)/);
});

test("the same texts are hidden as before: rep-facing ones, except an unmatched crew reply", () => {
  assert.equal(INBOX_CHANNELS, "channel.neq.rep,and(channel.eq.rep,lead_id.is.null,direction.eq.inbound)");
  const data = source("./data/reply-inbox.ts");
  assert.equal((data.match(/\.or\(INBOX_CHANNELS\)/g) ?? []).length, 3);
  const sql = source("../../supabase/migrations/0204_reply_inbox_lookups.sql");
  assert.match(sql, /and \(m\.channel <> 'rep' or m\.direction = 'inbound'\)/);
});

test("the composer only ever points at the conversation picked, and new texts reach the open thread", () => {
  const view = source("../app/(app)/reply-inbox/reply-inbox-view.tsx");
  assert.match(view, /const selected = conversations\.find\(\(c\) => c\.key === selectedKey\) \?\? null;/);
  assert.match(view, /\} else if \(selectedKey === null && conversations\.length > 0\) \{/);
  assert.match(view, /sendSms\(selected\.leadId, selected\.phone, reply\)/);
  const fresh = view.slice(view.indexOf("const onFresh"));
  assert.match(fresh.slice(0, fresh.indexOf("};")), /router\.refresh\(\);\s*setThreadTick\(/);
});

test("the database lookups run as the signed-in person, so who-sees-which-texts still applies", () => {
  const sql = source("../../supabase/migrations/0204_reply_inbox_lookups.sql");
  for (const fn of ["leads_by_phone_keys(uuid, text[])", "reply_inbox_unlinked_thread(uuid, text, integer)"]) {
    const name = fn.slice(0, fn.indexOf("("));
    const def = sql.slice(sql.indexOf(`create or replace function public.${name}`));
    assert.match(def.slice(0, def.indexOf("$$")), /security invoker/, name);
    assert.ok(sql.includes(`revoke all on function public.${fn} from public, anon;`), name);
    assert.ok(sql.includes(`grant execute on function public.${fn} to authenticated, service_role;`), name);
  }
  assert.doesNotMatch(sql, /security definer/);
  // The thread lookup's expression is the index's, or the index goes unused.
  // Both use the app's own key (normalizePhone): digits, the last ten when there are more.
  const expr = "right(regexp_replace(case when direction = 'inbound' then from_number else to_number end, '\\D', '', 'g'), 10)";
  assert.ok(sql.includes(expr));
  assert.ok(sql.includes(expr.replace(/direction|from_number|to_number/g, (w) => `m.${w}`)));
  for (const col of ["phone", "second_contact_phone"]) {
    const key = `right(regexp_replace(${col}, '\\D', '', 'g'), 10)`;
    assert.ok(sql.includes(`(company_id, ${key})`), col);
    assert.ok(sql.includes(key.replace(col, `l.${col}`) + " = any (p_keys)"), col);
  }
});

test("until 0204 is run, both lookups fall back to the old reads instead of failing", () => {
  const lite = source("./data/lead-lite.ts");
  assert.match(lite, /rpc\("leads_by_phone_keys"/);
  assert.match(lite, /error \? await scanBook\(\)/);
  const data = source("./data/reply-inbox.ts");
  assert.match(data, /rpc\("reply_inbox_unlinked_thread"/);
  assert.match(data, /if \(!error\) return threadFromNewestFirst/);
});

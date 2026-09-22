import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FRESH_CAP,
  PREVIEW_CHARS,
  coerceTextAlertRollup,
  conversationKey,
  rollupTextAlerts,
  type TextAlertRow,
} from "./text-alert-rollup.ts";

/**
 * The incoming-text badge and its popups, reduced from a window of
 * sms_messages. These tests pin the buckets the SQL function
 * text_alert_rollup (migration 0168) computes; the TS here is the
 * fallback while that migration hasn't run, so the two must agree.
 */

const LEAD = "11111111-1111-1111-1111-111111111111";
const LEAD2 = "22222222-2222-2222-2222-222222222222";

function row(over: Partial<TextAlertRow> & { id: string; created_at: string }): TextAlertRow {
  return {
    lead_id: null,
    direction: "inbound",
    from_number: "+1 (555) 000-1111",
    to_number: "+15550009999",
    body: "hello",
    ...over,
  };
}

test("a conversation is the lead, or the other party's number when there is no lead", () => {
  assert.equal(conversationKey(row({ id: "a", created_at: "x", lead_id: LEAD })), LEAD);
  // inbound: the customer is the sender
  assert.equal(
    conversationKey(row({ id: "b", created_at: "x", direction: "inbound", from_number: "+1 (555) 000-1111" })),
    "phone:5550001111"
  );
  // outbound: the customer is the recipient
  assert.equal(
    conversationKey(row({ id: "c", created_at: "x", direction: "outbound", to_number: "1-555-000-2222" })),
    "phone:5550002222"
  );
});

test("awaiting counts conversations whose newest message is the customer's", () => {
  const rows = [
    // lead A: they texted, we answered -> not awaiting
    row({ id: "1", lead_id: LEAD, direction: "inbound", created_at: "2026-09-20T10:00:00Z" }),
    row({ id: "2", lead_id: LEAD, direction: "outbound", created_at: "2026-09-20T10:05:00Z" }),
    // lead B: we texted, they answered -> awaiting
    row({ id: "3", lead_id: LEAD2, direction: "outbound", created_at: "2026-09-21T09:00:00Z" }),
    row({ id: "4", lead_id: LEAD2, direction: "inbound", created_at: "2026-09-21T09:30:00Z" }),
    // unknown number, two inbound texts -> one conversation, awaiting
    row({ id: "5", from_number: "5550003333", created_at: "2026-09-21T11:00:00Z" }),
    row({ id: "6", from_number: "(555) 000-3333", created_at: "2026-09-21T11:01:00Z" }),
  ];
  const r = rollupTextAlerts(rows, null);
  assert.equal(r.awaitingCount, 2);
  assert.equal(r.latestIso, "2026-09-21T11:01:00Z");
});

test("the answer does not depend on the order rows arrive in", () => {
  const rows = [
    row({ id: "1", lead_id: LEAD, direction: "inbound", created_at: "2026-09-20T10:00:00Z" }),
    row({ id: "2", lead_id: LEAD, direction: "outbound", created_at: "2026-09-20T10:05:00Z" }),
    row({ id: "3", lead_id: LEAD2, direction: "inbound", created_at: "2026-09-21T09:30:00Z" }),
  ];
  const newestFirst = rollupTextAlerts([...rows].reverse(), "2026-09-19T00:00:00Z");
  const oldestFirst = rollupTextAlerts(rows, "2026-09-19T00:00:00Z");
  assert.deepEqual(newestFirst, oldestFirst);
  assert.equal(newestFirst.awaitingCount, 1);
  assert.deepEqual(
    newestFirst.fresh.map((f) => f.id),
    ["3", "1"]
  );
});

test("fresh is the customer's texts since the watermark, newest first, capped", () => {
  const rows = Array.from({ length: 8 }, (_, i) =>
    row({
      id: `m${i}`,
      lead_id: LEAD,
      direction: i % 2 ? "outbound" : "inbound",
      body: `text number ${i} `.repeat(20),
      created_at: `2026-09-21T10:0${i}:00Z`,
    })
  );
  // Three inbound texts sit after the watermark (m0 is before it); the
  // cap only bites past FRESH_CAP.
  const r = rollupTextAlerts(rows, "2026-09-21T10:01:00Z");
  assert.deepEqual(
    r.fresh.map((f) => f.id),
    ["m6", "m4", "m2"]
  );
  assert.equal(r.fresh[0].preview.length, PREVIEW_CHARS);
  assert.equal(r.fresh[0].leadId, LEAD);

  const many = Array.from({ length: FRESH_CAP + 3 }, (_, i) =>
    row({ id: `f${i}`, created_at: `2026-09-21T11:${String(i).padStart(2, "0")}:00Z` })
  );
  assert.equal(rollupTextAlerts(many, "2026-09-21T00:00:00Z").fresh.length, FRESH_CAP);
});

test("a browser with no watermark gets the count and no popups; an empty window keeps the watermark", () => {
  const rows = [row({ id: "1", created_at: "2026-09-21T10:00:00Z" })];
  const first = rollupTextAlerts(rows, null);
  assert.equal(first.awaitingCount, 1);
  assert.deepEqual(first.fresh, []);

  const empty = rollupTextAlerts([], "2026-09-21T10:00:00Z");
  assert.deepEqual(empty, { awaitingCount: 0, latestIso: "2026-09-21T10:00:00Z", fresh: [] });
});

test("the RPC's answer is checked before it is trusted", () => {
  assert.deepEqual(
    coerceTextAlertRollup({
      awaitingCount: 3,
      latestIso: "2026-09-21T10:00:00+00:00",
      fresh: [
        {
          id: "a",
          leadId: LEAD,
          fromNumber: "+15550001111",
          name: "Pat Jones",
          preview: "hi",
          at: "2026-09-21T10:00:00+00:00",
        },
        { id: 7, leadId: null, fromNumber: "x", name: "", preview: "", at: "y" },
      ],
    }),
    {
      awaitingCount: 3,
      latestIso: "2026-09-21T10:00:00+00:00",
      fresh: [
        {
          id: "a",
          leadId: LEAD,
          fromNumber: "+15550001111",
          name: "Pat Jones",
          preview: "hi",
          at: "2026-09-21T10:00:00+00:00",
        },
      ],
    }
  );
  assert.equal(coerceTextAlertRollup(null), null);
  assert.equal(coerceTextAlertRollup("nope"), null);
  assert.equal(coerceTextAlertRollup({ awaitingCount: "3" }), null);
  // A null latest is a legitimate empty window, not garbage.
  assert.deepEqual(coerceTextAlertRollup({ awaitingCount: 0, latestIso: null, fresh: [] }), {
    awaitingCount: 0,
    latestIso: null,
    fresh: [],
  });
});

// ── the SQL must agree with the mirror ─────────────────────────────

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "supabase", "migrations");

function latestDefinition(name: string): string {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  let body: string | null = null;
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    const def = new RegExp(String.raw`create\s+or\s+replace\s+function\s+public\.${name}\s*\(`, "i").exec(sql);
    if (!def) continue;
    const open = sql.indexOf("$$", def.index);
    const close = sql.indexOf("$$", open + 2);
    assert.ok(close > open, `${file}: unterminated $$ body for ${name}`);
    body = sql.slice(def.index, close);
  }
  assert.ok(body, `no migration defines ${name}`);
  return body;
}

test("text_alert_rollup keys, filters and caps exactly as the mirror does", () => {
  const sql = latestDefinition("text_alert_rollup");
  // The caller's RLS, never the definer's.
  assert.match(sql, /security invoker/i);
  // Same exclusion the Reply Inbox and the fallback apply.
  assert.match(sql, /channel <> 'rep'/);
  assert.match(sql, /channel = 'rep' and lead_id is null and direction = 'inbound'/);
  // normalizePhone: digits only, last ten.
  assert.match(sql, /regexp_replace\([^)]*'\\D', '', 'g'\)/);
  assert.match(sql, /right\(\s*regexp_replace\([\s\S]*?\),\s*10\s*\)/);
  // Counterparty: the sender of an inbound text, the recipient otherwise.
  assert.match(sql, /when direction = 'inbound' then from_number else to_number/);
  // Newest per conversation decides "awaiting".
  assert.match(sql, /distinct on \(conv_key\)/);
  assert.match(sql, /order by conv_key, created_at desc, id desc/);
  // The popups: inbound, after the watermark, newest first, capped, previewed.
  assert.match(sql, new RegExp(String.raw`limit ${FRESH_CAP}\b`));
  assert.match(sql, new RegExp(String.raw`left\(coalesce\(w\.body, ''\), ${PREVIEW_CHARS}\)`));
  assert.match(sql, /w\.direction = 'inbound' and w\.created_at > p_since/);
});

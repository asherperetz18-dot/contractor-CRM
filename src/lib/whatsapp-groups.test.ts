import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  groupMessagesFromWebhook,
  groupOptions,
  initialMediaStatus,
  isGroupChat,
  MAX_MEDIA_BYTES,
  MEDIA_TRIES,
  mediaStatusAfterFailure,
  senderLabel,
  webhookUrl,
  withOurWebhook,
  withoutOurWebhook,
} from "./whatsapp-groups.ts";

/**
 * Project WhatsApp groups (DECISIONS #193). A dedicated "project bot"
 * number sits in each project's group through Whapi.Cloud, which posts
 * every message to our webhook in the shape of its own `Message` type
 * (Whapi's published whapi.d.ts). These tests pin which of those become
 * a project's record, how the photo/video/document is described for the
 * download step, who a message is shown as from, and the webhook
 * registration that must never clobber a company's other hooks.
 */

const GROUP = "120363041234567890@g.us";

function msg(overrides: Record<string, unknown>) {
  return {
    id: "wamid-1",
    type: "text",
    chat_id: GROUP,
    from: "14155551234",
    from_me: false,
    from_name: "Dana",
    timestamp: 1760000000,
    text: { body: "Tile arrived" },
    ...overrides,
  };
}

test("isGroupChat: only WhatsApp group ids", () => {
  assert.equal(isGroupChat(GROUP), true);
  assert.equal(isGroupChat("14155551234@s.whatsapp.net"), false);
  assert.equal(isGroupChat("120363041234567890@newsletter"), false);
  assert.equal(isGroupChat(""), false);
  assert.equal(isGroupChat(undefined), false);
});

test("a group text becomes one row", () => {
  const rows = groupMessagesFromWebhook({ messages: [msg({})], event: { type: "messages", event: "post" } });
  assert.deepEqual(rows, [
    {
      waMessageId: "wamid-1",
      groupId: GROUP,
      senderPhone: "14155551234",
      senderName: "Dana",
      fromMe: false,
      kind: "text",
      body: "Tile arrived",
      media: null,
      sentAt: new Date(1760000000 * 1000).toISOString(),
    },
  ]);
});

test("a photo keeps its caption and what the download step needs", () => {
  const [row] = groupMessagesFromWebhook({
    messages: [
      msg({
        id: "wamid-photo",
        type: "image",
        text: undefined,
        image: { id: "jpeg-abc123", mime_type: "image/jpeg", file_size: 245_000, caption: "Before demo" },
      }),
    ],
  });
  assert.equal(row.kind, "image");
  assert.equal(row.body, "Before demo");
  assert.deepEqual(row.media, {
    id: "jpeg-abc123",
    mimeType: "image/jpeg",
    size: 245_000,
    fileName: "whatsapp-2025-10-09-wamid-photo.jpg",
  });
});

test("a document keeps its own file name, made safe for storage", () => {
  const [row] = groupMessagesFromWebhook({
    messages: [
      msg({
        id: "wamid-doc",
        type: "document",
        text: undefined,
        document: {
          id: "pdf-1",
          mime_type: "application/pdf",
          file_size: 90_000,
          filename: "Permit #42 (final).pdf",
        },
      }),
    ],
  });
  assert.equal(row.kind, "document");
  assert.equal(row.body, null);
  assert.equal(row.media?.fileName, "Permit_42_final_.pdf");
});

test("video, gif, audio and voice notes are kept as media", () => {
  const rows = groupMessagesFromWebhook({
    messages: [
      msg({ id: "v", type: "video", text: undefined, video: { id: "mp4-1", mime_type: "video/mp4", file_size: 1 } }),
      msg({ id: "g", type: "gif", text: undefined, gif: { id: "mp4-2", mime_type: "video/mp4", file_size: 1 } }),
      msg({ id: "a", type: "audio", text: undefined, audio: { id: "mp3-1", mime_type: "audio/mpeg", file_size: 1 } }),
      msg({ id: "n", type: "voice", text: undefined, voice: { id: "ogg-1", mime_type: "audio/ogg; codecs=opus", file_size: 1 } }),
    ],
  });
  assert.deepEqual(
    rows.map((r) => [r.kind, r.media?.fileName]),
    [
      ["video", "whatsapp-2025-10-09-v.mp4"],
      ["video", "whatsapp-2025-10-09-g.mp4"],
      ["audio", "whatsapp-2025-10-09-a.mp3"],
      ["audio", "whatsapp-2025-10-09-n.ogg"],
    ]
  );
});

test("a pasted link reads as its text", () => {
  const [row] = groupMessagesFromWebhook({
    messages: [
      msg({
        type: "link_preview",
        text: undefined,
        link_preview: { body: "Spec sheet https://example.com/tile", title: "Tile" },
      }),
    ],
  });
  assert.equal(row.kind, "text");
  assert.equal(row.body, "Spec sheet https://example.com/tile");
  assert.equal(row.media, null);
});

test("private chats, system notices, reactions and stickers are not a project's record", () => {
  const rows = groupMessagesFromWebhook({
    messages: [
      msg({ chat_id: "14155551234@s.whatsapp.net" }),
      msg({ id: "sys", type: "system", text: undefined, system: { body: "Dana added Lee" } }),
      msg({ id: "react", type: "action", text: undefined, action: { type: "reaction", emoji: "👍" } }),
      msg({ id: "sticker", type: "sticker", text: undefined, sticker: { id: "webp-1", mime_type: "image/webp" } }),
      msg({ id: "empty", text: { body: "   " } }),
    ],
  });
  assert.deepEqual(rows, []);
});

test("media without an id to fetch it by is not kept", () => {
  const rows = groupMessagesFromWebhook({
    messages: [msg({ type: "image", text: undefined, image: { mime_type: "image/jpeg", file_size: 1 } })],
  });
  assert.deepEqual(rows, []);
});

test("the bot number's own posts are kept and marked", () => {
  const [row] = groupMessagesFromWebhook({ messages: [msg({ from_me: true, from: undefined, from_name: undefined })] });
  assert.equal(row.fromMe, true);
  assert.equal(row.senderPhone, null);
  assert.equal(row.senderName, null);
});

test("a hidden number (WhatsApp's @lid) is not taken for a phone", () => {
  const [row] = groupMessagesFromWebhook({ messages: [msg({ from: "203940985823123@lid" })] });
  assert.equal(row.senderPhone, null);
  assert.equal(row.senderName, "Dana");
});

test("a sender id with a suffix keeps only the number", () => {
  const [row] = groupMessagesFromWebhook({ messages: [msg({ from: "14155551234@s.whatsapp.net" })] });
  assert.equal(row.senderPhone, "14155551234");
});

test("junk never throws and yields nothing", () => {
  for (const body of [null, undefined, "x", 42, [], {}, { messages: "no" }, { messages: [null, 1, "x", {}] }]) {
    assert.deepEqual(groupMessagesFromWebhook(body), []);
  }
});

test("a message without a usable time is dropped rather than misdated", () => {
  assert.deepEqual(groupMessagesFromWebhook({ messages: [msg({ timestamp: "soon" })] }), []);
});

test("MAX_MEDIA_BYTES fits a phone video but not an unbounded download", () => {
  assert.ok(MAX_MEDIA_BYTES >= 16 * 1024 * 1024);
  assert.ok(MAX_MEDIA_BYTES <= 80 * 1024 * 1024);
});

const people = {
  staff: [
    { name: "Asher Peretz", phone: "(415) 555-1234" },
    { name: "Lee Crew", phone: "+1 818 555 0000" },
    { name: "No Phone", phone: null },
  ],
  client: { name: "Jane Homeowner", phones: ["818-555-9999", null] },
};

test("senderLabel: staff by their phone on the roster", () => {
  assert.deepEqual(senderLabel({ senderPhone: "14155551234", senderName: "Ash", fromMe: false }, people), {
    label: "Asher Peretz",
    who: "staff",
  });
});

test("senderLabel: the client by any number on their card", () => {
  assert.deepEqual(senderLabel({ senderPhone: "18185559999", senderName: "J", fromMe: false }, people), {
    label: "Jane Homeowner (client)",
    who: "client",
  });
});

test("senderLabel: anyone else by their WhatsApp name, then number", () => {
  assert.deepEqual(senderLabel({ senderPhone: "13105550101", senderName: "Plumber Mike", fromMe: false }, people), {
    label: "Plumber Mike",
    who: "other",
  });
  assert.deepEqual(senderLabel({ senderPhone: "13105550101", senderName: null, fromMe: false }, people), {
    label: "+13105550101",
    who: "other",
  });
  assert.deepEqual(senderLabel({ senderPhone: null, senderName: null, fromMe: false }, people), {
    label: "Someone in the group",
    who: "other",
  });
});

test("senderLabel: the bot number's own posts", () => {
  assert.deepEqual(senderLabel({ senderPhone: null, senderName: null, fromMe: true }, people), {
    label: "Project bot number",
    who: "staff",
  });
});

test("groupOptions: alphabetical, this project's groups left out, others named", () => {
  const options = groupOptions(
    [
      { id: "b@g.us", name: "Smith kitchen" },
      { id: "a@g.us", name: "adams bath" },
      { id: "c@g.us", name: "" },
      { id: "here@g.us", name: "Already here" },
    ],
    [
      { group_id: "here@g.us", estimate_id: "est-1", label: "Jones" },
      { group_id: "b@g.us", estimate_id: "est-2", label: "Smith" },
    ],
    "est-1"
  );
  assert.deepEqual(options, [
    { id: "a@g.us", name: "adams bath", linkedTo: null },
    { id: "b@g.us", name: "Smith kitchen", linkedTo: "Smith" },
    { id: "c@g.us", name: "Unnamed group", linkedTo: null },
  ]);
});

test("webhookUrl: the company and its secret ride in the query", () => {
  assert.equal(
    webhookUrl("https://crm.example.com", "co-1", "tok"),
    "https://crm.example.com/api/whatsapp/webhook?c=co-1&t=tok"
  );
});

test("withOurWebhook: replaces this company's old hook, keeps everyone else's", () => {
  const other = { url: "https://n8n.example.com/hook", events: [{ type: "messages", method: "post" }], mode: "body" };
  const otherCompany = { url: "https://crm.example.com/api/whatsapp/webhook?c=co-2&t=x", mode: "body" };
  const stale = { url: "https://crm.example.com/api/whatsapp/webhook?c=co-1&t=old", mode: "body" };
  const next = withOurWebhook([other, otherCompany, stale], "https://crm.example.com/api/whatsapp/webhook?c=co-1&t=new");
  assert.deepEqual(next, [
    other,
    otherCompany,
    {
      url: "https://crm.example.com/api/whatsapp/webhook?c=co-1&t=new",
      events: [{ type: "messages", method: "post" }],
      mode: "body",
    },
  ]);
});

test("withOurWebhook: no hooks yet, or junk, still yields ours", () => {
  for (const existing of [undefined, null, "x", [null, 3]]) {
    assert.deepEqual(withOurWebhook(existing, "https://crm.example.com/api/whatsapp/webhook?c=co-1&t=new"), [
      {
        url: "https://crm.example.com/api/whatsapp/webhook?c=co-1&t=new",
        events: [{ type: "messages", method: "post" }],
        mode: "body",
      },
    ]);
  }
});

test("withoutOurWebhook: removes only this company's hook", () => {
  const other = { url: "https://n8n.example.com/hook" };
  const ours = { url: "https://crm.example.com/api/whatsapp/webhook?c=co-1&t=new" };
  assert.deepEqual(withoutOurWebhook([other, ours], "co-1"), [other]);
  assert.deepEqual(withoutOurWebhook(undefined, "co-1"), []);
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("0228 keeps the token where no CRM user can read it, and only the server writes", () => {
  const sql = source("../../supabase/migrations/0228_whatsapp_groups.sql");
  assert.match(sql, /api_token_enc text/);
  assert.match(sql, /webhook_token_enc text/);
  assert.match(sql, /alter table public\.whatsapp_connections enable row level security;/);
  assert.match(sql, /revoke all on public\.whatsapp_connections from anon, authenticated;/);
  for (const table of ["whatsapp_group_links", "whatsapp_group_messages"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security;`));
    assert.match(sql, new RegExp(`revoke insert, update, delete on public\\.${table} from anon, authenticated;`));
    assert.match(sql, new RegExp(`create policy ${table}_select on public\\.${table} for select`));
  }
  // Seen by whoever can see the project: the link through estimates'
  // own RLS, a message through its group's link.
  assert.match(sql, /exists \(select 1 from public\.estimates e where e\.id = whatsapp_group_links\.estimate_id\)/);
  assert.match(sql, /select 1 from public\.whatsapp_group_links l\s+where l\.company_id = whatsapp_group_messages\.company_id\s+and l\.group_id = whatsapp_group_messages\.group_id/);
  // Whapi retries a post it thinks failed: one row per WhatsApp message.
  assert.match(sql, /unique \(company_id, wa_message_id\)/);
  assert.match(sql, /select public\.apply_billing_lock_policies\(\);/);

  const backup = source("./backup-scope.ts");
  assert.match(backup, /"whatsapp_group_links"/);
  assert.match(backup, /"whatsapp_group_messages"/);
  assert.match(backup, /whatsapp_connections:/);
  assert.match(source("./schema-drift.ts"), /0228_whatsapp_groups\.sql/);
});

test("initialMediaStatus: a file waits to be copied unless it's too big to copy", () => {
  assert.equal(initialMediaStatus(null), "none");
  assert.equal(initialMediaStatus({ id: "m", mimeType: "image/jpeg", size: 300_000, fileName: "a.jpg" }), "pending");
  assert.equal(initialMediaStatus({ id: "m", mimeType: "video/mp4", size: null, fileName: "a.mp4" }), "pending");
  assert.equal(
    initialMediaStatus({ id: "m", mimeType: "video/mp4", size: MAX_MEDIA_BYTES + 1, fileName: "a.mp4" }),
    "too_large"
  );
});

test("mediaStatusAfterFailure: retried on the next message, then given up on", () => {
  assert.equal(MEDIA_TRIES, 3);
  assert.equal(mediaStatusAfterFailure(1), "pending");
  assert.equal(mediaStatusAfterFailure(2), "pending");
  assert.equal(mediaStatusAfterFailure(3), "failed");
  assert.equal(mediaStatusAfterFailure(9), "failed");
});

test("the webhook checks its secret before it files anything", () => {
  const route = source("../app/api/whatsapp/webhook/route.ts");
  const check = route.indexOf("sameSecret(");
  assert.ok(check > 0 && check < route.indexOf("storeGroupMessages("), "secret first");
});

test("linking and unlinking check the role and the job before writing", () => {
  const actions = source("./actions/whatsapp-groups.ts");
  for (const name of ["linkWhatsAppGroup", "unlinkWhatsAppGroup"]) {
    const fn = actions.slice(actions.indexOf(`export async function ${name}`));
    const next = fn.indexOf("\nexport ", 1);
    const body = next > 0 ? fn.slice(0, next) : fn;
    const write = body.search(/\.(upsert|delete)\(/);
    assert.ok(write > 0, `${name} writes`);
    assert.ok(body.indexOf("requireLinker()") > 0 && body.indexOf("requireLinker()") < write, `${name}: role first`);
    assert.ok(body.indexOf("visibleJob(") > 0 && body.indexOf("visibleJob(") < write, `${name}: job first`);
  }
});

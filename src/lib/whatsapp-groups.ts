import { phoneKey } from "./data/phone-match.ts";

/**
 * Project WhatsApp groups (DECISIONS #193): the pure rules.
 *
 * Each company puts one dedicated WhatsApp number -- the "project bot" --
 * into its project groups, connected through Whapi.Cloud. Whapi posts
 * every message that number sees to our webhook, shaped like its own
 * `Message` type (whapi.d.ts in Whapi's SDK). This module decides which
 * of those become a project's record and what each one says; the
 * database and network sides live in src/lib/whatsapp-company.ts and the
 * webhook route. No runtime imports beyond phone-match, so it's tested
 * without a database.
 */

/** Photos/videos/documents over this are left in WhatsApp, not copied:
 *  a phone video is well under it, and the copy runs inside one
 *  serverless invocation. */
export const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

/** Copy attempts before a file is left in WhatsApp for good. A failed
 *  copy is retried when the group's next message arrives. */
export const MEDIA_TRIES = 3;

export type MediaStatus = "none" | "pending" | "saving" | "saved" | "failed" | "too_large";

export type GroupMessageKind = "text" | "image" | "video" | "document" | "audio";

export type GroupMessageMedia = {
  /** Whapi's id for the file -- GET /media/{id} returns its bytes. */
  id: string;
  mimeType: string | null;
  size: number | null;
  /** What the copy is called in the project's files. */
  fileName: string;
};

export type GroupMessage = {
  waMessageId: string;
  groupId: string;
  /** Digits as WhatsApp gave them, or null when it hid the number. */
  senderPhone: string | null;
  senderName: string | null;
  /** Posted by the bot number itself (from its phone). */
  fromMe: boolean;
  kind: GroupMessageKind;
  /** The text, or a photo's caption. */
  body: string | null;
  media: GroupMessageMedia | null;
  sentAt: string;
};

export function isGroupChat(chatId: string | null | undefined): boolean {
  return typeof chatId === "string" && chatId.endsWith("@g.us");
}

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// Whapi's message type → what the project keeps it as. Everything else
// (system notices, reactions, stickers, polls, locations, calls...) is
// chatter about the group, not the job's record.
const MEDIA_KINDS: Record<string, GroupMessageKind> = {
  image: "image",
  video: "video",
  gif: "video",
  document: "document",
  audio: "audio",
  voice: "audio",
};

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "application/pdf": "pdf",
};

function extensionFor(mimeType: string | null): string {
  const base = (mimeType ?? "").split(";")[0].trim().toLowerCase();
  if (EXTENSIONS[base]) return EXTENSIONS[base];
  const sub = base.split("/")[1] ?? "";
  return /^[a-z0-9]{1,5}$/.test(sub) ? sub : "bin";
}

/** Same character rule as an upload's storage path, runs collapsed. */
function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-120);
}

/** The number WhatsApp gave for a sender, or null. Group members can
 *  appear under a "@lid" -- an id WhatsApp uses to hide the number --
 *  which must not be read as a phone. */
function senderPhoneOf(from: unknown): string | null {
  const raw = str(from);
  if (!raw) return null;
  const [user, server] = raw.split("@");
  if (server === "lid") return null;
  return /^\d{7,15}$/.test(user) ? user : null;
}

function oneMessage(raw: unknown): GroupMessage | null {
  const m = obj(raw);
  if (!m) return null;
  const waMessageId = str(m.id);
  const groupId = str(m.chat_id);
  const type = str(m.type);
  const seconds = typeof m.timestamp === "number" && Number.isFinite(m.timestamp) ? m.timestamp : null;
  if (!waMessageId || !groupId || !isGroupChat(groupId) || !type || seconds === null) return null;
  const sentAt = new Date(seconds * 1000);

  let kind: GroupMessageKind;
  let body: string | null = null;
  let media: GroupMessageMedia | null = null;

  if (type === "text") {
    kind = "text";
    body = str(obj(m.text)?.body);
  } else if (type === "link_preview") {
    kind = "text";
    body = str(obj(m.link_preview)?.body);
  } else if (MEDIA_KINDS[type]) {
    kind = MEDIA_KINDS[type];
    const content = obj(m[type]);
    const id = str(content?.id);
    if (!content || !id) return null;
    const mimeType = str(content.mime_type);
    const named = str(content.filename);
    body = str(content.caption);
    media = {
      id,
      mimeType,
      size: typeof content.file_size === "number" ? content.file_size : null,
      fileName: named
        ? safeFileName(named)
        : `whatsapp-${sentAt.toISOString().slice(0, 10)}-${safeFileName(waMessageId)}.${extensionFor(mimeType)}`,
    };
  } else {
    return null;
  }
  if (!body && !media) return null;

  return {
    waMessageId,
    groupId,
    senderPhone: senderPhoneOf(m.from),
    senderName: str(m.from_name),
    fromMe: m.from_me === true,
    kind,
    body,
    media,
    sentAt: sentAt.toISOString(),
  };
}

/**
 * The group messages in one Whapi webhook post (or one page of
 * GET /messages/list/{group}, which carries the same `messages` array).
 * Never throws: anything unreadable is simply not kept.
 */
export function groupMessagesFromWebhook(body: unknown): GroupMessage[] {
  const list = obj(body)?.messages;
  if (!Array.isArray(list)) return [];
  return list.map(oneMessage).filter((m): m is GroupMessage => m !== null);
}

/** Where a newly arrived message's file starts. */
export function initialMediaStatus(media: GroupMessageMedia | null): MediaStatus {
  if (!media) return "none";
  return media.size !== null && media.size > MAX_MEDIA_BYTES ? "too_large" : "pending";
}

/** After the attempt numbered `attempts` failed. */
export function mediaStatusAfterFailure(attempts: number): MediaStatus {
  return attempts >= MEDIA_TRIES ? "failed" : "pending";
}

export type SenderPeople = {
  staff: { name: string | null; phone: string | null }[];
  client: { name: string; phones: (string | null)[] } | null;
};

/**
 * Who a message is shown as from. Matched by phone at display time,
 * not when it arrives, so adding a crew member's number to their
 * profile names every message they've ever sent.
 */
export function senderLabel(
  message: Pick<GroupMessage, "senderPhone" | "senderName" | "fromMe">,
  people: SenderPeople
): { label: string; who: "staff" | "client" | "other" } {
  if (message.fromMe) return { label: "Project bot number", who: "staff" };
  const key = phoneKey(message.senderPhone);
  if (key) {
    const staff = people.staff.find((s) => phoneKey(s.phone) === key);
    if (staff) return { label: staff.name || message.senderName || "Team member", who: "staff" };
    if (people.client?.phones.some((p) => phoneKey(p) === key)) {
      return { label: `${people.client.name} (client)`, who: "client" };
    }
  }
  if (message.senderName) return { label: message.senderName, who: "other" };
  if (message.senderPhone) return { label: `+${message.senderPhone}`, who: "other" };
  return { label: "Someone in the group", who: "other" };
}

/**
 * The groups offered in a project's "Link a group" picker: every group
 * the bot number is in, alphabetical, minus the ones already on this
 * project, with the project any other one is already linked to -- a
 * group belongs to one project, so picking it there moves it.
 */
export function groupOptions(
  groups: { id: string; name: string }[],
  links: { group_id: string; estimate_id: string; label: string }[],
  estimateId: string
): { id: string; name: string; linkedTo: string | null }[] {
  const linkOf = new Map(links.map((l) => [l.group_id, l]));
  return groups
    .filter((g) => linkOf.get(g.id)?.estimate_id !== estimateId)
    .map((g) => ({ id: g.id, name: g.name.trim() || "Unnamed group", linkedTo: linkOf.get(g.id)?.label ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

const WEBHOOK_PATH = "/api/whatsapp/webhook";

export function webhookUrl(origin: string, companyId: string, token: string): string {
  return `${origin}${WEBHOOK_PATH}?c=${encodeURIComponent(companyId)}&t=${encodeURIComponent(token)}`;
}

/** Whether a registered hook is this company's CRM webhook, on any of
 *  the CRM's addresses and with any (old) secret. */
function isOurs(hook: unknown, companyId: string): boolean {
  const url = str(obj(hook)?.url);
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.pathname === WEBHOOK_PATH && u.searchParams.get("c") === companyId;
  } catch {
    return false;
  }
}

/**
 * The channel's webhook list with ours set to `url`. Whapi's
 * PATCH /settings replaces the whole list, so a company that also feeds
 * the number to another tool keeps that hook.
 */
export function withOurWebhook(existing: unknown, url: string): unknown[] {
  const companyId = new URL(url).searchParams.get("c") ?? "";
  return [
    ...withoutOurWebhook(existing, companyId),
    { url, events: [{ type: "messages", method: "post" }], mode: "body" },
  ];
}

export function withoutOurWebhook(existing: unknown, companyId: string): unknown[] {
  if (!Array.isArray(existing)) return [];
  return existing.filter((h) => obj(h) !== null && !isOurs(h, companyId));
}

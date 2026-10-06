import { leadDisplayName, normalizePhone, type LeadLite } from "./data/types.ts";
import type { ReplyTargetSnapshot } from "./reply-target.ts";

/**
 * The Reply Inbox's rules, kept apart from the database and React so the
 * page, its actions and the tests share them (DECISIONS #141).
 *
 * The inbox used to read every text the company ever sent or received --
 * on every visit, and again every time a new one arrived -- and group
 * them into conversations in the browser. Now the list reads the newest
 * texts only until it has a page of conversations, and a conversation's
 * messages are read when it is opened.
 */

/**
 * Which texts the inbox shows: everything but rep-facing texts.
 *
 * Rep-facing texts were landing here as conversations keyed by the rep's
 * phone, so a teammate appeared in the list looking like a client -- and
 * replying in that thread sent the customer message straight to the rep.
 *
 * With one exception: a crew reply we could not tie to any appointment.
 * Those have no job page to appear on, so excluding them here means they
 * exist in the database and nowhere else. They key by the rep's own
 * phone rather than a lead, so they cannot reappear inside a customer's
 * thread -- which is what the exclusion was protecting against.
 */
export const INBOX_CHANNELS = "channel.neq.rep,and(channel.eq.rep,lead_id.is.null,direction.eq.inbound)";

/** The list grows a page of conversations at a time... */
export const CONVERSATIONS_PER_PAGE = 50;
/** ...read from texts this many at a time, newest first... */
export const SCAN_WINDOW = 500;
/** ...and no more than this many reads per page, however busy the threads. */
export const MAX_WINDOWS_PER_PAGE = 4;

/** An opened conversation shows its newest messages, more on request, up to a cap. */
export const THREAD_PAGE = 100;
export const THREAD_MAX = 500;

export type InboxMessage = {
  id: string;
  lead_id: string | null;
  direction: "inbound" | "outbound";
  from_number: string;
  to_number: string;
  body: string;
  created_at: string;
};

/** One row of the list. */
export type ConversationSummary = {
  key: string;
  leadId: string | null;
  name: string;
  phone: string;
  /**
   * The other end of this thread is a teammate, not a customer. Carried
   * explicitly rather than inferred from the name, because everything in
   * the thread -- who a reply is addressed to, what the send button
   * promises -- turns on it.
   */
  isCrew: boolean;
  lastBody: string;
  lastAt: string;
};

export type InboxRep = { name: string | null; email: string | null; phone: string | null };

/** The number on the other end: whoever sent an inbound text, whoever got an outbound one. */
export function counterpartyNumber(m: Pick<InboxMessage, "direction" | "from_number" | "to_number">): string {
  return m.direction === "inbound" ? m.from_number : m.to_number;
}

/** A conversation is its contact, or the other end's number when the text was never linked to one. */
export function conversationKey(m: Pick<InboxMessage, "lead_id" | "direction" | "from_number" | "to_number">): string {
  return m.lead_id ?? `phone:${normalizePhone(counterpartyNumber(m))}`;
}

/** From texts newest first: each conversation's newest text, in that order. */
export function latestPerConversation<T extends InboxMessage>(newestFirst: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const m of newestFirst) {
    const key = conversationKey(m);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

/**
 * Reads texts newest first, a window at a time, until it has `pages`
 * pages of conversations. Every conversation it returns is complete and
 * in the right place: its newest text is in what was read, and anything
 * not read is older than all of them. `hasMore` is false only when the
 * texts ran out.
 *
 * Windows go by offset: a text arriving mid-read pushes the rest down
 * one, which only repeats a text already seen -- never skips one.
 */
export async function scanConversations<T extends InboxMessage>(
  fetchWindow: (from: number, to: number) => Promise<T[]>,
  pages: number
): Promise<{ latest: T[]; hasMore: boolean }> {
  const want = pages * CONVERSATIONS_PER_PAGE;
  const seen = new Set<string>();
  const latest: T[] = [];
  let offset = 0;
  for (let w = 0; w < pages * MAX_WINDOWS_PER_PAGE; w++) {
    const rows = await fetchWindow(offset, offset + SCAN_WINDOW - 1);
    for (const m of rows) {
      const key = conversationKey(m);
      if (seen.has(key)) continue;
      seen.add(key);
      latest.push(m);
    }
    offset += rows.length;
    if (rows.length < SCAN_WINDOW) return { latest, hasMore: false };
    if (latest.length >= want) return { latest, hasMore: true };
  }
  return { latest, hasMore: true };
}

/**
 * Each conversation's name and the number a reply goes to.
 *
 * A text never linked to a contact is matched by its number -- like
 * caller ID matching a saved contact even when the phone system itself
 * has no contact ID. Some are with a teammate's own phone (e.g. the
 * "Text Rep Info" appointment nudges), not a contact, so both are tried.
 */
export function summarizeConversations(
  latest: readonly InboxMessage[],
  leads: readonly LeadLite[],
  reps: readonly InboxRep[]
): ConversationSummary[] {
  return latest.map((m) => {
    const other = counterpartyNumber(m);
    const otherKey = normalizePhone(other);
    const lead = m.lead_id
      ? leads.find((l) => l.id === m.lead_id) ?? null
      : leads.find((l) => l.phone && normalizePhone(l.phone) === otherKey) ?? null;
    const rep = !lead ? reps.find((r) => r.phone && normalizePhone(r.phone) === otherKey) ?? null : null;
    return {
      key: conversationKey(m),
      leadId: m.lead_id ?? lead?.id ?? null,
      name: lead ? leadDisplayName(lead) : rep ? `👷 ${rep.name || rep.email}` : other,
      phone: lead?.phone || other,
      isCrew: !!rep,
      lastBody: m.body,
      lastAt: m.created_at,
    };
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ThreadKey = { leadId: string } | { phoneKey: string };

/** A conversation key from the browser, checked before it reaches any query; null if it isn't one. */
export function parseConversationKey(key: unknown): ThreadKey | null {
  if (typeof key !== "string") return null;
  if (UUID.test(key)) return { leadId: key };
  const phone = /^phone:(\d{1,15})$/.exec(key);
  return phone ? { phoneKey: phone[1] } : null;
}

/** How many of a thread's messages to read: from the browser's ask, kept between one page and the cap. */
export function threadLimit(requested: unknown): number {
  const n = typeof requested === "number" && Number.isFinite(requested) ? Math.floor(requested) : 0;
  return Math.min(Math.max(n, THREAD_PAGE), THREAD_MAX);
}

/** How many pages of the list to read: at least one, at most twenty. */
export function conversationPages(requested: unknown): number {
  const n = typeof requested === "number" && Number.isFinite(requested) ? Math.floor(requested) : 1;
  return Math.min(Math.max(n, 1), 20);
}

/** A thread's messages from a newest-first read of one more than `limit`: oldest first, and whether older exist. */
export function threadFromNewestFirst<T>(newestFirst: readonly T[], limit: number): { messages: T[]; hasEarlier: boolean } {
  return { messages: newestFirst.slice(0, limit).reverse(), hasEarlier: newestFirst.length > limit };
}

/**
 * The list on screen: the page's first page, then what "Show older
 * conversations" read, minus anything the first page already has.
 *
 * The longer list was read from the top too, so a refresh of the first
 * page can't open a gap between the two. A conversation that got a new
 * text moved into the first page (and is dropped from the rest); one
 * that didn't is older than everything in the first page, so the order
 * holds.
 */
export function mergeConversationLists(
  first: readonly ConversationSummary[],
  extended: readonly ConversationSummary[] | null
): ConversationSummary[] {
  if (!extended) return [...first];
  const inFirst = new Set(first.map((c) => c.key));
  return [...first, ...extended.filter((c) => !inFirst.has(c.key))];
}

/**
 * A contact opened from elsewhere ("text this contact", a popup) gets a
 * row even when the list doesn't carry it -- no texts yet, or none
 * recent enough -- so it can be selected and texted.
 */
export function withPendingTarget(
  list: ConversationSummary[],
  target: ReplyTargetSnapshot | null
): ConversationSummary[] {
  if (!target) return list;
  const key = target.leadId ?? (target.phone ? `phone:${normalizePhone(target.phone)}` : null);
  if (!key || list.some((c) => c.key === key)) return list;
  return [
    ...list,
    { key, leadId: target.leadId, name: target.name, phone: target.phone, isCrew: false, lastBody: "", lastAt: "" },
  ];
}

/** The conversation the view opens on: the contact or number it was sent to, else the newest. */
export function initialConversationKey(
  leadId: string | null | undefined,
  phone: string | null | undefined,
  list: readonly ConversationSummary[]
): string | null {
  return leadId || (phone ? `phone:${normalizePhone(phone)}` : null) || list[0]?.key || null;
}

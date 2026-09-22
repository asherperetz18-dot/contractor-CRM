import { normalizePhone } from "./types.ts";

/**
 * The incoming-text badge and its popups, reduced from a window of
 * sms_messages.
 *
 * Every open tab asks for this every 20 seconds (the popup watcher), and
 * the answer used to be computed here from EVERY text of the last 30
 * days -- walked out of the database in 1000-row pages, per poll, per
 * tab. Migration 0168 moves the reduction into Postgres
 * (text_alert_rollup); this module is its exact mirror, pinned by tests,
 * and doubles as the fallback while that migration hasn't run. See
 * DECISIONS #062.
 *
 * "Waiting on us" means the customer spoke last -- the same grouping the
 * Reply Inbox draws, so the badge and the page can never disagree about
 * what needs attention. A conversation is a lead, or (for a text never
 * linked to one) the other party's number.
 */

export type TextAlertRow = {
  id: string;
  lead_id: string | null;
  direction: "inbound" | "outbound";
  from_number: string;
  to_number: string;
  body: string | null;
  created_at: string;
};

/** One toast's worth of a new incoming text. */
export type FreshText = {
  id: string;
  leadId: string | null;
  /** The sender's number -- the inbox deep-links by it when the text
   *  matched no lead. */
  fromNumber: string;
  /** Who it's from: the lead's name, or the bare number. */
  name: string;
  preview: string;
  at: string;
};

export type TextAlertRollup = {
  awaitingCount: number;
  latestIso: string | null;
  fresh: FreshText[];
};

/** The window the badge counts over. A thread silent for a month is
 *  not an alert, it is history. */
export const TEXT_ALERT_WINDOW_DAYS = 30;
/** Popups per poll. A burst becomes a badge, not a wall. */
export const FRESH_CAP = 5;
export const PREVIEW_CHARS = 90;

/** Which conversation a text belongs to, keyed the way the inbox keys them. */
export function conversationKey(m: Pick<TextAlertRow, "lead_id" | "direction" | "from_number" | "to_number">): string {
  if (m.lead_id) return m.lead_id;
  const counterparty = m.direction === "inbound" ? m.from_number : m.to_number;
  return `phone:${normalizePhone(counterparty)}`;
}

/** Newest first; ties broken by id so the answer is stable. */
function newestFirst(a: TextAlertRow, b: TextAlertRow): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * The fallback's reduction, over the window's rows in any order. Names
 * are not resolved here -- the fallback looks them up for the few fresh
 * rows afterwards, the SQL joins them -- so `name` comes back as the
 * bare number.
 */
export function rollupTextAlerts(
  rows: TextAlertRow[],
  sinceIso: string | null
): { awaitingCount: number; latestIso: string | null; fresh: (FreshText & { leadId: string | null })[] } {
  const sorted = [...rows].sort(newestFirst);

  // The first row seen for a key IS the newest -- a conversation is
  // "awaiting" when that row is inbound.
  const newestByKey = new Map<string, TextAlertRow>();
  for (const m of sorted) {
    const key = conversationKey(m);
    if (!newestByKey.has(key)) newestByKey.set(key, m);
  }
  const awaitingCount = [...newestByKey.values()].filter((m) => m.direction === "inbound").length;

  const latestIso = sorted[0]?.created_at ?? sinceIso;

  // A browser with no watermark seeds itself at "now": the count, no
  // replay of last month's texts.
  const fresh = sinceIso
    ? sorted
        .filter((m) => m.direction === "inbound" && m.created_at > sinceIso)
        .slice(0, FRESH_CAP)
        .map((m) => ({
          id: m.id,
          leadId: m.lead_id,
          fromNumber: m.from_number,
          name: m.from_number,
          preview: (m.body ?? "").slice(0, PREVIEW_CHARS),
          at: m.created_at,
        }))
    : [];

  return { awaitingCount, latestIso, fresh };
}

/**
 * The RPC's jsonb, checked field by field before anything trusts it. A
 * shape this doesn't recognise returns null and the caller falls back,
 * rather than shipping a badge of "undefined".
 */
export function coerceTextAlertRollup(raw: unknown): TextAlertRollup | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.awaitingCount !== "number") return null;
  if (o.latestIso !== null && typeof o.latestIso !== "string") return null;
  if (!Array.isArray(o.fresh)) return null;
  const fresh: FreshText[] = [];
  for (const item of o.fresh) {
    if (!item || typeof item !== "object") continue;
    const f = item as Record<string, unknown>;
    if (typeof f.id !== "string" || typeof f.at !== "string") continue;
    fresh.push({
      id: f.id,
      leadId: typeof f.leadId === "string" ? f.leadId : null,
      fromNumber: typeof f.fromNumber === "string" ? f.fromNumber : "",
      name: typeof f.name === "string" ? f.name : "",
      preview: typeof f.preview === "string" ? f.preview : "",
      at: f.at,
    });
  }
  return { awaitingCount: o.awaitingCount, latestIso: o.latestIso as string | null, fresh };
}

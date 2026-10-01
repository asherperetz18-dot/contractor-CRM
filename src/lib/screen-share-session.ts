/**
 * The pure rules behind the screen-share invite: which session a person
 * is offered, how their "Not now" outlives a page reload, and what the
 * sharer's goodbye beacon may carry. The engine
 * (src/app/(app)/screen-share.tsx) and the end route
 * (src/app/api/screen-shares/end) both lean on these.
 */

type ShareCandidate = { id: string; sharerId: string; invitedTo: string | null };

/** localStorage key holding the session ids this browser turned down. */
export const DISMISSED_SHARES_KEY = "crm.screen-share.dismissed";

/** Plenty for a day's sessions; ids are never reused, so old ones only
 * take up room. */
const KEEP = 20;

/**
 * The session to offer: one aimed at me outranks an open one, and a
 * session I already turned down -- or my own -- is never offered.
 */
export function offerFor<T extends ShareCandidate>(
  shares: readonly T[],
  selfId: string,
  dismissed: readonly string[]
): T | null {
  const live = shares.filter((s) => s.sharerId !== selfId && !dismissed.includes(s.id));
  return live.find((s) => s.invitedTo === selfId) ?? live.find((s) => !s.invitedTo) ?? null;
}

/** The remembered list as stored; anything that isn't a list of ids reads as none. */
export function parseDismissedShares(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** The list with `id` added as the newest, keeping only the last few. */
export function addDismissedShare(list: readonly string[], id: string): string[] {
  return [...list.filter((v) => v !== id), id].slice(-KEEP);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The session id a goodbye beacon names, or null for anything else. */
export function shareIdFromEndRequest(body: unknown): string | null {
  const id = (body as { id?: unknown } | null)?.id;
  return typeof id === "string" && UUID.test(id) ? id : null;
}

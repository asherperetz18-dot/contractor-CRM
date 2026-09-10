/**
 * The pure part of the update popup: given what the browser loaded, what
 * the server says is deployed, and when "Later" was last pressed, should
 * the popup be on screen right now? No React, no timers -- so it runs
 * under node --test.
 */

/** How long "Later" buys before the popup comes back on its own. */
export const SNOOZE_MS = 5 * 60 * 1000;

/** One press of "Later": which version it hid, and when. */
export type UpdateSnooze = { version: string; at: number };

/**
 * True when a newer deploy is live and the person hasn't just asked for a
 * breather. A snooze only ever postpones -- it expires after SNOOZE_MS,
 * and it is pinned to the version it hid, so the next release prompts
 * immediately even mid-snooze. Nothing here can silence updates for good.
 */
export function shouldPromptUpdate(
  current: string,
  latest: string | null,
  snooze: UpdateSnooze | null,
  now: number
): boolean {
  if (!latest || latest === current) return false;
  if (!snooze || snooze.version !== latest) return true;
  return now - snooze.at >= SNOOZE_MS;
}

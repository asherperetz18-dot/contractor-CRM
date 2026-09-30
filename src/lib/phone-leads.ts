// The Leads page on a phone (DECISIONS #091): the board's columns become
// stage chips over a list of cards. Pure, so it is tested without a
// browser; src/app/(app)/pipeline/phone-lead-list.tsx draws it.

import { isSettledStage, money } from "./data/types.ts";

/** Which stage's cards the phone list shows: the one picked, while it is
 *  still a column, else the first stage with leads in it. */
export function pickPhoneStage(
  groups: { stage: string; count: number }[],
  current: string | null
): string | null {
  if (current && groups.some((g) => g.stage === current)) return current;
  return (groups.find((g) => g.count > 0) ?? groups[0])?.stage ?? null;
}

/** The line under a card's name. Stale matches the board's "stale" tag:
 *  an open lead received more than 14 days ago. */
export function leadCardMeta(
  card: { project_type: string | null; value: number; source: string | null; stage: string },
  days: number
): { text: string; stale: boolean } {
  const age = days <= 0 ? "Came in today" : days === 1 ? "Came in yesterday" : `${days} days old`;
  const parts = [card.project_type, card.value > 0 ? money(card.value) : null, age, card.source];
  return {
    text: parts.filter(Boolean).join(" · "),
    stale: days > 14 && !isSettledStage(card.stage),
  };
}

/**
 * Every funnel card, in default display order. The one list the cards,
 * the saved-order store and the Bucket type all hang off, so a card
 * added in one place cannot go missing in another.
 */
export const FUNNEL_CARD_KEYS = [
  "drafts",
  "sent",
  "signed",
  "declined",
  "void",
  "changes",
  "co_pending",
] as const;
export type FunnelCardKey = (typeof FUNNEL_CARD_KEYS)[number];

/**
 * The dragged order of the estimate funnel cards, reconciled with the
 * cards that actually exist in this build.
 *
 * The saved list is a browser preference that outlives releases, so it
 * can name cards that are gone and miss cards that are new. Gone ones
 * are dropped; new ones are slotted in at their default position, so a
 * fresh card shows up without undoing what the person arranged.
 */
export function mergeSavedOrder(defaults: readonly string[], saved: readonly string[]): string[] {
  const order = saved.filter((k) => defaults.includes(k));
  defaults.forEach((k, i) => {
    if (!order.includes(k)) order.splice(Math.min(i, order.length), 0, k);
  });
  return order;
}

/**
 * Where a dragged card lands: in the place of the card it was dropped
 * on. A drop on itself, or with a key the order doesn't hold (stale
 * drag state), changes nothing.
 */
export function moveBefore(order: readonly string[], from: string, to: string): string[] {
  const fromAt = order.indexOf(from);
  const toAt = order.indexOf(to);
  if (fromAt < 0 || toAt < 0 || fromAt === toAt) return [...order];
  const next = order.filter((k) => k !== from);
  next.splice(next.indexOf(to) + (fromAt < toAt ? 1 : 0), 0, from);
  return next;
}

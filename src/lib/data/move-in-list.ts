/**
 * One step of a reorder: the item at `index` swaps with its neighbour.
 * Null when there is no neighbour that way, so a ▲ on the first row and
 * a ▼ on the last are no-ops the caller can skip rather than save.
 * Returns a new array; the one given is untouched.
 */
export function moveInList<T>(items: readonly T[], index: number, delta: -1 | 1): T[] | null {
  const target = index + delta;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return null;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

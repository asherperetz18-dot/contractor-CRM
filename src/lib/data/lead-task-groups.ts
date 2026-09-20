/**
 * The Tasks page's grouping: open lead tasks split against today.
 *
 * Overdue matches the dashboard card's own predicate (due before
 * today), so the card's number and this page's first section can never
 * disagree. Overdue reads oldest first -- the longest-waiting customer
 * tops the list; upcoming reads nearest first. Dates are plain
 * YYYY-MM-DD, so string comparison is date comparison.
 */

export type DueGroups<T> = { overdue: T[]; dueToday: T[]; upcoming: T[] };

export function groupTasksByDue<T extends { due_date: string }>(
  tasks: T[],
  today: string
): DueGroups<T> {
  const byDue = [...tasks].sort((a, b) => a.due_date.localeCompare(b.due_date));
  return {
    overdue: byDue.filter((t) => t.due_date < today),
    dueToday: byDue.filter((t) => t.due_date === today),
    upcoming: byDue.filter((t) => t.due_date > today),
  };
}

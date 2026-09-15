/**
 * The Payments page's client/rep scoping, as a pure function — the same
 * filters Money to Collect has, applied to all three tables at once.
 *
 * A row that has no lead or no rep (an old import, a contract whose lead
 * was deleted) never matches an active filter: under "this client" or
 * "this rep" an unattributed payment is not theirs.
 */

export type ClientRepFilter = {
  /** Selected lead id, or "" for all clients. */
  clientId: string;
  /** Selected rep display name, or "" for all reps. */
  rep: string;
};

export type ClientRepRow = {
  leadId: string | null;
  rep: string | null;
};

export function matchesClientRep(filter: ClientRepFilter, row: ClientRepRow): boolean {
  return (
    (!filter.clientId || row.leadId === filter.clientId) &&
    (!filter.rep || row.rep === filter.rep)
  );
}

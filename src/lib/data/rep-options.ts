import type { AppRole, UserStatus } from "./types";

/** The least a roster row needs to be offered by a people dropdown.
 *  `roles`/`status` optional because some server actions return slim
 *  rows -- a row without roles is never treated as a rep. */
export type RepPickable = {
  id: string;
  name?: string | null;
  email?: string | null;
  roles?: AppRole[] | null;
  status?: UserStatus | null;
};

/**
 * The one rule every people dropdown narrows with.
 *
 * Offered: active members holding the Sales role, alphabetically by the
 * name the option will actually show. Plus whoever is in `keep` --
 * the current holder of an assignment field, or the ids present in the
 * rows a filter covers -- whatever their role or status, because a
 * stored id the list refuses to show reads as data lost: the select
 * goes blank, and a tick that no longer renders cannot be undone.
 *
 * Assignment fields pass their current value as `keep`; filters pass
 * the ids in their data plus the current selection (the estimates
 * funnel's `repOptionIds` is the same idea for id-only lists).
 */
/**
 * A stored person id, named for a read-only line -- the appointment
 * panel's "Customer's Rep". Reads the whole roster it is given, whatever
 * the person's role or status, because the id is already on the record:
 * name, then email, then "Unnamed" (the board's own fallbacks), and
 * "Unassigned" when the record points at nobody.
 */
export function repDisplayName(
  id: string | null | undefined,
  members: readonly RepPickable[]
): string {
  if (!id) return "Unassigned";
  const m = members.find((x) => x.id === id);
  return m?.name || m?.email || "Unnamed";
}

export function repDropdownOptions<T extends RepPickable>(
  members: readonly T[],
  keep?: Iterable<string | null | undefined>
): T[] {
  const kept = new Set<string>();
  for (const id of keep ?? []) if (id) kept.add(id);
  return members
    .filter(
      (m) =>
        kept.has(m.id) ||
        ((m.status ?? "Active") === "Active" && (m.roles ?? []).includes("Sales"))
    )
    .sort((a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || ""));
}

/**
 * The staff a customer's portal page names, and nothing more.
 *
 * The portal reads with the service role and passes what it reads to a
 * client component, so everything it loads ends up in the customer's
 * browser. It once loaded every profile on the platform -- every
 * company's staff, with emails and phone numbers -- to look up the one
 * or two names the page shows. Now it fetches only the ids this lead's
 * own rows reference, and passes on only the name.
 */

export type PortalStaff = { id: string; name: string | null };

export function portalStaffIds(
  events: { assigned_to: string | null; second_assigned_to: string | null }[],
  notes: { author_id: string | null; answered_by: string | null }[] | null
): string[] {
  const ids = new Set<string>();
  for (const e of events) {
    if (e.assigned_to) ids.add(e.assigned_to);
    if (e.second_assigned_to) ids.add(e.second_assigned_to);
  }
  for (const n of notes ?? []) {
    if (n.author_id) ids.add(n.author_id);
    if (n.answered_by) ids.add(n.answered_by);
  }
  return [...ids];
}

/** Strips a profile row down to what the page may show. */
export function toPortalStaff<T extends { id: string; name: string | null }>(rows: T[]): PortalStaff[] {
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

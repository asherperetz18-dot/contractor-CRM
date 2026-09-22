import { repDisplayName, type RepPickable } from "./data/rep-options.ts";

/** The four seats that live on the contact and decide who gets paid. */
export type CustomerTeamSeats = {
  assigned_to?: string | null;
  partner_rep_id?: string | null;
  closer_id?: string | null;
  dispatcher_id?: string | null;
};

export type CustomerTeamSegment = { label: string; name: string };

/**
 * What the appointment window's read-only "Customer's team" line says.
 *
 * The Rep seat always renders -- it is the visibility grant that
 * explains whose calendar this appointment appears on, and "Unassigned"
 * there is an answer, not noise. The other three only render when held:
 * most jobs have no partner or closer, and three "Unassigned" entries
 * would bury the one name that matters.
 *
 * Names resolve against the whole roster (repDisplayName), so a seat
 * held by someone since deactivated still shows rather than vanishing
 * from its own appointment.
 */
export function customerTeamSegments(
  seats: CustomerTeamSeats,
  roster: readonly RepPickable[]
): CustomerTeamSegment[] {
  const segments: CustomerTeamSegment[] = [
    { label: "Rep", name: repDisplayName(seats.assigned_to, roster) },
  ];
  const optional: [string, string | null | undefined][] = [
    ["Partner", seats.partner_rep_id],
    ["Closer", seats.closer_id],
    ["Dispatcher", seats.dispatcher_id],
  ];
  for (const [label, id] of optional) {
    if (id) segments.push({ label, name: repDisplayName(id, roster) });
  }
  return segments;
}

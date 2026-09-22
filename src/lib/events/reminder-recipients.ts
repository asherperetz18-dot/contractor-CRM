/**
 * Who an appointment's automatic reminder texts go to.
 *
 * Both visit seats -- Assigned To and Second Assigned To -- and nobody
 * else. The customer's team (rep, partner, closer, dispatcher) lives on
 * the contact and is paid on the sale, but the people who need "you're
 * due at Margo's in an hour" on their phone are exactly the ones
 * driving out. A closer is only ever texted when they are themselves
 * booked into a visit seat.
 *
 * The reminder cron used to text the first chair only; the second rep
 * found out they were on a visit by being asked why they missed it.
 */
export function reminderRecipientIds(event: {
  assigned_to: string | null;
  second_assigned_to?: string | null;
}): string[] {
  const ids: string[] = [];
  for (const id of [event.assigned_to, event.second_assigned_to]) {
    // De-duplicated: one person in both chairs gets one text, not two.
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

// The lead window's phone header (DECISIONS #092): the facts and the next
// visit shown above the tabs. Pure, so it is tested without a browser;
// src/app/(app)/pipeline/lead-phone-hero.tsx draws it.

type Appointment = { id: string; date: string; time: string | null; status: string };

/** The soonest visit from today on, cancelled ones aside. A visit with
 *  no time sorts after the timed ones that day. */
export function nextAppointment<T extends Appointment>(rows: T[], todayISO: string): T | null {
  const ahead = rows
    .filter((r) => r.date >= todayISO && r.status !== "Cancelled")
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "99").localeCompare(b.time ?? "99"));
  return ahead[0] ?? null;
}

/** "Source: Google Ads · Rep: Alex Morgan" -- a missing source is left
 *  out; a missing rep says so, because that is a gap to fill. */
export function leadSubline(source: string | null, repName: string | null): string {
  return [source ? `Source: ${source}` : null, repName ? `Rep: ${repName}` : "Unassigned"]
    .filter(Boolean)
    .join(" · ");
}

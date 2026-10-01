// Where-is-someone math for the time clock: distance, which job zone a
// GPS fix is in, and whether that opens or closes a site visit.

export type LatLng = { lat: number; lng: number };

// A place someone can arrive at: an appointment's address, a production
// job they're on, or the office.
export type Zone = LatLng & { key: string; label: string; eventId: string | null; jobId?: string | null };

// A phone's fix comes with an accuracy circle. Some of it is allowed as
// slack so an honest arrival isn't missed, but capped: a fix that could
// be anywhere within 5 km must not claim a job.
const MAX_ACCURACY_SLACK_M = 100;

export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function nearestZone(
  point: LatLng & { accuracy?: number | null },
  zones: Zone[],
  radiusM: number
): { zone: Zone; distance: number } | null {
  const slack = Math.min(Math.max(point.accuracy ?? 0, 0), MAX_ACCURACY_SLACK_M);
  let best: { zone: Zone; distance: number } | null = null;
  for (const zone of zones) {
    const distance = distanceMeters(point, zone);
    if (distance > radiusM + slack) continue;
    if (!best || distance < best.distance) best = { zone, distance };
  }
  return best;
}

// The zone key of a stored visit, to compare with the zone a fix is in.
// job_id arrives with 0185; a visit written before it has none.
export function visitKey(visit: { event_id: string | null; job_id?: string | null }): string {
  if (visit.event_id) return `event:${visit.event_id}`;
  return visit.job_id ? `job:${visit.job_id}` : "office";
}

// Given the zone of the visit that's open now (if any) and the zone the
// latest fix is in (if any): close the open visit? open a new one?
export function nextVisitStep(
  openKey: string | null,
  inside: Zone | null
): { close: boolean; open: Zone | null } {
  if (openKey && inside && inside.key === openKey) return { close: false, open: null };
  return { close: openKey !== null, open: inside };
}

// The verdict stamped on a punch (0185). "away" names the nearest place
// and how far, which is what the office reads on the timesheet;
// "not_required" is decided by the caller (role or setting), not here.
export type ClockCheck = "at_place" | "away" | "no_location" | "no_places" | "not_required";
export type ClockStamp = { check: ClockCheck; place: string | null; distanceM: number | null };

export function clockStamp(
  fix: (LatLng & { accuracy?: number | null }) | null,
  zones: Zone[],
  radiusM: number
): ClockStamp {
  if (!fix) return { check: "no_location", place: null, distanceM: null };
  if (zones.length === 0) return { check: "no_places", place: null, distanceM: null };
  const hit = nearestZone(fix, zones, radiusM);
  if (hit) return { check: "at_place", place: hit.zone.label, distanceM: Math.round(hit.distance) };
  let nearest = { zone: zones[0], distance: distanceMeters(fix, zones[0]) };
  for (const zone of zones.slice(1)) {
    const distance = distanceMeters(fix, zone);
    if (distance < nearest.distance) nearest = { zone, distance };
  }
  return { check: "away", place: nearest.zone.label, distanceM: Math.round(nearest.distance) };
}

// Is a production job somewhere its crew works today? In progress means
// yes even past its end date (they're still on the roof); not started
// counts once its dates cover today, since the office often flips the
// status late. On hold and complete never do.
export function jobIsLiveToday(
  job: { status: string; start_date: string | null; end_date: string | null },
  today: string
): boolean {
  if (job.status === "In Progress") return true;
  if (job.status !== "Not Started" || !job.start_date) return false;
  return job.start_date <= today && (!job.end_date || job.end_date >= today);
}

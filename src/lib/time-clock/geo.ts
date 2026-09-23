// Where-is-someone math for the time clock: distance, which job zone a
// GPS fix is in, and whether that opens or closes a site visit.

export type LatLng = { lat: number; lng: number };

// A place someone can arrive at: an appointment's address, or the office.
export type Zone = LatLng & { key: string; label: string; eventId: string | null };

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

// Given the zone of the visit that's open now (if any) and the zone the
// latest fix is in (if any): close the open visit? open a new one?
export function nextVisitStep(
  openKey: string | null,
  inside: Zone | null
): { close: boolean; open: Zone | null } {
  if (openKey && inside && inside.key === openKey) return { close: false, open: null };
  return { close: openKey !== null, open: inside };
}

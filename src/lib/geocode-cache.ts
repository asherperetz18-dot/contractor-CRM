// What the free Census geocoder said about an address, and what the
// shared address_geocode cache (0135) should keep of it. Only an answer
// is ever stored: an outage or a timeout is not "address not found".

export type GeocodeAnswer =
  | { status: "found"; lat: number; lng: number }
  | { status: "not_found" }
  | { status: "error" };

// A stored "not found" is trusted this long, so a bad address costs one
// lookup a day rather than one per location update -- and a row stored
// by mistake (before misses and outages were told apart) heals itself.
export const MISS_RECHECK_MS = 24 * 60 * 60 * 1000;

// ok: the HTTP response was 2xx. json: its parsed body, or null.
export function readCensusAnswer(ok: boolean, json: unknown): GeocodeAnswer {
  if (!ok) return { status: "error" };
  const matches = (json as { result?: { addressMatches?: unknown } } | null)?.result?.addressMatches;
  if (!Array.isArray(matches)) return { status: "error" };
  if (matches.length === 0) return { status: "not_found" };
  const coords = (matches[0] as { coordinates?: { x?: unknown; y?: unknown } } | null)?.coordinates;
  if (typeof coords?.x !== "number" || typeof coords?.y !== "number") return { status: "error" };
  return { status: "found", lat: coords.y, lng: coords.x };
}

export type CachedGeocode = {
  lat: number | string | null;
  lng: number | string | null;
  resolved_at: string | null;
};

// A cache row's answer: coordinates, a trusted "not found" (null), or
// "ask" when the geocoder has to be asked.
export function fromCache(row: CachedGeocode | null, now: Date): { lat: number; lng: number } | null | "ask" {
  if (!row) return "ask";
  if (row.lat !== null && row.lng !== null) return { lat: Number(row.lat), lng: Number(row.lng) };
  const checked = row.resolved_at ? new Date(row.resolved_at).getTime() : NaN;
  return now.getTime() - checked < MISS_RECHECK_MS ? null : "ask";
}

// The columns to store for an answer, or null to store nothing.
export function cacheRowFor(
  answer: GeocodeAnswer,
  now: Date
): { lat: number | null; lng: number | null; resolved_at: string } | null {
  if (answer.status === "error") return null;
  const resolved_at = now.toISOString();
  return answer.status === "found"
    ? { lat: answer.lat, lng: answer.lng, resolved_at }
    : { lat: null, lng: null, resolved_at };
}

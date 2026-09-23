// When a fix is worth sending to /api/location.
import { distanceMeters, type LatLng } from "./geo.ts";

// At most this often while standing still...
const EVERY_MS = 2 * 60 * 1000;
// ...or sooner once someone has moved this far (so arrivals land
// promptly), but never more often than MIN_GAP_MS.
const MOVED_M = 150;
const MIN_GAP_MS = 20 * 1000;

export function fixDue(prev: (LatLng & { at: number }) | null, fix: LatLng, nowMs: number): boolean {
  if (!prev) return true;
  const gap = nowMs - prev.at;
  return gap >= EVERY_MS || (gap >= MIN_GAP_MS && distanceMeters(prev, fix) >= MOVED_M);
}

import "server-only";
import { utcClockIn } from "@/lib/company-clock";

// Returns the company's current wall-clock time expressed as a Date whose
// UTC getters give the local Y/M/D/H/M/S in that zone -- lets grace-period
// and window arithmetic stay simple (compare directly against event.date +
// event.time, which are stored as naive local wall-clock values).
// event.time comes back from Postgres as "HH:MM:SS"; normalize to "HH:MM"
// before building the ISO string so a stray extra ":00" never sneaks in.
export function parseNaiveDateTime(date: string, time: string | null): Date {
  const hhmm = time ? time.slice(0, 5) : "00:00";
  return new Date(`${date}T${hhmm}:00Z`);
}

export function nowInZone(ianaZone: string): Date {
  return utcClockIn(new Date(), ianaZone);
}

// The real UTC instant at which `ianaZone`'s wall clock reads `naive` (a
// naive-as-UTC Date, e.g. from parseNaiveDateTime). Needed whenever a
// stored local time has to be compared against genuinely zoned timestamps
// (like NWS forecast periods) -- naive-vs-real comparisons are silently off
// by the whole UTC offset. Guess-and-correct twice so a naive time sitting
// right on a DST transition still lands on the offset actually in force.
export function naiveZonedToUtc(naive: Date, ianaZone: string): Date {
  let utcMs = naive.getTime();
  for (let i = 0; i < 2; i++) {
    const wall = utcClockIn(new Date(utcMs), ianaZone);
    utcMs += naive.getTime() - wall.getTime();
  }
  return new Date(utcMs);
}

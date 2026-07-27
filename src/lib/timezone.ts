import "server-only";

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
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ianaZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return new Date(
    Date.UTC(
      Number(get("year")),
      Number(get("month")) - 1,
      Number(get("day")),
      Number(get("hour")) % 24,
      Number(get("minute")),
      Number(get("second"))
    )
  );
}

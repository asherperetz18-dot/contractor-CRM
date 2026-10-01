// The location check at clock-in (0185): who is checked, what a worker
// may give as a reason for clocking in away from their places, and how
// the stamp reads on the timesheet. It flags; it never blocks a punch.
import type { AppRole } from "../data/types.ts";
import type { ClockCheck, ClockStamp } from "./geo.ts";
import type { TimeClockSettings } from "./settings.ts";

// The verdict columns on time_punches. Only the server writes them (the
// 0185 trigger clears a worker's insert and keeps a worker's update).
export const CLOCK_STAMP_COLUMNS = [
  "in_check",
  "in_place",
  "in_distance_m",
  "in_reason",
  "out_check",
  "out_place",
  "out_distance_m",
] as const;

export function clockCheckApplies(
  roles: AppRole[],
  settings: Pick<TimeClockSettings, "clock_in_check" | "check_roles">
): boolean {
  return settings.clock_in_check !== "off" && roles.some((r) => settings.check_roles.includes(r));
}

// Quick picks for the "you're away from your jobs" question. The last
// one is free text.
export const CLOCK_IN_REASONS = [
  "Picking up materials",
  "Driving to the job",
  "Office asked me to",
  "Something else",
] as const;

const MAX_REASON = 200;

export function parseClockInReason(pick: string, note: string): { reason: string } | { error: string } {
  if (!(CLOCK_IN_REASONS as readonly string[]).includes(pick)) return { error: "Pick what you're doing." };
  const text = note.trim();
  if (text.length > MAX_REASON) return { error: `Keep it under ${MAX_REASON} characters.` };
  if (pick === "Something else") {
    if (text.length < 3) return { error: "Say in a few words what you're doing." };
    return { reason: text };
  }
  return { reason: text ? `${pick}: ${text}` : pick };
}

// The crews and offices reading this are in the US: feet up close,
// miles beyond a tenth of one.
export function awayDistance(meters: number): string {
  const miles = meters / 1609.344;
  if (miles < 0.1) return `${Math.round((meters * 3.28084) / 10) * 10} ft`;
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
}

// A punch's stamp as the office would say it. Null when there's nothing
// to say: the person's role isn't checked, or the punch predates 0185.
// No verdict at all means the punch didn't go through the check.
export function describeStamp(stamp: { check: ClockCheck | null } & Omit<ClockStamp, "check">): string | null {
  switch (stamp.check) {
    case "at_place":
      return `at ${stamp.place}`;
    case "away":
      return `${awayDistance(stamp.distanceM ?? 0)} from ${stamp.place}`;
    case "no_location":
      return "no location";
    case "no_places":
      return "no job or office on the map to check against";
    case "not_required":
      return null;
    default:
      return "not checked";
  }
}

// The Timesheets chip for a stamp, in Team Map's colors for the same
// ideas. Null where describeStamp has nothing to say.
export function stampChipClass(check: ClockCheck | null): string | null {
  switch (check) {
    case "at_place":
      return "tc-chip-at-job";
    case "away":
      return "tc-chip-stopped";
    case "no_places":
      return "tc-chip-off";
    case "not_required":
      return null;
    default:
      return "tc-chip-no-signal";
  }
}

export function clockFlags(punches: { in_check: ClockCheck | null }[]): {
  offSite: number;
  noLocation: number;
  unchecked: number;
} {
  return {
    offSite: punches.filter((p) => p.in_check === "away").length,
    noLocation: punches.filter((p) => p.in_check === "no_location").length,
    unchecked: punches.filter((p) => p.in_check === null).length,
  };
}

// The check looks up today's addresses, and each uncached one can wait
// on the Census geocoder for up to its own 5-second timeout. A clock-in
// never waits on those past a few seconds in all, and never fails
// because of them.
export async function withDeadline<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([work.catch(() => fallback), late]);
  } finally {
    clearTimeout(timer);
  }
}

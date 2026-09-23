// Attendance and live status, judged from automatic arrivals and pings.
import { distanceMeters } from "./geo.ts";
import type { ShiftState } from "./hours.ts";

export type Attendance = {
  status: "on-time" | "late" | "missed" | "upcoming";
  minutesLate: number;
};

// Did someone reach an appointment, and how late? Only the first arrival
// counts: stepping out to the truck and back doesn't make you late.
export function appointmentAttendance(
  start: Date,
  arrivals: string[],
  lateAfterMin: number,
  now: Date
): Attendance {
  const minsAfterStart = (t: Date) => Math.round((t.getTime() - start.getTime()) / 60000);
  if (arrivals.length === 0) {
    const late = minsAfterStart(now);
    return late > lateAfterMin ? { status: "missed", minutesLate: late } : { status: "upcoming", minutesLate: 0 };
  }
  const first = arrivals.map((a) => new Date(a)).sort((a, b) => a.getTime() - b.getTime())[0];
  const late = Math.max(0, minsAfterStart(first));
  return { status: late > lateAfterMin ? "late" : "on-time", minutesLate: late };
}

export type LiveStatus = "off" | "break" | "no-signal" | "at-job" | "office" | "driving" | "stopped";

export type Ping = { recorded_at: string; lat: number; lng: number };

// No fix for this long while on the clock means location is off, the
// phone is dead, or the app was killed -- the office needs to know.
const STALE_MS = 15 * 60 * 1000;
// Faster than a brisk walk between the last two fixes is driving.
const DRIVING_MPS = 2.5;

// pings: newest first.
export function liveStatus(
  input: { shift: ShiftState; pings: Ping[]; visitLabel: string | null },
  now: Date
): LiveStatus {
  if (input.shift !== "on") return input.shift;
  const [latest, previous] = input.pings;
  if (!latest || now.getTime() - new Date(latest.recorded_at).getTime() > STALE_MS) return "no-signal";
  if (input.visitLabel) return input.visitLabel === "Office" ? "office" : "at-job";
  if (previous) {
    const secs = (new Date(latest.recorded_at).getTime() - new Date(previous.recorded_at).getTime()) / 1000;
    if (secs > 0 && distanceMeters(latest, previous) / secs > DRIVING_MPS) return "driving";
  }
  return "stopped";
}

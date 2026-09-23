// The audit trail of office edits to hours (time_punch_changes, 0174):
// raw before/after snapshots, described in words at read time.

export type PunchSnapshot = {
  clock_in: string;
  clock_out: string | null;
  end_reason: string | null;
};

function sameInstant(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return new Date(a).getTime() === new Date(b).getTime();
}

function when(iso: string | null, ianaZone: string): string {
  if (!iso) return "still open";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: ianaZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function describePunchChange(before: PunchSnapshot, after: PunchSnapshot, ianaZone: string): string[] {
  const lines: string[] = [];
  if (!sameInstant(before.clock_in, after.clock_in)) {
    lines.push(`Clock-in: ${when(before.clock_in, ianaZone)} → ${when(after.clock_in, ianaZone)}`);
  }
  if (!sameInstant(before.clock_out, after.clock_out)) {
    lines.push(`Clock-out: ${when(before.clock_out, ianaZone)} → ${when(after.clock_out, ianaZone)}`);
  }
  return lines;
}

// Same rule decides recording and rendering, so the trail never holds
// an empty entry. The zone doesn't matter for "did anything change".
export function punchChanged(before: PunchSnapshot, after: PunchSnapshot): boolean {
  return describePunchChange(before, after, "UTC").length > 0;
}

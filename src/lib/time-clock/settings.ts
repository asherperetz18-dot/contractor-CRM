// Company time-clock rules (time_clock_settings, 0174), defaults used
// until an office saves the settings page, and parsing its form.
import type { AppRole } from "../data/types.ts";

export type TimeClockSettings = {
  tracked_roles: AppRole[];
  zone_radius_m: number;
  overtime_weekly_hours: number;
  late_after_min: number;
  auto_clock_out_hours: number;
  trail_retention_days: number;
  office_address: string | null;
};

export const DEFAULT_TIME_CLOCK_SETTINGS: TimeClockSettings = {
  tracked_roles: ["Sales", "Field", "Production", "Office"],
  zone_radius_m: 150,
  overtime_weekly_hours: 40,
  late_after_min: 10,
  auto_clock_out_hours: 12,
  trail_retention_days: 90,
  office_address: null,
};

export const CLOCK_ROLES: AppRole[] = [
  "Sales",
  "Field",
  "Production",
  "Office",
  "Dispatch",
  "Call Center",
  "Bookkeeping",
];

export function usesTimeClock(roles: AppRole[], settings: Pick<TimeClockSettings, "tracked_roles">): boolean {
  return roles.some((r) => settings.tracked_roles.includes(r));
}

export type SettingsInput = {
  tracked_roles: string[];
  zone_radius_m: string;
  overtime_weekly_hours: string;
  late_after_min: string;
  auto_clock_out_hours: string;
  trail_retention_days: string;
  office_address: string;
};

const RANGES: [keyof SettingsInput, string, number, number][] = [
  ["zone_radius_m", "Zone radius must be between 30 and 1000 metres.", 30, 1000],
  ["overtime_weekly_hours", "Overtime must start between 1 and 80 hours a week.", 1, 80],
  ["late_after_min", "Late must be between 0 and 240 minutes.", 0, 240],
  ["auto_clock_out_hours", "Auto clock-out must be between 1 and 24 hours.", 1, 24],
  ["trail_retention_days", "Keep location trails between 7 and 730 days.", 7, 730],
];

export function parseSettingsInput(input: SettingsInput): { settings: TimeClockSettings } | { error: string } {
  const nums: Record<string, number> = {};
  for (const [key, message, min, max] of RANGES) {
    const n = Number(input[key]);
    if (!Number.isFinite(n) || n < min || n > max) return { error: message };
    nums[key] = key === "overtime_weekly_hours" ? n : Math.round(n);
  }
  const address = input.office_address.trim();
  return {
    settings: {
      tracked_roles: CLOCK_ROLES.filter((r) => input.tracked_roles.includes(r)),
      zone_radius_m: nums.zone_radius_m,
      overtime_weekly_hours: nums.overtime_weekly_hours,
      late_after_min: nums.late_after_min,
      auto_clock_out_hours: nums.auto_clock_out_hours,
      trail_retention_days: nums.trail_retention_days,
      office_address: address || null,
    },
  };
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TIME_CLOCK_SETTINGS, parseSettingsInput, usesTimeClock } from "./settings.ts";

/**
 * Who clocks in is a role list, and the settings form is the only
 * writer -- so a role outside the list must not see a clock button, and
 * junk from the form must be refused before it reaches the database's
 * check constraints (which would only say "violates check").
 */

test("the defaults cover the roles the owner asked for", () => {
  assert.deepEqual(DEFAULT_TIME_CLOCK_SETTINGS.tracked_roles, ["Sales", "Field", "Production", "Office"]);
});

test("anyone holding a tracked role uses the clock; others don't", () => {
  assert.equal(usesTimeClock(["Dispatch", "Sales"], DEFAULT_TIME_CLOCK_SETTINGS), true);
  assert.equal(usesTimeClock(["Dispatch"], DEFAULT_TIME_CLOCK_SETTINGS), false);
  assert.equal(usesTimeClock([], DEFAULT_TIME_CLOCK_SETTINGS), false);
});

test("a valid form parses to numbers and a trimmed address", () => {
  const r = parseSettingsInput({
    tracked_roles: ["Field", "Office"],
    zone_radius_m: "200",
    overtime_weekly_hours: "40",
    late_after_min: "15",
    auto_clock_out_hours: "12",
    trail_retention_days: "90",
    office_address: "  1 Main St, Town CA  ",
  });
  assert.ok("settings" in r);
  assert.equal(r.settings.zone_radius_m, 200);
  assert.equal(r.settings.office_address, "1 Main St, Town CA");
});

test("out-of-range or non-numeric values are refused in words", () => {
  const r = parseSettingsInput({
    tracked_roles: ["Field"],
    zone_radius_m: "5",
    overtime_weekly_hours: "40",
    late_after_min: "10",
    auto_clock_out_hours: "12",
    trail_retention_days: "90",
    office_address: "",
  });
  assert.deepEqual(r, { error: "Zone radius must be between 30 and 1000 metres." });
});

test("an empty address is stored as none; an unknown role is dropped", () => {
  const r = parseSettingsInput({
    tracked_roles: ["Field", "Wizard"],
    zone_radius_m: "150",
    overtime_weekly_hours: "40",
    late_after_min: "10",
    auto_clock_out_hours: "12",
    trail_retention_days: "90",
    office_address: "   ",
  });
  assert.ok("settings" in r);
  assert.equal(r.settings.office_address, null);
  assert.deepEqual(r.settings.tracked_roles, ["Field"]);
});

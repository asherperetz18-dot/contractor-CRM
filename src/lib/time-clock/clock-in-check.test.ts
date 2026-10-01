import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CLOCK_IN_REASONS,
  CLOCK_STAMP_COLUMNS,
  awayDistance,
  clockCheckApplies,
  clockFlags,
  describeStamp,
  parseClockInReason,
  stampChipClass,
  withDeadline,
} from "./clock-in-check.ts";
import { DEFAULT_TIME_CLOCK_SETTINGS } from "./settings.ts";

/**
 * The location check at clock-in. It flags, it never blocks, and what it
 * stamps lands on a payroll record -- so the edges are who gets asked,
 * what a reason may be, how the office reads the stamp, and that a
 * worker can't write their own verdict.
 */

const ASK = { ...DEFAULT_TIME_CLOCK_SETTINGS, clock_in_check: "ask" as const, check_roles: ["Field" as const, "Production" as const] };

test("checked roles are checked; others, and every role when the check is off, are not", () => {
  assert.equal(clockCheckApplies(["Field"], ASK), true);
  assert.equal(clockCheckApplies(["Sales", "Production"], ASK), true);
  assert.equal(clockCheckApplies(["Sales"], ASK), false);
  assert.equal(clockCheckApplies(["Office"], ASK), false);
  assert.equal(clockCheckApplies(["Field"], { ...ASK, clock_in_check: "off" }), false);
  assert.equal(clockCheckApplies(["Field"], { ...ASK, clock_in_check: "record" }), true);
});

test("a quick pick alone is a reason", () => {
  assert.deepEqual(parseClockInReason("Picking up materials", ""), { reason: "Picking up materials" });
});

test("a pick with a note keeps both, trimmed", () => {
  assert.deepEqual(parseClockInReason("Picking up materials", "  ABC Supply, shingles for Smith "), {
    reason: "Picking up materials: ABC Supply, shingles for Smith",
  });
});

test("'Something else' needs a few words, and then the words are the reason", () => {
  assert.ok("error" in parseClockInReason("Something else", ""));
  assert.ok("error" in parseClockInReason("Something else", " ok "));
  assert.deepEqual(parseClockInReason("Something else", "Dropping the trailer at the yard"), {
    reason: "Dropping the trailer at the yard",
  });
});

test("an unknown pick or an essay is refused in words", () => {
  assert.deepEqual(parseClockInReason("Because", ""), { error: "Pick what you're doing." });
  assert.deepEqual(parseClockInReason("Driving to the job", "x".repeat(201)), {
    error: "Keep it under 200 characters.",
  });
});

test("the quick picks end with the free-text option", () => {
  assert.equal(CLOCK_IN_REASONS[CLOCK_IN_REASONS.length - 1], "Something else");
});

test("distances read in feet up close and miles beyond", () => {
  assert.equal(awayDistance(50), "160 ft");
  assert.equal(awayDistance(160), "520 ft");
  assert.equal(awayDistance(170), "0.1 mi");
  assert.equal(awayDistance(3700), "2.3 mi");
  assert.equal(awayDistance(25_000), "16 mi");
});

test("a stamp reads as the office would say it", () => {
  assert.equal(describeStamp({ check: "at_place", place: "Smith", distanceM: 40 }), "at Smith");
  assert.equal(describeStamp({ check: "away", place: "Smith", distanceM: 3700 }), "2.3 mi from Smith");
  assert.equal(describeStamp({ check: "no_location", place: null, distanceM: null }), "no location");
  assert.equal(
    describeStamp({ check: "no_places", place: null, distanceM: null }),
    "no job or office on the map to check against"
  );
  // Not this person's role, or made before the check existed: say nothing.
  assert.equal(describeStamp({ check: "not_required", place: null, distanceM: null }), null);
  // No verdict at all: the punch didn't go through the check.
  assert.equal(describeStamp({ check: null, place: null, distanceM: null }), "not checked");
});

test("the week's flags count off-site, no-location and unchecked clock-ins", () => {
  assert.deepEqual(
    clockFlags([
      { in_check: "away" },
      { in_check: "away" },
      { in_check: "at_place" },
      { in_check: "no_location" },
      { in_check: "no_places" },
      { in_check: "not_required" },
      { in_check: null },
    ]),
    { offSite: 2, noLocation: 1, unchecked: 1 }
  );
});

test("migration 0185's guard covers every stamp column, so a worker can't write their own verdict", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/0185_clock_in_check.sql", import.meta.url), "utf8");
  const guard = sql.slice(sql.indexOf("function time_punches_stamp_guard"), sql.indexOf("$$ language plpgsql"));
  assert.ok(guard.length > 0, "guard function not found");
  for (const col of CLOCK_STAMP_COLUMNS) {
    assert.match(guard, new RegExp(`new\\.${col} := null`), `insert doesn't clear ${col}`);
    assert.match(guard, new RegExp(`new\\.${col} := old\\.${col}`), `update doesn't keep ${col}`);
    assert.match(sql, new RegExp(`add column if not exists ${col}\\b`), `${col} isn't added`);
  }
});

test("a slow map lookup can't hold up a clock-in: past the budget, the fallback answers", async () => {
  const never = new Promise<string>(() => {});
  assert.equal(await withDeadline(never, 20, "fallback"), "fallback");
  assert.equal(await withDeadline(Promise.resolve("checked"), 1000, "fallback"), "checked");
  // A lookup that fails outright gets the fallback too, never an error.
  assert.equal(await withDeadline(Promise.reject(new Error("census down")), 1000, "fallback"), "fallback");
});

test("a stamp's chip color says the same thing it says on Team Map", () => {
  assert.equal(stampChipClass("at_place"), "tc-chip-at-job");
  // Away from every job: amber, as "stopped away from a job".
  assert.equal(stampChipClass("away"), "tc-chip-stopped");
  // Where they were is unknown: the "location off" alarm.
  assert.equal(stampChipClass("no_location"), "tc-chip-no-signal");
  assert.equal(stampChipClass(null), "tc-chip-no-signal");
  assert.equal(stampChipClass("no_places"), "tc-chip-off");
  assert.equal(stampChipClass("not_required"), null);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLOSED_STAGE_KEYS,
  OPEN_LEADS_FILTER,
  PRE_APPOINTMENT_STAGE_KEYS,
  REQUIRED_STAGE_KEYS,
  STAGE_KEYS,
  STANDARD_STAGE_NAMES,
  closedStageNames,
  isClosedStageKey,
  isPreAppointmentStage,
  preAppointmentStageNames,
  stageKeyOf,
  stageLabel,
  stageNameFor,
} from "./stage-keys.ts";

/**
 * Stage tags (DECISIONS #120): the app moves and counts leads by each
 * stage's tag, so a company can rename any stage. These tests keep the
 * app's rules and the database's (migration 0195) the same, and stop a
 * stage name creeping back into code that should go by the tag.
 */

const SRC = fileURLToPath(new URL("../../", import.meta.url));
const ROOT = join(SRC, "..");
const MIGRATION = readFileSync(join(ROOT, "supabase/migrations/0195_stage_tags.sql"), "utf8");

const PIPELINE = [
  { name: "Unsorted", key: "unsorted", sort_order: 1 },
  { name: "Facebook Leads", key: null, sort_order: 2 },
  { name: "New Lead", key: "new_lead", sort_order: 3 },
  { name: "Contacted", key: "contacted", sort_order: 4 },
  { name: "Inspection Booked", key: "appointment_scheduled", sort_order: 5 },
  { name: "Financing Review", key: null, sort_order: 6 },
  { name: "Proposal Sent", key: "proposal_sent", sort_order: 7 },
  { name: "Sold", key: "won", sort_order: 8 },
  { name: "Lost", key: "lost", sort_order: 9 },
  { name: "Do Not Call", key: "dnc", sort_order: 10 },
];

test("a renamed stage keeps its tag, and the tag finds it by its new name", () => {
  assert.equal(stageKeyOf(PIPELINE, "Sold"), "won");
  assert.equal(stageNameFor(PIPELINE, "won"), "Sold");
  assert.equal(stageNameFor(PIPELINE, "appointment_scheduled"), "Inspection Booked");
  // A company's own stage has no tag.
  assert.equal(stageKeyOf(PIPELINE, "Financing Review"), null);
  // A tag the company has no stage for: nowhere, and the standard name as a label.
  assert.equal(stageNameFor(PIPELINE, "not_interested"), null);
  assert.equal(stageLabel(PIPELINE, "not_interested"), "Not Interested");
  assert.equal(stageLabel(PIPELINE, "won"), "Sold");
});

test("closed is won, lost, not interested and do-not-contact", () => {
  assert.deepEqual([...CLOSED_STAGE_KEYS].sort(), ["dnc", "lost", "not_interested", "won"]);
  assert.equal(isClosedStageKey("not_interested"), true);
  assert.equal(isClosedStageKey(null), false); // a company's own stage is open
  assert.deepEqual(closedStageNames(PIPELINE), ["Sold", "Lost", "Do Not Call"]);
  assert.equal(OPEN_LEADS_FILTER, "stage_key.is.null,stage_key.not.in.(won,lost,not_interested,dnc)");
});

test("waiting for a first appointment: the intake tags, plus own stages left of Appointment Scheduled", () => {
  assert.deepEqual(preAppointmentStageNames(PIPELINE), ["Unsorted", "Facebook Leads", "New Lead", "Contacted"]);
  assert.equal(isPreAppointmentStage(PIPELINE, "Financing Review"), false);
  assert.equal(isPreAppointmentStage(PIPELINE, "Inspection Booked"), false);
  assert.equal(isPreAppointmentStage(PIPELINE, "No such stage"), false);
  // No Appointment Scheduled stage at all: only the tagged intake stages.
  const noBooking = PIPELINE.filter((s) => s.key !== "appointment_scheduled");
  assert.deepEqual(preAppointmentStageNames(noBooking), ["Unsorted", "New Lead", "Contacted"]);
});

// ── The database's copy of the same rules (0195) ─────────────────────

test("the database's tag list and starting names match the app's", () => {
  const check = MIGRATION.match(/pipeline_stages_key_check check \(key in \(([\s\S]*?)\)\)/);
  assert.ok(check, "0195 constrains the tags");
  assert.deepEqual([...check[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]), [...STAGE_KEYS]);

  const values = MIGRATION.match(/with standard\(name, key\) as \(\s*values([\s\S]*?)\n\),/);
  assert.ok(values, "0195 tags the standard stages by name");
  const pairs = Object.fromEntries([...values[1].matchAll(/\('([^']+)', '([a-z_]+)'\)/g)].map((m) => [m[2], m[1]]));
  assert.deepEqual(pairs, STANDARD_STAGE_NAMES);
});

test("the database's closed and intake tags match the app's", () => {
  const closed = MIGRATION.match(/function public\.is_closed_stage[\s\S]*?p_key in \(([^)]*)\)/);
  assert.ok(closed);
  assert.deepEqual([...closed[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]), [...CLOSED_STAGE_KEYS]);

  const intake = MIGRATION.match(/function public\.pre_appointment_stage_names[\s\S]*?s\.key in \(([^)]*)\)/);
  assert.ok(intake);
  assert.deepEqual([...intake[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]), [...PRE_APPOINTMENT_STAGE_KEYS]);
});

test("the reports 0195 rewrites no longer test a stage by name", () => {
  const bodies = MIGRATION.slice(MIGRATION.indexOf("── 5. Reports go by the tag"));
  for (const named of [/stage(::text)? (not )?in \('/, /stage = '/, /stage::text not in/]) {
    assert.doesNotMatch(bodies, named);
  }
});

test("a new company starts with every standard stage, tagged, in order", () => {
  const defaults = readFileSync(join(SRC, "lib/data/company-defaults.ts"), "utf8");
  const list = defaults.slice(defaults.indexOf("const STAGES:"), defaults.indexOf("export const DEFAULT_PIPELINE_STAGES"));
  assert.deepEqual([...list.matchAll(/key: "([a-z_]+)"/g)].map((m) => m[1]), [...STAGE_KEYS]);
  assert.deepEqual([...REQUIRED_STAGE_KEYS].sort(), ["appointment_scheduled", "lost", "unsorted", "won"]);
});

// ── No stage names in the app's logic ────────────────────────────────

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

test("no code compares or filters a lead's stage by a standard stage's name", () => {
  const names = Object.values(STANDARD_STAGE_NAMES)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const byName = [
    new RegExp(`stage\\s*[!=]==?\\s*"(${names})"`),
    new RegExp(`"(${names})"\\s*[!=]==?\\s*[\\w.]*stage\\b`),
    new RegExp(`\\.(eq|neq)\\(\\s*"stage"\\s*,\\s*"(${names})"`),
    /\.(not|in)\(\s*"stage"\s*,\s*"in"\s*,\s*"\(/,
    // a write such as { stage: "Won" } -- not a disposition's own move_to_stage setting
    new RegExp(`(?<![\\w])stage:\\s*"(${names})"`),
  ];
  const hits: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (!byName.some((re) => re.test(line))) return;
      // New leads may name the intake stage: the database maps an unknown
      // name on a new lead to the company's own intake stage (0195).
      if (/stage:\s*"Unsorted"/.test(line) && /intake stage/.test(lines.slice(Math.max(0, i - 3), i).join(" "))) return;
      hits.push(`${relative(SRC, file)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, []);
});

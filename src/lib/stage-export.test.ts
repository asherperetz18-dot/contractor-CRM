import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STAGE_EXPORT_COLUMNS,
  leadsToCsv,
  stageExportFilename,
  type StageExportLead,
} from "./stage-export.ts";

/**
 * The CSV is the only backup a bulk stage delete leaves behind, so the
 * edges tested here are the ones that would silently corrupt it: field
 * escaping (a note with commas/quotes/newlines must survive a round
 * trip through a spreadsheet) and column order (headers must line up
 * with values on every row).
 */

function lead(overrides: Partial<StageExportLead> = {}): StageExportLead {
  const blank = Object.fromEntries(
    STAGE_EXPORT_COLUMNS.map((c) => [c.key, null])
  ) as StageExportLead;
  return { ...blank, ...overrides };
}

test("header row lists every export column, in order", () => {
  const csv = leadsToCsv([]);
  const [header, ...rest] = csv.split("\n");
  assert.equal(header, STAGE_EXPORT_COLUMNS.map((c) => c.header).join(","));
  assert.deepEqual(rest, []);
});

test("plain values land under their own headers", () => {
  const csv = leadsToCsv([
    lead({ first_name: "Carole", last_name: "Smith", phone: "3107493378", value: 0 }),
  ]);
  const [header, row] = csv.split("\n");
  const cols = header.split(",");
  const vals = row.split(",");
  assert.equal(vals[cols.indexOf("First Name")], "Carole");
  assert.equal(vals[cols.indexOf("Last Name")], "Smith");
  assert.equal(vals[cols.indexOf("Phone")], "3107493378");
  assert.equal(vals[cols.indexOf("Value")], "0");
});

test("commas, quotes and newlines are escaped so the row survives", () => {
  const csv = leadsToCsv([
    lead({
      address: "4233 W 159th St, Lawndale",
      notes: 'Said "call after 5"\nprefers text',
    }),
  ]);
  const row = csv.split("\n").slice(1).join("\n");
  assert.ok(row.includes('"4233 W 159th St, Lawndale"'));
  assert.ok(row.includes('"Said ""call after 5""\nprefers text"'));
});

test("null and undefined come out as empty cells, not the word null", () => {
  const csv = leadsToCsv([lead()]);
  const row = csv.split("\n")[1];
  assert.equal(row, ",".repeat(STAGE_EXPORT_COLUMNS.length - 1));
});

test("every row has one cell per column", () => {
  const csv = leadsToCsv([lead({ email: "a@b.com" }), lead({ zip: "90260" })]);
  const lines = csv.split("\n");
  assert.equal(lines.length, 3);
  for (const line of lines) {
    assert.equal(line.split(",").length, STAGE_EXPORT_COLUMNS.length);
  }
});

test("filename slugs the stage name and stamps the day", () => {
  assert.equal(
    stageExportFilename("Rows Incoming", new Date("2026-09-20T12:00:00Z")),
    "rows-incoming-contacts-2026-09-20.csv"
  );
  // Odd characters can't break the download header or the filesystem.
  assert.equal(
    stageExportFilename('A/B "Test" #1!', new Date("2026-09-20T12:00:00Z")),
    "a-b-test-1-contacts-2026-09-20.csv"
  );
});

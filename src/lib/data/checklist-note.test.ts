import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_CHECKLIST_NOTE,
  cleanChecklistNote,
  isMissingNoteColumn,
} from "./checklist-note.ts";

/**
 * A note is typed on the job board and saved on blur, so the two things
 * worth pinning down are what "empty" means and that a paste can't turn
 * a one-line field into a novel.
 */

test("a typed note is kept, trimmed", () => {
  assert.equal(cleanChecklistNote("gate code 4432"), "gate code 4432");
  assert.equal(cleanChecklistNote("  call Vanessa first  "), "call Vanessa first");
});

test("empty means no note at all, not an empty string", () => {
  assert.equal(cleanChecklistNote(""), null);
  assert.equal(cleanChecklistNote("   "), null);
  assert.equal(cleanChecklistNote("\n\t "), null);
  assert.equal(cleanChecklistNote(null), null);
  assert.equal(cleanChecklistNote(undefined), null);
});

test("a pasted paragraph folds onto one line", () => {
  assert.equal(
    cleanChecklistNote("permit filed\nwaiting on\tthe city"),
    "permit filed waiting on the city"
  );
});

test("a note cannot be longer than the ceiling", () => {
  const long = "x".repeat(MAX_CHECKLIST_NOTE + 50);
  assert.equal(cleanChecklistNote(long)?.length, MAX_CHECKLIST_NOTE);
});

test("the missing-column error is recognised in both wordings", () => {
  assert.equal(
    isMissingNoteColumn(
      "Could not find the 'note' column of 'project_checklist_items' in the schema cache"
    ),
    true
  );
  assert.equal(isMissingNoteColumn('column "note" does not exist'), true);
});

test("other failures are reported as themselves", () => {
  assert.equal(isMissingNoteColumn("new row violates row-level security policy"), false);
  assert.equal(isMissingNoteColumn("Could not find the 'phase' column in the schema cache"), false);
  // A note in the words, but not a missing column.
  assert.equal(isMissingNoteColumn("note is too long"), false);
});

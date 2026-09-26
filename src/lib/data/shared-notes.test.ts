import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canWriteSharedNotes,
  clientNoteAlert,
  kindCounts,
  kindLabel,
  normalizeSharedNote,
  seesClientNoteAlert,
  sortSharedNotes,
  type SharedNote,
} from "./shared-notes.ts";

/**
 * Shared notes are the one notes surface the customer can read, so the
 * rules that decide what gets written and who is told are pinned here.
 */

function note(over: Partial<SharedNote>): SharedNote {
  return {
    id: "n",
    lead_id: "lead-1",
    author_kind: "staff",
    author_id: "rep-1",
    body: "Body",
    kind: null,
    pinned: false,
    answer: null,
    answered_by: null,
    answered_at: null,
    edited_at: null,
    staff_seen_at: null,
    created_at: "2026-09-01T10:00:00Z",
    ...over,
  };
}

test("a note is trimmed, and an empty one is refused", () => {
  assert.deepEqual(normalizeSharedNote("  Tile: white  ", "selection", "client"), {
    body: "Tile: white",
    kind: "selection",
  });
  assert.ok("error" in normalizeSharedNote("   ", null, "staff"));
});

test("a plain note carries no tag", () => {
  assert.deepEqual(normalizeSharedNote("Gate code 1234", null, "client"), {
    body: "Gate code 1234",
    kind: null,
  });
});

test("an unknown tag is refused rather than saved", () => {
  assert.ok("error" in normalizeSharedNote("x", "urgent", "staff"));
});

test("only the team hands out to-dos; the client can't tag one", () => {
  assert.ok("error" in normalizeSharedNote("Clear the counters", "todo", "client"));
  assert.deepEqual(normalizeSharedNote("Clear the counters", "todo", "staff"), {
    body: "Clear the counters",
    kind: "todo",
  });
});

test("an overlong note is refused", () => {
  assert.ok("error" in normalizeSharedNote("a".repeat(4001), null, "staff"));
  assert.ok(!("error" in normalizeSharedNote("a".repeat(4000), null, "staff")));
});

test("pinned notes come first, then newest first", () => {
  const sorted = sortSharedNotes([
    note({ id: "old", created_at: "2026-09-01T10:00:00Z" }),
    note({ id: "pinned-old", pinned: true, created_at: "2026-08-01T10:00:00Z" }),
    note({ id: "new", created_at: "2026-09-03T10:00:00Z" }),
  ]);
  assert.deepEqual(
    sorted.map((n) => n.id),
    ["pinned-old", "new", "old"]
  );
});

test("counts each tag, and plain notes count under none of them", () => {
  const counts = kindCounts([
    note({ kind: "decision" }),
    note({ kind: "decision" }),
    note({ kind: "question" }),
    note({ kind: null }),
  ]);
  assert.deepEqual(counts, { decision: 2, selection: 0, question: 1, todo: 0 });
});

test("a to-do reads from each side of the screen", () => {
  assert.equal(kindLabel("todo", "client"), "To-do for you");
  assert.equal(kindLabel("todo", "staff"), "To-do for client");
  assert.equal(kindLabel("decision", "client"), "Decision");
});

test("office and admin are told about every client note; a rep only about their own customers", () => {
  const office = { id: "office-1", roles: ["Office"] };
  const admin = { id: "admin-1", roles: ["Admin"] };
  const rep = { id: "rep-1", roles: ["Sales"] };
  const otherRep = { id: "rep-2", roles: ["Sales"] };
  assert.equal(seesClientNoteAlert(office, "rep-1"), true);
  assert.equal(seesClientNoteAlert(admin, null), true);
  assert.equal(seesClientNoteAlert(rep, "rep-1"), true);
  assert.equal(seesClientNoteAlert(otherRep, "rep-1"), false);
  // An unassigned customer's note goes to the office, not to every rep.
  assert.equal(seesClientNoteAlert(rep, null), false);
});

test("the alert names the client and the tag, and shortens a long note", () => {
  const a = clientNoteAlert(note({ author_kind: "client", kind: "question", body: "Can we add lighting?" }), "Megan Sutton");
  assert.equal(a.title, "Megan Sutton added a note");
  assert.equal(a.body, "Question: Can we add lighting?");

  const long = clientNoteAlert(note({ author_kind: "client", body: "x".repeat(300) }), "");
  assert.equal(long.title, "A client added a note");
  assert.ok(long.body.length <= 120);
  assert.ok(long.body.endsWith("…"));
});

test("Office, Sales, Field and Admin write shared notes; other roles only read them", () => {
  assert.equal(canWriteSharedNotes({ roles: ["Office"] }), true);
  assert.equal(canWriteSharedNotes({ roles: ["Sales"] }), true);
  assert.equal(canWriteSharedNotes({ roles: ["Field"] }), true);
  assert.equal(canWriteSharedNotes({ roles: ["Admin"] }), true);
  assert.equal(canWriteSharedNotes({ roles: ["Dispatch"] }), false);
  assert.equal(canWriteSharedNotes({ roles: ["Bookkeeping"] }), false);
});

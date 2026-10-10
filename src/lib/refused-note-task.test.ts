import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * A note's ✕, a task's ☐ and a task's ✕ that row security refused matched
 * no row, came back with no error, and the panel refreshed as if it had
 * worked -- the note or task still there and nothing said (DECISIONS
 * #193). Each now asks for the row back, the way deleteEvent does, and
 * says so when there is none.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/** The source of one exported function, up to the next export. */
function body(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

const cases = [
  {
    file: "./actions/lead-notes.ts",
    name: "deleteLeadNote",
    says: "That note couldn't be deleted — your role may not have permission.",
  },
  {
    file: "./actions/leads.ts",
    name: "completeLeadTask",
    says: "Couldn't mark that task done — your role may not have permission.",
  },
  {
    file: "./actions/leads.ts",
    name: "deleteLeadTask",
    says: "That task couldn't be deleted — your role may not have permission.",
  },
];

test("a refused note delete, task tick or task delete says so", () => {
  for (const c of cases) {
    const fn = body(read(c.file), c.name);
    assert.match(fn, /\.select\("id"\)/, c.name);
    assert.match(fn, /if \(!data\?\.length\) \{?\s*return \{ error: /, c.name);
    assert.ok(fn.includes(c.says), `${c.name} says: ${c.says}`);
  }
});

test("the Tasks page and the task panel say the same thing", () => {
  const view = read("../app/(app)/tasks/tasks-view.tsx");
  assert.ok(view.includes(cases[1].says));
});

test("the notes panel no longer describes the refusal as silent", () => {
  const panel = read("../app/(app)/pipeline/notes-timeline.tsx");
  assert.doesNotMatch(panel, /A delete the database refuses returns none/);
});

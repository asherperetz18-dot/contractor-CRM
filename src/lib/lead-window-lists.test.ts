import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { withFreshPanels } from "./lead-window-lists.ts";
import type { LeadFile, LeadNote, LeadTask } from "./data/types.ts";

/**
 * A task, note or file added in the contact window didn't show in its
 * list or badge until the window was reopened (DECISIONS #201): the
 * lists came from the snapshot the window opened with, and the
 * router.refresh after each change re-rendered a page whose host keeps
 * its own copy. The host now reloads the open contact's three lists.
 */

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const task = { id: "t1", title: "Call back" } as LeadTask;
const note = { id: "n1", body: "Gate code 4411" } as LeadNote;
const file = { id: "f1", file_name: "roof.jpg" } as LeadFile;
const fresh = (id: string, listsFailed = false) => ({
  lead: { id },
  tasks: [task],
  notes: [note],
  files: [file],
  listsFailed,
});
const openOn = (id: string) => ({ lead: { id }, tasks: [], notes: [], files: [], tab: "Texts" as const });

test("fresh lists replace the open window's tasks, notes and files, and nothing else", () => {
  const open = openOn("A");
  const next = withFreshPanels(open, fresh("A"))!;
  assert.deepEqual([next.tasks, next.notes, next.files], [[task], [note], [file]]);
  // The same lead object, so the window's fields aren't re-seeded mid-edit.
  assert.equal(next.lead, open.lead);
  assert.equal(next.tab, "Texts");
});

test("a reload that lands after closing, or after another contact opened, changes nothing", () => {
  assert.equal(withFreshPanels(null, fresh("A")), null);
  const other = openOn("B");
  assert.equal(withFreshPanels(other, fresh("A")), other);
});

test("a reload with nothing to show, or a list that failed to load, keeps what's on screen", () => {
  const open = openOn("A");
  assert.equal(withFreshPanels(open, null), open);
  // getLeadCard reads a failed list as empty: that would blank the tab.
  assert.equal(withFreshPanels(open, fresh("A", true)), open);
});

test("getLeadCard says when a list didn't load, and keeps tasks in a stable order", () => {
  const action = source("./actions/pipeline-board.ts");
  const card = action.slice(action.indexOf("export async function getLeadCard("));
  assert.match(card, /listsFailed: !!\(tasksError \|\| notesError \|\| filesError\)/);
  assert.match(card, /\.from\("lead_tasks"\)[\s\S]*?\.eq\("lead_id", leadId\)\s*\.order\("created_at", \{ ascending: true \}\)/);
});

test("Tasks, Notes and Files ask the host for fresh lists after a change", () => {
  const form = source("../app/(app)/pipeline/lead-form.tsx");
  assert.match(form, /onPanelsChanged\?: \(\) => void;/);
  for (const panel of ["TasksPanel", "LeadNotesPane", "LeadFilesPanel"]) {
    assert.match(form, new RegExp(`<${panel}[\\s\\S]*?onChanged=\\{panelsChanged\\}[\\s\\S]*?\\/>`), panel);
  }
  assert.doesNotMatch(form, /onChanged=\{refresh\}/);
});

test("both hosts reload the open contact's lists without remounting it", () => {
  for (const host of ["../app/(app)/pipeline/pipeline-board.tsx", "../app/(app)/contacts/contacts-table.tsx"]) {
    const s = source(host);
    assert.match(s, /<LeadForm\s+key=\{editing\.lead\.id\}[\s\S]*?onPanelsChanged=\{\(\) => void reloadPanels\(editing\.lead\.id\)\}/, host);
    assert.match(s, /const fresh = await getLeadCard\(leadId\);\s*setEditing\(\(open\) => withFreshPanels\(open, fresh\)\);/, host);
  }
});

test("the appointment window's task and note lists already reload with router.refresh", () => {
  const form = source("../app/(app)/calendar/event-form.tsx");
  assert.match(form, /<TasksPanel[\s\S]*?onChanged=\{\(\) => router\.refresh\(\)\}/);
  assert.match(form, /<NotesTimeline[\s\S]*?onChanged=\{\(\) => router\.refresh\(\)\}/);
});

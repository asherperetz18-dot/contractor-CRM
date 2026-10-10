import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The contact window's Tasks, Notes and Texts tabs kept what was being
 * typed inside their panels, which unmount on a tab switch, and nothing
 * in the window asked before closing (DECISIONS #195): a typed task,
 * note, shared note or text was thrown away by a tab switch, the X, a
 * stage button or opening an estimate. The window now holds them, as the
 * appointment window does (#188, #190), and asks before any way out.
 */

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const form = source("../app/(app)/pipeline/lead-form.tsx");

test("the contact window holds its panels' drafts, so they outlive a tab switch", () => {
  assert.match(form, /const taskDraft = useTaskDraft\(\);/);
  assert.match(form, /const notesDrafts = useNotesPaneDrafts\(\);/);
  assert.match(form, /const textDrafts = useTextDrafts\(\);/);
  assert.match(form, /<TasksPanel[\s\S]*?draft=\{taskDraft\}[\s\S]*?\/>/);
  assert.match(form, /<LeadNotesPane[\s\S]*?drafts=\{notesDrafts\}[\s\S]*?\/>/);
  assert.match(form, /<MessagesPanel[\s\S]*?drafts=\{textDrafts\}[\s\S]*?\/>/);
});

test("every way out of the contact window asks before dropping what was typed", () => {
  assert.match(form, /const draftsWaiting = taskDraft\.waiting \|\| notesDrafts\.waiting \|\| textDrafts\.waiting;/);
  assert.match(form, /function leaveOk\(\) \{\s*return !draftsWaiting \|\| window\.confirm\(/);
  assert.match(form, /function handleClose\(\) \{\s*if \(!leaveOk\(\)\) return;/);
  for (const fn of ["handleDelete", "handleConvert", "handleBook"]) {
    assert.match(form, new RegExp(`async function ${fn}\\(\\) \\{\\s*if \\(!lead \\|\\| !leaveOk\\(\\)\\) return;`), fn);
  }
  // Before its own question, so the stage move isn't confirmed and then
  // abandoned.
  assert.match(form, /async function handleQuickExit\(stage: string\) \{\s*if \(!lead \|\| !leaveOk\(\)\) return;/);
  assert.match(form, /<LeadEstimateButton[\s\S]*?leaveOk=\{leaveOk\}[\s\S]*?\/>/);
  assert.match(form, /<LeadAppointmentsPanel[^>]*leaveOk=\{leaveOk\}/);

  const estimates = source("../app/(app)/pipeline/lead-estimate-button.tsx");
  assert.match(estimates, /leaveOk\?: \(\) => boolean;/);
  // Opening one, picking one from the list, or making a new one.
  assert.equal((estimates.match(/if \(leaveOk && !leaveOk\(\)\) return;/g) ?? []).length, 3);

  const visits = source("../app/(app)/pipeline/lead-appointments-panel.tsx");
  assert.match(visits, /function openAppointment\(eventId: string\) \{\s*if \(leaveOk && !leaveOk\(\)\) return;/);
});

test("the notes pane takes its drafts from the window: the internal note, the side, and the shared note", () => {
  const pane = source("../app/(app)/pipeline/lead-notes-pane.tsx");
  assert.match(pane, /export function useNotesPaneDrafts\(\)/);
  assert.match(pane, /drafts\?: NotesPaneDrafts;/);
  assert.match(pane, /const own = useNotesPaneDrafts\(\);/);
  assert.match(pane, /<NotesTimeline[\s\S]*?draft=\{d\.note\}[\s\S]*?\/>/);
  assert.match(pane, /waiting: note\.waiting \|\| sharedBody\.trim\(\) !== ""/);
  // A shared note on its way can't be shared twice after a tab switch,
  // and a call that never arrives doesn't leave the button stuck.
  assert.match(pane, /disabled=\{busy === "add" \|\| sharing \|\| !body\.trim\(\)\}/);
  assert.match(pane, /const res = await attempt\(action\);/);
});

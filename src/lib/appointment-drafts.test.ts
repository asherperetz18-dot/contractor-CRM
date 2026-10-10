import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The rest of the Edit Appointment window's lost work (DECISIONS #190):
 * a note typed in Activity & Notes and a text typed on the Texts tab
 * lived inside their panels, so a tab switch threw them away and Save
 * didn't commit the note; and several buttons left the window without
 * the discard question.
 */

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const form = source("../app/(app)/calendar/event-form.tsx");

test("the window holds the note and text drafts, so they outlive a tab switch", () => {
  assert.match(form, /const noteDraft = useNoteDraft\(\);/);
  assert.match(form, /const textDrafts = useTextDrafts\(\);/);
  assert.match(form, /<NotesTimeline[\s\S]*?draft=\{noteDraft\}[\s\S]*?\/>/);
  assert.match(form, /<MessagesPanel[\s\S]*?drafts=\{textDrafts\}[\s\S]*?\/>/);
  assert.match(form, /notePending: !!canAddNotes && noteDraft\.waiting,/);
  assert.match(form, /textPending: textDrafts\.waiting,/);
});

test("Save adds a typed note, and stays open on a typed text it won't send", () => {
  assert.match(form, /note: lead && canAddNotes && noteDraft\.waiting/);
  assert.match(form, /addLeadNote\(lead\.id, noteDraft\.body\)/);
  assert.match(form, /if \(textDrafts\.waiting\) \{\s*setError\(unsentTextNote\(outcome\.done\.length > 0\)\);\s*return;\s*\}/);
});

test("every way out of the window asks before dropping unsaved work", () => {
  assert.match(form, /function leaveOk\(\) \{\s*return !isDirty \|\| window\.confirm\(/);
  assert.match(form, /function requestClose\(\) \{\s*if \(!leaveOk\(\)\) return;/);
  assert.match(form, /function openFullLead\(\) \{\s*if \(!lead \|\| !leaveOk\(\)\) return;/);
  assert.match(form, /async function writeEstimate\(\) \{\s*if \(!lead \|\| !leaveOk\(\)\) return;/);
  assert.match(form, /function textPhone\(phone: string, body\?: string\) \{\s*if \(!leaveOk\(\)\) return;/);
  assert.match(form, /function openEstimate\(id: string\) \{\s*if \(!leaveOk\(\)\) return;/);
  assert.doesNotMatch(form, /router\.push\(`\/estimates\/\$\{e\.id\}`\)/);
});

test("the notes panel takes its draft from the window, and reports a lost or refused call", () => {
  const panel = source("../app/(app)/pipeline/notes-timeline.tsx");
  assert.match(panel, /export function useNoteDraft\(\)/);
  assert.match(panel, /draft\?: NoteDraft;/);
  assert.match(panel, /const own = useNoteDraft\(\);/);
  assert.match(panel, /await attempt\(\(\) => addLeadNote\(leadId, body\)\)/);
  assert.match(panel, /await attempt\(\(\) => deleteLeadNote\(id\)\)/);
  assert.match(panel, /if \(!body\.trim\(\)\) \{\s*setError\(/);
  // Add Note and the window's Save can't both send the same note.
  assert.match(panel, /disabled=\{pending \|\| busy\}/);
});

test("the texts panel takes its drafts from the window, and reports a lost call", () => {
  const panel = source("../app/(app)/pipeline/messages-panel.tsx");
  assert.match(panel, /export function useTextDrafts\(\)/);
  assert.match(panel, /drafts\?: TextDrafts;/);
  assert.match(panel, /const own = useTextDrafts\(\);/);
  assert.match(panel, /await attempt\(\(\) => sendSms\(leadId, phone, text\)\)/);
  assert.match(panel, /await attempt\(\(\) => sendRepMessage\(leadId, repTo, text\)\)/);
});

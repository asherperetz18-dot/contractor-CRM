import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { EventStatus } from "./data/types.ts";
import {
  SAVE_UNREACHABLE,
  SEND_UNREACHABLE,
  appointmentDeleteConfirm,
  appointmentFooter,
  applyLiveState,
  attempt,
  commitPending,
  unsentTextNote,
} from "./appointment-save.ts";

/**
 * The Edit Appointment window lost work without a word. Its Save wrote
 * only the appointment and closed, so a result picked on the Result tab
 * or a task typed on the Tasks tab was dropped; a typed task vanished on
 * a tab switch; a saved result left the window looking unsaved, with
 * Save Result gone; and a call that never reached the server (a tab
 * opened before an update) left its button greyed out forever.
 */

test("Save commits the appointment, then the result, then a typed task, and stops at the first failure", async () => {
  const order: string[] = [];
  const ok = (name: string) => async () => {
    order.push(name);
    return {};
  };
  assert.deepEqual(await commitPending({ task: ok("task"), result: ok("result"), appointment: ok("appointment") }), {
    done: ["appointment", "result", "task"],
  });
  assert.deepEqual(order, ["appointment", "result", "task"]);

  order.length = 0;
  const refused = await commitPending({
    appointment: ok("appointment"),
    result: async () => ({ error: "That stage no longer exists." }),
    task: ok("task"),
  });
  // Says what landed, what didn't and why, and what is still waiting.
  assert.deepEqual(refused, {
    error:
      "Saved the appointment. The result didn't save: That stage no longer exists. Not saved yet: the new task.",
    failedAt: "result",
    done: ["appointment"],
  });
  // Nothing after a failure runs.
  assert.deepEqual(order, ["appointment"]);

  // A result whose outcome landed but whose stage or note didn't says
  // exactly that, rather than "the result didn't save".
  assert.deepEqual(
    await commitPending({
      appointment: ok("appointment"),
      result: async () => ({ error: "The outcome is saved, but the contact didn't move to Follow Up: No.", partly: true }),
      task: ok("task"),
    }),
    {
      error: "Saved the appointment. The outcome is saved, but the contact didn't move to Follow Up: No. Not saved yet: the new task.",
      failedAt: "result",
      done: ["appointment"],
      partly: true,
    }
  );
  assert.deepEqual(await attempt(async () => ({ error: "Half.", partly: true })), { error: "Half.", partly: true });

  // Only what is pending runs, and a lone refusal reads as itself.
  assert.deepEqual(await commitPending({ task: ok("task") }), { done: ["task"] });
  assert.deepEqual(await commitPending({ appointment: async () => ({ error: "Pick a date." }), result: undefined }), {
    error: "Pick a date.",
    failedAt: "appointment",
    done: [],
  });
});

test("a call that never reaches the server says so, instead of leaving the button stuck", async () => {
  // A server action from a tab opened before a deploy rejects rather
  // than returning an error.
  const lost = async () => {
    throw new Error("Server Action not found");
  };
  assert.deepEqual(await attempt(lost), { error: SAVE_UNREACHABLE });
  assert.match(SAVE_UNREACHABLE, /Check your connection/);
  assert.match(SAVE_UNREACHABLE, /refresh the page/);
  assert.deepEqual(await commitPending({ appointment: async () => ({}), task: lost }), {
    error: `Saved the appointment. The new task didn't save: ${SAVE_UNREACHABLE}`,
    failedAt: "task",
    done: ["appointment"],
  });
  // A send that never came back may have gone out: it says to check the
  // thread rather than inviting a second text.
  assert.deepEqual(await attempt(lost, SEND_UNREACHABLE), { error: SEND_UNREACHABLE });
  assert.match(SEND_UNREACHABLE, /check the thread before sending it again/);
  // A plain success, an undefined return and a returned error pass through.
  assert.deepEqual(await attempt(async () => undefined), {});
  assert.deepEqual(await attempt(async () => ({ error: "No." })), { error: "No." });
});

const footer = (over: Partial<Parameters<typeof appointmentFooter>[0]> = {}) =>
  appointmentFooter({
    tab: "Appointment",
    readOnly: false,
    formDirty: false,
    resultDirty: false,
    taskPending: false,
    notePending: false,
    textPending: false,
    saving: false,
    ...over,
  });

test("the Result tab shows one save button: Save Result for a result alone, Save when anything else is pending too", () => {
  assert.deepEqual(footer({ tab: "Result", resultDirty: true }), { save: false, saveResult: true, dirty: true });
  assert.deepEqual(footer({ tab: "Result" }), { save: false, saveResult: true, dirty: false });
  // An edited appointment field or a typed task: Save commits all of it.
  assert.deepEqual(footer({ tab: "Result", resultDirty: true, formDirty: true }), {
    save: true,
    saveResult: false,
    dirty: true,
  });
  assert.deepEqual(footer({ tab: "Result", resultDirty: true, taskPending: true }), {
    save: true,
    saveResult: false,
    dirty: true,
  });
});

test("while Save is working, it stays the button on screen", () => {
  // The appointment lands first and stops counting as an edit; offering
  // Save Result then would let the result be sent a second time.
  assert.deepEqual(footer({ tab: "Result", resultDirty: true, saving: true }), {
    save: true,
    saveResult: false,
    dirty: true,
  });
});

test("other tabs keep Save, a typed task counts as unsaved work, and a read-only window saves nothing", () => {
  assert.deepEqual(footer({ tab: "Tasks", taskPending: true }), { save: true, saveResult: false, dirty: true });
  assert.deepEqual(footer({ tab: "Tasks" }), { save: true, saveResult: false, dirty: false });
  // Texts and Photos save as they go: Save only while something else waits.
  assert.deepEqual(footer({ tab: "Texts" }), { save: false, saveResult: false, dirty: false });
  assert.deepEqual(footer({ tab: "Photos", resultDirty: true }), { save: true, saveResult: false, dirty: true });
  assert.deepEqual(footer({ tab: "Result", readOnly: true, resultDirty: true, taskPending: true }), {
    save: false,
    saveResult: false,
    dirty: false,
  });
});

test("a typed note is saved by Save like a typed task, after it", async () => {
  const order: string[] = [];
  const ok = (name: string) => async () => {
    order.push(name);
    return {};
  };
  assert.deepEqual(await commitPending({ note: ok("note"), task: ok("task"), appointment: ok("appointment") }), {
    done: ["appointment", "task", "note"],
  });
  assert.deepEqual(order, ["appointment", "task", "note"]);
  assert.deepEqual(
    await commitPending({ task: async () => ({ error: "No." }), note: ok("note") }),
    { error: "The new task didn't save: No. Not saved yet: the new note.", failedAt: "task", done: [] }
  );
  // On the Result tab a typed note means Save, not Save Result.
  assert.deepEqual(footer({ tab: "Result", resultDirty: true, notePending: true }), {
    save: true,
    saveResult: false,
    dirty: true,
  });
  assert.deepEqual(footer({ tab: "Notes", notePending: true }), { save: true, saveResult: false, dirty: true });
});

test("a typed text counts as unsaved, but Save never sends it", () => {
  // On the Texts tab Save has nothing it may commit, so it stays hidden;
  // closing still asks.
  assert.deepEqual(footer({ tab: "Texts", textPending: true }), { save: false, saveResult: false, dirty: true });
  // A text waiting elsewhere doesn't take Save Result away from a result.
  assert.deepEqual(footer({ tab: "Result", resultDirty: true, textPending: true }), {
    save: false,
    saveResult: true,
    dirty: true,
  });
  // Save stays open on an unsent text and says why, whether or not
  // anything else was saved.
  assert.equal(
    unsentTextNote(true),
    "Saved. The text you typed on the Texts tab hasn't been sent: Save never sends a text. Send it or clear it there."
  );
  assert.equal(
    unsentTextNote(false),
    "The text you typed on the Texts tab hasn't been sent: Save never sends a text. Send it or clear it there."
  );
});

test("a note typed in a read-only window, where notes are still allowed, is unsaved work too", () => {
  // Save is hidden there (Add Note saves it), but closing has to ask.
  assert.deepEqual(footer({ tab: "Notes", readOnly: true, notePending: true }), {
    save: false,
    saveResult: false,
    dirty: true,
  });
});

test("the server's latest confirmations and status count as saved, not as an edit", () => {
  const opened = { customer_confirmed: false, rep_confirmed: false, status: "New" as const, title: "AP" };
  const live = { customer_confirmed: true, rep_confirmed: false, status: "Confirmed" as const };
  const untouched = { customer: false, rep: false, status: false };
  const form = applyLiveState(opened, live, untouched);
  assert.deepEqual(form, { ...opened, customer_confirmed: true, status: "Confirmed" });
  // The saved baseline takes all of it, so the form still matches it.
  assert.deepEqual(applyLiveState(opened, live), form);

  // A field the person already changed keeps their value, and stays unsaved.
  const edited = { ...opened, status: "Cancelled" as const };
  assert.equal(applyLiveState(edited, live, { ...untouched, status: true }).status, "Cancelled");
  assert.equal(applyLiveState(opened, live).status, "Confirmed");
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the window commits everything pending through one Save and keeps a typed task across tabs", () => {
  const form = source("../app/(app)/calendar/event-form.tsx");
  assert.match(form, /const taskDraft = useTaskDraft\(\);/);
  assert.match(form, /<TasksPanel[\s\S]*?draft=\{taskDraft\}[\s\S]*?\/>/);
  assert.match(form, /await commitPending\(\{/);
  // The appointment row is written only when one of its own fields
  // changed, so a result and a task can't put back a reschedule someone
  // else made since the page loaded.
  assert.match(form, /appointment: !event \|\| formDirty/);
  // One save at a time: neither button starts while the other is working.
  assert.match(form, /async function handleSave\(\) \{\s*if \(pending \|\| resultPending\) return;/);
  assert.match(form, /async function saveResult\(\) \{\s*if \(pending \|\| resultPending\) return;/);
  assert.match(form, /saving: pending,/);
  assert.match(form, /disabled=\{pending \|\| resultPending \|\| !resultDirty \|\| !resultValueOk\}/);
  assert.match(form, /result: resultDirty \? commitResult : undefined,/);
  assert.match(form, /task: lead && taskDraft\.waiting/);
  assert.match(form, /appointmentFooter\(\{/);
  assert.match(form, /taskPending: taskDraft\.waiting/);
  // A missing job value stops the save before anything is written.
  assert.match(form, /if \(resultDirty && !resultValueOk\) \{\s*setTab\("Result"\);/);
  // The server's re-read moves the baseline with the form.
  assert.match(form, /setForm\(\(f\) => applyLiveState\(f, live, confirmTouched\)\);/);
  assert.match(form, /setBaseline\(\(b\) => applyLiveState\(b, live\)\);/);
  // A saved result moves the baseline too, so the window doesn't look unsaved.
  assert.match(form, /setBaseline\(\(b\) => \(\{ \.\.\.b, status: outcome \}\)\);/);
  assert.doesNotMatch(form, /const \[openedWith\] = useState/);
  // A call that never arrives is reported, not left spinning.
  assert.match(form, /await attempt\(commitResult\)/);
  // Once the outcome is on record, a stage move or note that never
  // arrives is reported as half-saved too, not as "the result didn't save".
  assert.match(form, /await attempt\(\(\) => moveLeadStage\(lead\.id, chosenStage\)\)/);
  assert.match(form, /await attempt\(\(\) => addLeadNote\(lead\.id, resultNote\.trim\(\), event\.id\)\)/);
  assert.match(form, /await attempt\(\(\) => deleteEvent\(event\.id\)\)/);
  // The Result tab's red dot reads the saved status, so it clears once a
  // result is saved in this window.
  assert.match(form, /appointmentResultOverdue\(\{ \.\.\.event, status: baseline\.status \}, openedAtMs\)/);
  // A task already on its way (Add Task) can't be sent again by Save, nor
  // the other way round -- the slow-signal double tap.
  assert.match(form, /disabled=\{pending \|\| resultPending \|\| taskDraft\.busy \|\| noteDraft\.busy\}/);
  // A read-only window doesn't point at a save button it doesn't have.
  assert.match(form, /\{!readOnly && \(footer\.saveResult/);
  assert.match(form, /if \(taskStep\) taskDraft\.setBusy\(true\);/);
});

test("the task panel takes its draft from the window when given one, and reports a lost call", () => {
  const panel = source("../app/(app)/pipeline/tasks-panel.tsx");
  assert.match(panel, /export function useTaskDraft\(\)/);
  assert.match(panel, /draft\?: TaskDraft;/);
  assert.match(panel, /const own = useTaskDraft\(\);/);
  assert.match(panel, /await attempt\(\(\) => createLeadTask\(leadId, form\)\)/);
  assert.match(panel, /await attempt\(\(\) => completeLeadTask\(taskId\)\)/);
  assert.match(panel, /await attempt\(\(\) => deleteLeadTask\(taskId\)\)/);
  // Pressing Add Task with nothing typed says so.
  assert.match(panel, /if \(!form\.title\.trim\(\)\) \{\s*setError\(/);
  // The panel's Cancel throws the draft away, so Save can't add a task
  // the person backed out of.
  assert.match(panel, /onClick=\{cancelAdd\}/);
  assert.match(panel, /function cancelAdd\(\) \{\s*setError\(""\);\s*reset\(\);/);
  assert.match(panel, /disabled=\{pending \|\| busy\}/);
  // While the window's Save is sending the task, it can't be cancelled or
  // edited out from under it.
  assert.match(panel, /onClick=\{cancelAdd\}\s*disabled=\{busy\}/);
  assert.equal((panel.match(/disabled=\{busy\}/g) ?? []).length, 5);
});

const booked = {
  eventType: "Estimate",
  who: "Jane Smith",
  date: "2025-10-14",
  time: "09:00:00",
  endTime: "10:00:00",
  status: "New" as EventStatus,
  dirty: false,
};

test("Delete names the appointment it removes, and says it can't be undone", () => {
  // It was one click with nothing typed, and an appointment has no trash
  // (DECISIONS #200).
  const message = appointmentDeleteConfirm(booked);
  assert.match(message, /^Delete the Estimate appointment with Jane Smith on Tue, Oct 14 at 9:00 AM – 10:00 AM\?/);
  assert.match(message, /can't be undone/);
  assert.match(message, /notes and photos stay on Jane Smith's contact/);
  assert.match(message, /set Status to Cancelled instead/);
  assert.doesNotMatch(message, /unsaved/);
});

test("Delete's question fits what's on screen: cancelled, unsaved, no contact, no time", () => {
  assert.doesNotMatch(appointmentDeleteConfirm({ ...booked, status: "Cancelled" }), /Cancelled instead/);
  assert.match(appointmentDeleteConfirm({ ...booked, dirty: true }), /Your unsaved changes to it are discarded too\./);
  const orphan = appointmentDeleteConfirm({ ...booked, who: null });
  assert.match(orphan, /^Delete this Estimate appointment on Tue, Oct 14 at 9:00 AM – 10:00 AM\?/);
  assert.doesNotMatch(orphan, /contact/);
  assert.match(appointmentDeleteConfirm({ ...booked, time: null, endTime: null }), /on Tue, Oct 14\?/);
});

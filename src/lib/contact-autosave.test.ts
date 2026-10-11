import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SAVE_UNREACHABLE } from "./appointment-save.ts";
import {
  INCOMPLETE_CLOSE_QUESTION,
  SAVE_SLOW,
  withinWait,
  closeStep,
  contactPayload,
  contactSaveKey,
  contactSaveStatus,
  createContactSaver,
  failedCloseQuestion,
} from "./contact-autosave.ts";

/**
 * The contact window autosaves a second after the last edit, and closing
 * it cancelled the wait: a field changed in the last second was dropped,
 * and so was one that couldn't be saved, without a word. A save still
 * waiting could also land after ✕ Lost, Create Job or booking and put the
 * old stage back (DECISIONS #202).
 */

const form = {
  first_name: "Jane",
  last_name: "Smith",
  phone: "555-0100",
  second_contact_first_name: "Sam",
  second_contact_last_name: "Smith",
  second_contact_phone: "555-0101",
  second_contact_email: "sam@example.com",
};

test("the saved payload blanks a removed second contact", () => {
  assert.equal(contactPayload(form, true), form);
  assert.deepEqual(contactPayload(form, false), {
    ...form,
    second_contact_first_name: "",
    second_contact_last_name: "",
    second_contact_phone: "",
    second_contact_email: "",
  });
});

test("removing the second contact is an unsaved change though no field changed", () => {
  assert.notEqual(contactSaveKey(contactPayload(form, false)), contactSaveKey(contactPayload(form, true)));
  assert.equal(contactSaveKey(contactPayload(form, true)), contactSaveKey(contactPayload({ ...form }, true)));
});

test("closing saves what's waiting, asks when the form is incomplete, and just closes when nothing waits", () => {
  assert.equal(closeStep({ editable: true, dirty: true, valid: true }), "save");
  assert.equal(closeStep({ editable: true, dirty: true, valid: false }), "ask-incomplete");
  assert.equal(closeStep({ editable: true, dirty: false, valid: false }), "close");
  assert.equal(closeStep({ editable: false, dirty: true, valid: true }), "close");
  assert.match(INCOMPLETE_CLOSE_QUESTION, /missing a required field \(marked \*\)/);
  assert.match(failedCloseQuestion("No connection."), /aren't saved: No connection\.[\s\S]*without them\?/);
});

test("a failed autosave reads Not saved, never Saving…", () => {
  assert.equal(contactSaveStatus({ valid: true, dirty: true, failed: true }), "Not saved — see the message above");
  assert.equal(contactSaveStatus({ valid: true, dirty: true, failed: false }), "Saving…");
  assert.equal(contactSaveStatus({ valid: true, dirty: false, failed: false }), "✓ Saved");
  assert.equal(contactSaveStatus({ valid: false, dirty: true, failed: false }), "Not saved — fill in required fields (marked *)");
});

function fakeSave(answer: (p: { n: number }) => Promise<{ error?: string } | void> = async () => {}) {
  const calls: number[] = [];
  return { calls, save: (p: { n: number }) => (calls.push(p.n), answer(p)) };
}

test("a save in flight with the same fields isn't sent twice, and the saved fields aren't sent at all", async () => {
  const { calls, save } = fakeSave();
  const saver = createContactSaver(save, { n: 0 });
  assert.deepEqual(await saver.send({ n: 0 }), {});
  assert.deepEqual(calls, []);
  const [a, b] = [saver.send({ n: 1 }), saver.send({ n: 1 })];
  assert.equal(a, b);
  await a;
  await saver.send({ n: 1 });
  assert.deepEqual(calls, [1]);
  assert.equal(saver.dirty({ n: 1 }), false);
});

test("a newer edit waits for the save in flight, then is sent", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const { calls, save } = fakeSave(async (p) => {
    if (p.n === 1) await gate;
  });
  const saver = createContactSaver(save, { n: 0 });
  const first = saver.send({ n: 1 });
  const second = saver.send({ n: 2 });
  await Promise.resolve();
  assert.deepEqual(calls, [1]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(calls, [1, 2]);
  assert.equal(saver.savedKey(), contactSaveKey({ n: 2 }));
});

test("an edit undone while its save is out still counts as unsaved, and is sent after it", async () => {
  // Amy -> Bob goes out; back to Amy before it answers. Amy matched the
  // last save, so it read as saved: nothing waited for it, and Bob stayed
  // in the database (or Amy, flushed late, landed after a stage move).
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const { calls, save } = fakeSave(async (p) => {
    if (p.n === 1) await gate;
  });
  const saver = createContactSaver(save, { n: 0 });
  const bob = saver.send({ n: 1 });
  assert.equal(saver.dirty({ n: 0 }), true);
  assert.equal(saver.dirty({ n: 1 }), true);
  const amy = saver.send({ n: 0 });
  release();
  await Promise.all([bob, amy]);
  assert.deepEqual(calls, [1, 0]);
  assert.equal(saver.savedKey(), contactSaveKey({ n: 0 }));
  assert.equal(saver.dirty({ n: 0 }), false);
});

test("what was last saved is kept, for actions that must not use unsaved values", async () => {
  let refuse = false;
  const saver = createContactSaver(async () => (refuse ? { error: "No." } : {}), { n: 0 });
  assert.deepEqual(saver.savedPayload(), { n: 0 });
  await saver.send({ n: 1 });
  assert.deepEqual(saver.savedPayload(), { n: 1 });
  refuse = true;
  await saver.send({ n: 2 });
  assert.deepEqual(saver.savedPayload(), { n: 1 });
});

test("waiting on a save gives up after a while, with a message, without stopping it", async () => {
  assert.deepEqual(await withinWait(Promise.resolve({}), 50), {});
  const never = new Promise<{ error?: string }>(() => {});
  assert.deepEqual(await withinWait(never, 5), { error: SAVE_SLOW });
  assert.match(SAVE_SLOW, /taking too long/);
});

test("a refused or unreachable save leaves the change waiting and says why", async () => {
  const refused = createContactSaver(async () => ({ error: "Not allowed." }), { n: 0 });
  assert.deepEqual(await refused.send({ n: 1 }), { error: "Not allowed." });
  assert.equal(refused.dirty({ n: 1 }), true);
  const lost = createContactSaver(
    async () => {
      throw new Error("offline");
    },
    { n: 0 }
  );
  assert.deepEqual(await lost.send({ n: 1 }), { error: SAVE_UNREACHABLE });
  // Tried again on the next send, not handed the old failure.
  const { calls, save } = fakeSave();
  let first = true;
  const flaky = createContactSaver(
    (p: { n: number }) => (first ? ((first = false), Promise.resolve({ error: "Busy." })) : save(p)),
    { n: 0 }
  );
  await flaky.send({ n: 1 });
  assert.deepEqual(await flaky.send({ n: 1 }), {});
  assert.deepEqual(calls, [1]);
});

test("leaving without the window's own buttons sends a valid unsaved change, unless it was given up", async () => {
  const { calls, save } = fakeSave();
  const saver = createContactSaver(save, { n: 0 });
  saver.flushHeld();
  saver.hold({ n: 0 });
  saver.flushHeld();
  await saver.send({ n: 0 });
  assert.deepEqual(calls, [], "nothing held, or nothing new");
  saver.hold({ n: 1 });
  saver.flushHeld();
  await saver.send({ n: 1 });
  assert.deepEqual(calls, [1]);
  saver.hold(null); // an incomplete form isn't sent
  saver.flushHeld();
  saver.hold({ n: 2 });
  saver.abandon();
  saver.flushHeld();
  await saver.send({ n: 1 });
  assert.deepEqual(calls, [1]);
  // Giving up one change doesn't give up the next: the window can stay
  // open after a "without them" (a stage move answered No).
  saver.hold({ n: 3 });
  saver.flushHeld();
  await saver.send({ n: 3 });
  assert.deepEqual(calls, [1, 3]);
});

const form_ = readFileSync(new URL("../app/(app)/pipeline/lead-form.tsx", import.meta.url), "utf8");
const fn = (start: string) => {
  const at = form_.indexOf(start);
  assert.ok(at >= 0, start);
  const next = form_.slice(at + start.length).search(/\n  (async )?function /);
  return form_.slice(at, next < 0 ? undefined : at + start.length + next);
};

test("the contact window saves through one saver, and waits for it on the way out", () => {
  assert.match(form_, /const \[saver\] = useState\(\(\) =>\s*createContactSaver\(/);
  // The timer and every way out save the same payload through it.
  assert.match(form_, /autosaveTimer\.current = setTimeout\(\(\) => void saveFields\(payload\), 1000\);/);
  assert.doesNotMatch(form_, /second_contact_first_name: "",/);
  const leave = fn("async function leaveSaved()");
  assert.match(leave, /if \(autosaveTimer\.current\) clearTimeout\(autosaveTimer\.current\);/);
  assert.match(leave, /closeStep\(/);
  assert.match(leave, /INCOMPLETE_CLOSE_QUESTION/);
  assert.match(leave, /failedCloseQuestion\(/);
  // One at a time (a second X, an alert during a close), and a save that
  // never answers can't hold the window shut.
  assert.match(leave, /if \(leavingRef\.current\) return false;/);
  assert.match(leave, /await withinWait\(saveFields\(payload\), SAVE_WAIT_MS\)/);
  // Something saved while the window was open: the host refetches its
  // board or rows, which router.refresh doesn't reach.
  assert.match(fn("async function handleClose()"), /saver\.savedKey\(\) !== openingKey[\s\S]*?onSaved\(\);[\s\S]*?onCancel\(\);/);
  assert.match(form_, /contactSaveStatus\(\{/);
});

test("a stage move, Create Job and booking can't be undone by a save still waiting", () => {
  // Each settles the field save first (contact-drafts.test.ts), then:
  const exit = fn("async function handleQuickExit(stage: string)");
  assert.match(exit, /setPending\(true\);/);
  assert.doesNotMatch(exit, /setForm\(/);
  // ...and acts on what was saved: after "without them", the values on
  // screen never reached the contact.
  assert.doesNotMatch(form_, /convertLeadToJob\(lead\)/);
  assert.match(fn("async function handleConvert()"), /const saved = saver\.savedPayload\(\);[\s\S]*first_name: saved\.first_name/);
  assert.match(fn("async function handleBook()"), /const saved = saver\.savedPayload\(\);[\s\S]*bookAppointmentForLead\(lead\.id, saved\.stage,/);
});

test("closing by other means sends the last valid change; a deleted contact's isn't", () => {
  assert.match(form_, /useEffect\(\(\) => \(\) => saver\.flushHeld\(\), \[saver\]\);/);
  assert.match(form_, /saver\.hold\(formValid \? payload : null\);/);
  const del = fn("async function handleDelete()");
  assert.match(del, /saver\.abandon\(\);\s*refresh\(\);\s*onDeleted\?\.\(\);/);
  // A refused delete leaves the window open: the edit it held back goes now.
  assert.match(del, /setError\(result\.error\);\s*if \(formValid && saver\.dirty\(payload\)\) void saveFields\(payload\);\s*return;/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { holdUnsaved, leaveUnsavedOk, unsavedBeforeUnload } from "./unsaved-work.ts";

/**
 * The contact and appointment windows ask before their own buttons drop
 * what's typed (#197), but a popup alert navigated away without a word,
 * and a reload or closing the tab didn't ask either (DECISIONS #203). An
 * open window with unsaved work now holds it here: an alert asks the
 * window's own question first, and the browser asks before unloading.
 */

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function fakeTarget() {
  const calls: string[] = [];
  return {
    calls,
    addEventListener: (type: string) => calls.push(`add ${type}`),
    removeEventListener: (type: string) => calls.push(`remove ${type}`),
  };
}

function fakeUnload() {
  const event = { prevented: false, returnValue: undefined as unknown, preventDefault: () => (event.prevented = true) };
  return event;
}

test("with nothing held, leaving needs no answer", async () => {
  assert.equal(await leaveUnsavedOk(), true);
  const e = fakeUnload();
  unsavedBeforeUnload(e);
  assert.equal(e.prevented, false);
});

test("a held window's own leave check decides, until it lets go", async () => {
  const target = fakeTarget();
  let answer = false;
  const asked: number[] = [];
  const release = holdUnsaved(() => (asked.push(1), answer), target);
  assert.equal(await leaveUnsavedOk(), false);
  answer = true;
  assert.equal(await leaveUnsavedOk(), true);
  assert.equal(asked.length, 2);
  release();
  assert.equal(await leaveUnsavedOk(), true);
  assert.equal(asked.length, 2);
});

test("an async check is waited for, and a refusal stops at the first", async () => {
  const target = fakeTarget();
  const order: string[] = [];
  const a = holdUnsaved(async () => (order.push("a"), false), target);
  const b = holdUnsaved(() => (order.push("b"), true), target);
  assert.equal(await leaveUnsavedOk(), false);
  assert.deepEqual(order, ["a"]);
  a();
  a(); // twice is harmless, and leaves b held
  assert.equal(await leaveUnsavedOk(), true);
  assert.deepEqual(order, ["a", "b"]);
  b();
});

test("the browser asks before unloading only while something is held", () => {
  const target = fakeTarget();
  const a = holdUnsaved(() => true, target);
  const b = holdUnsaved(() => true, target);
  const e = fakeUnload();
  unsavedBeforeUnload(e);
  assert.equal(e.prevented, true);
  assert.equal(e.returnValue, true);
  a();
  b();
  b();
  assert.deepEqual(target.calls, ["add beforeunload", "remove beforeunload"]);
  const after = fakeUnload();
  unsavedBeforeUnload(after);
  assert.equal(after.prevented, false);
});

test("the windows hold their unsaved work, and a popup alert asks before leaving", () => {
  const hook = source("../app/(app)/use-hold-unsaved.ts");
  assert.match(hook, /useEffect\(\(\) => \(dirty \? holdUnsaved\(\(\) => latest\.current\(\)\) : undefined\), \[dirty\]\);/);
  assert.match(
    source("../app/(app)/pipeline/lead-form.tsx"),
    /useHoldUnsaved\(draftsWaiting \|\| \(!!lead && !readOnly && autosaveDirty\), \(\) => !pending && leaveSaved\(\)\);/
  );
  // While the window is busy saving or leaving, an alert waits rather than
  // asking the same questions again.
  assert.match(source("../app/(app)/calendar/event-form.tsx"), /useHoldUnsaved\(isDirty, \(\) => !pending && leaveOk\(\)\);/);
  assert.match(
    source("../app/(app)/popup-alerts.tsx"),
    /async function open\(t: PopupToast\) \{\s*if \(!\(await leaveUnsavedOk\(\)\)\) return;\s*dismiss\(t\.id\);\s*router\.push\(t\.href\);/
  );
});

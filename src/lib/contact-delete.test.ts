import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { contactDeleteConfirm } from "./contact-delete.ts";

/**
 * The contact window's Delete removed the contact, its estimates and
 * signed contracts, tasks, notes and files on one click when nothing was
 * typed (DECISIONS #200). It now asks once, naming what goes with it and
 * how to get it back.
 */

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const body = (src: string, start: string) => {
  const at = src.indexOf(start);
  assert.ok(at >= 0, start);
  const next = src.indexOf("\n  async function ", at + start.length);
  return src.slice(at, next < 0 ? undefined : next);
};

const full = {
  name: "Jane Smith",
  estimates: [{ status: "Signed" as const }, { status: "Sent" as const }],
  paidCents: 450_000,
  tasks: 3,
  notes: 1,
  files: 4,
  draftsWaiting: false,
};

test("it names the contact and counts what goes with it", () => {
  const message = contactDeleteConfirm(full);
  assert.match(message, /^Delete Jane Smith\?/);
  assert.match(message, /This also deletes 2 estimates \(1 signed, \$4,500\.00 paid\), 3 tasks, 1 note and 4 files\./);
  assert.match(message, /Appointments and texts stay, but lose their link to this contact\./);
  assert.match(message, /An Office or Admin user can restore it from Settings → Trash for 30 days\./);
});

test("someone who can't see estimates isn't shown their count or money", () => {
  const message = contactDeleteConfirm({ ...full, estimates: null, paidCents: 0 });
  assert.match(message, /any estimates or contracts/);
  assert.doesNotMatch(message, /\$|\d+ estimates?/);
});

test("singulars, and nothing attached", () => {
  assert.match(
    contactDeleteConfirm({ ...full, estimates: [{ status: "Draft" }], paidCents: 0, tasks: 1, notes: 0, files: 1 }),
    /This also deletes 1 estimate, 1 task and 1 file\./
  );
  const bare = contactDeleteConfirm({ ...full, estimates: [], paidCents: 0, tasks: 0, notes: 0, files: 0 });
  assert.doesNotMatch(bare, /also deletes/);
  assert.match(bare, /^Delete Jane Smith\?/);
});

test("it says a typed draft goes too, only when one is waiting", () => {
  assert.match(contactDeleteConfirm({ ...full, draftsWaiting: true }), /What you've typed on this contact is discarded too\./);
  assert.doesNotMatch(contactDeleteConfirm(full), /typed/);
});

test("30 days is the trash's own number", () => {
  // lead-trash.ts is server-only, so the dialog can't import it.
  assert.match(source("./lead-trash.ts"), /export const TRASH_RETENTION_DAYS = 30;/);
});

test("Delete asks that one question, which carries the draft warning", () => {
  const handler = body(source("../app/(app)/pipeline/lead-form.tsx"), "async function handleDelete()");
  assert.match(handler, /async function handleDelete\(\) \{\s*if \(!lead\) return;\s*const onFile = [^\n]*\n\s*if \(\s*!window\.confirm\(\s*contactDeleteConfirm\(/);
  assert.match(handler, /draftsWaiting,/);
  assert.doesNotMatch(handler, /leaveOk\(\)/);
  assert.equal((handler.match(/confirm\(/g) ?? []).length, 1);
  // A call that never comes back doesn't leave the window greyed out, and a
  // pending autosave can't write the contact while it's being deleted.
  assert.match(handler, /await attempt\(\(\) => deleteLead\(lead\.id\)\)/);
  assert.match(handler, /clearTimeout\(autosaveTimer\.current\)/);
});

test("a refused contact delete says so instead of reporting success", () => {
  const action = source("./actions/leads.ts");
  const del = action.slice(action.indexOf("export async function deleteLead("));
  assert.match(del.slice(0, 3000), /\.from\("leads"\)\s*\.delete\(\)\s*\.eq\("id", id\)\s*\.select\("id"\)/);
});

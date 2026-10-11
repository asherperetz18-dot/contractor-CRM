import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The deletes inside the contact and appointment windows' panels
 * (DECISIONS #200): a task's ✕ and a visit photo's Remove went on one
 * click, and the contact's Files ✕ reported a refused delete as done.
 */

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("a task's ✕ names the task and asks first", () => {
  const panel = source("../app/(app)/pipeline/tasks-panel.tsx");
  assert.match(
    panel,
    /async function handleDelete\(taskId: string, title: string\) \{\s*if \(!window\.confirm\(`Delete the task "\$\{title\}"\?`\)\) return;/
  );
  assert.match(panel, /onClick=\{\(\) => handleDelete\(t\.id, t\.title\)\}/);
});

test("a visit photo's Remove asks first, and reports a lost call", () => {
  const media = source("../app/(app)/calendar/visit-media.tsx");
  assert.match(
    media,
    /async function remove\(f: VisitFile\) \{\s*if \(!window\.confirm\(deletePhotoConfirm\(f\.file_name, f\.storage_provider, "visit"\)\)\) return;/
  );
  assert.match(media, /const res = await attempt\(\(\) => deleteLeadFile\(f\.id\)\);\s*if \(res\.error\) setError\(res\.error\);[\s\S]*?await reload\(\);\s*setBusy\(null\);\s*\}/);
  // A reload that can't reach the CRM keeps what's shown.
  assert.match(media, /async function reload\(\) \{\s*try \{[\s\S]*?\} catch \{/);
});

test("the contact's Files ✕ says whether the file can come back, and shows a refusal", () => {
  const panel = source("../app/(app)/pipeline/lead-files-panel.tsx");
  assert.match(panel, /if \(!window\.confirm\(deletePhotoConfirm\(file\.file_name, file\.storage_provider, "contact"\)\)\) return;/);
  // Reloaded either way: "Deleted, but saving it to the deletion history
  // failed" is an error about a file that's gone. And one delete at a
  // time, so a second ✕ can't report the first one's file as refused.
  // A file's ✕ stays off from the click until the reload drops the file;
  // only a delete that didn't happen turns it back on.
  assert.match(panel, /const res = await attempt\(\(\) => deleteLeadFile\(file\.id\)\);\s*if \(res\.error\) setDeleteError\(res\.error\);\s*if \(res\.error && !res\.error\.startsWith\("Deleted,"\)\) setDeleting\(\(s\) => without\(s, file\.id\)\);[\s\S]*?onChanged\(\);\s*\}/);
  assert.match(panel, /disabled=\{deleting\.has\(f\.id\)\}/);
  assert.match(panel, /\{deleteError && <p className="error-note">\{deleteError\}<\/p>\}/);
});

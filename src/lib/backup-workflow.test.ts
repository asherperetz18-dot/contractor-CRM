import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The nightly backup holds every company's customers, and it is stored as
 * a GitHub Actions artifact. This repository is public, and anyone signed
 * in to GitHub can download a public repository's artifacts -- so the
 * file must be locked with the BACKUP_PASSPHRASE secret before it is
 * uploaded, and the job must refuse to run at all without that secret
 * (DECISIONS #098).
 */

const workflow = readFileSync(
  new URL("../../.github/workflows/nightly-backup.yml", import.meta.url),
  "utf8"
);

function stepIndex(name: RegExp): number {
  const steps = [...workflow.matchAll(/^\s*- name: (.+)$/gm)].map((m) => m[1]);
  return steps.findIndex((s) => name.test(s));
}

test("the job stops before downloading anything when the password secret is missing", () => {
  const check = stepIndex(/password/i);
  const exportStep = stepIndex(/export/i);
  assert.ok(check >= 0, "a step must check BACKUP_PASSPHRASE");
  assert.ok(check < exportStep, "the password check must run before the export");
  assert.match(workflow, /if \[ -z "\$\{BACKUP_PASSPHRASE:-\}" \]; then[\s\S]*?exit 1/);
});

test("the backup is encrypted with the secret before upload", () => {
  const lock = stepIndex(/lock/i);
  const upload = stepIndex(/upload/i);
  assert.ok(lock >= 0 && lock < upload, "the lock step must come before the upload");
  assert.match(workflow, /BACKUP_PASSPHRASE: \$\{\{ secrets\.BACKUP_PASSPHRASE \}\}/);
  assert.match(workflow, /gpg --batch[\s\S]*?--symmetric --cipher-algo AES256/);
});

test("only the locked file can be uploaded", () => {
  const paths = [...workflow.matchAll(/^\s*path:\s*(.+)$/gm)].map((m) => m[1].trim());
  assert.deepEqual(paths, ["crm-backup-*.json.gpg"]);
});

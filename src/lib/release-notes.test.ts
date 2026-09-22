import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  RELEASE_NOTES,
  latestRelease,
  notesForVersion,
  shouldShowWhatsNew,
} from "./release-notes.ts";

/**
 * Every change to the CRM ships as a new version with a note people can
 * read on screen. These tests are the tripwire: bump the version without
 * writing the note, or write the note without bumping the version, and
 * `npm test` fails before the PR does.
 */

const pkg = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8")
) as { version: string };

const SEMVER = /^\d+\.\d+\.\d+$/;

test("the newest release note is the version package.json ships", () => {
  assert.equal(
    latestRelease().version,
    pkg.version,
    `package.json is v${pkg.version} but the newest note is v${latestRelease().version} -- ` +
      "bump package.json and add a release note together (see .claude/skills/release-notes)"
  );
});

test("release notes are newest first, one entry per version, all semver", () => {
  const seen = new Set<string>();
  for (const entry of RELEASE_NOTES) {
    assert.match(entry.version, SEMVER, `bad version "${entry.version}"`);
    assert.equal(seen.has(entry.version), false, `v${entry.version} listed twice`);
    seen.add(entry.version);
    assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/, `bad date on v${entry.version}`);
  }
  for (let i = 1; i < RELEASE_NOTES.length; i++) {
    const newer = RELEASE_NOTES[i - 1].version.split(".").map(Number);
    const older = RELEASE_NOTES[i].version.split(".").map(Number);
    const cmp =
      newer[0] - older[0] || newer[1] - older[1] || newer[2] - older[2];
    assert.ok(cmp > 0, `v${RELEASE_NOTES[i - 1].version} is listed above v${RELEASE_NOTES[i].version}`);
  }
});

test("every release says, in plain words, what a person sees differently", () => {
  for (const entry of RELEASE_NOTES) {
    assert.ok(entry.notes.length > 0, `v${entry.version} has no notes`);
    for (const note of entry.notes) {
      assert.ok(note.trim().length >= 12, `v${entry.version}: note too short to mean anything: "${note}"`);
    }
  }
});

test("notesForVersion finds a listed version and nothing for an unknown one", () => {
  const latest = latestRelease();
  assert.deepEqual(notesForVersion(latest.version), latest);
  assert.equal(notesForVersion("0.0.0"), null);
});

test("the What's new screen shows once per version per browser", () => {
  const v = latestRelease().version;
  // Fresh browser, or a version this browser has never acknowledged: show.
  assert.equal(shouldShowWhatsNew(v, null), true);
  assert.equal(shouldShowWhatsNew(v, "1.131.0"), true);
  // Already acknowledged this exact version: quiet.
  assert.equal(shouldShowWhatsNew(v, v), false);
  // A build with no note written for it has nothing to say.
  assert.equal(shouldShowWhatsNew("0.0.0", null), false);
});

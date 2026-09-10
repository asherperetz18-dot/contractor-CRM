import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldPromptUpdate, SNOOZE_MS } from "./update-popup.ts";

/**
 * The update popup must appear on its own whenever a deploy has happened,
 * and "Later" may only postpone it -- never silence a version for good,
 * which is how the old banner let people run week-old bundles.
 */

const T0 = 1_700_000_000_000;

test("no answer from the server yet: nothing to show", () => {
  assert.equal(shouldPromptUpdate("1.128.2", null, null, T0), false);
  assert.equal(shouldPromptUpdate("1.128.2", "", null, T0), false);
});

test("same version deployed: quiet", () => {
  assert.equal(shouldPromptUpdate("1.128.2", "1.128.2", null, T0), false);
});

test("a newer deploy is live: the popup appears automatically", () => {
  assert.equal(shouldPromptUpdate("1.128.2", "1.129.0", null, T0), true);
});

test("Later postpones, and only postpones: the popup comes back by itself", () => {
  const snooze = { version: "1.129.0", at: T0 };
  // Just snoozed: quiet.
  assert.equal(shouldPromptUpdate("1.128.2", "1.129.0", snooze, T0 + 1), false);
  // Still inside the snooze window: quiet.
  assert.equal(
    shouldPromptUpdate("1.128.2", "1.129.0", snooze, T0 + SNOOZE_MS - 1),
    false
  );
  // Window over: back on screen, no click required.
  assert.equal(
    shouldPromptUpdate("1.128.2", "1.129.0", snooze, T0 + SNOOZE_MS),
    true
  );
});

test("a snooze belongs to one version: the next release prompts immediately", () => {
  const snooze = { version: "1.129.0", at: T0 };
  assert.equal(shouldPromptUpdate("1.128.2", "1.129.1", snooze, T0 + 1), true);
});

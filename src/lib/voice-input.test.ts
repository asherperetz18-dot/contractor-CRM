import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeTranscript,
  micErrorMessage,
  resultsToSegments,
  speakableReply,
} from "./voice-input.ts";

/**
 * The browser's speech recognition fires progressive result events with
 * arbitrary segmenting, and its failures arrive as terse error codes.
 * What the chat does with both is decided here, pure and pinned: the
 * text the person sees while talking, the moment a question auto-sends,
 * and the words a mic failure shows instead of a code.
 */

// ── mergeTranscript ──────────────────────────────────────────────────

test("an interim result shows text but never sends", () => {
  const merged = mergeTranscript([{ isFinal: false, transcript: "how many open" }]);
  assert.equal(merged.text, "how many open");
  assert.equal(merged.isFinal, false);
});

test("segments join with single spaces however the browser split them", () => {
  const merged = mergeTranscript([
    { isFinal: true, transcript: "who still " },
    { isFinal: true, transcript: "  owes us money" },
  ]);
  assert.equal(merged.text, "who still owes us money");
  assert.equal(merged.isFinal, true);
});

test("a mix of final and interim segments is not final yet", () => {
  const merged = mergeTranscript([
    { isFinal: true, transcript: "who still owes" },
    { isFinal: false, transcript: "us" },
  ]);
  assert.equal(merged.isFinal, false);
});

test("no results at all is empty and not final", () => {
  assert.deepEqual(mergeTranscript([]), { text: "", isFinal: false });
});

test("the browser's ArrayLike results unpack to plain segments", () => {
  // SpeechRecognitionResultList is index-plus-length, not a real array,
  // and each result's best alternative sits at [0].
  const results = {
    length: 2,
    0: Object.assign([{ transcript: "hello" }], { isFinal: true }),
    1: Object.assign([{ transcript: " world" }], { isFinal: false }),
  };
  assert.deepEqual(resultsToSegments(results), [
    { isFinal: true, transcript: "hello" },
    { isFinal: false, transcript: " world" },
  ]);
});

// ── micErrorMessage ──────────────────────────────────────────────────

test("a blocked microphone explains itself in plain words", () => {
  for (const code of ["not-allowed", "service-not-allowed"]) {
    const msg = micErrorMessage(code);
    assert.ok(msg && msg.includes("blocked"), `${code} should read as blocked`);
  }
});

test("tapping the mic and saying nothing is not an error worth showing", () => {
  assert.equal(micErrorMessage("no-speech"), null);
  // Tapping stop yourself aborts recognition; that's a choice, not a failure.
  assert.equal(micErrorMessage("aborted"), null);
});

test("other failures fall back to one generic line, never a raw code", () => {
  const msg = micErrorMessage("network");
  assert.ok(msg && !msg.includes("network"), "no raw codes in the UI");
  assert.ok(micErrorMessage(undefined));
});

// ── speakableReply ───────────────────────────────────────────────────

test("bullet lists read as sentences, not dashes", () => {
  const spoken = speakableReply("Two leads need a call:\n- Bob Smith\n- Alice Jones");
  assert.equal(spoken, "Two leads need a call: Bob Smith. Alice Jones.");
});

test("existing punctuation is kept, missing punctuation is added", () => {
  assert.equal(speakableReply("You have 3 overdue tasks."), "You have 3 overdue tasks.");
  assert.equal(speakableReply("You have 3 overdue tasks"), "You have 3 overdue tasks.");
});

test("blank lines collapse instead of reading as silence", () => {
  const spoken = speakableReply("First point.\n\n\nSecond point.");
  assert.equal(spoken, "First point. Second point.");
});

test("an empty reply speaks nothing", () => {
  assert.equal(speakableReply("   \n  "), "");
});

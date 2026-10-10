import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * A Showed or Won needs the job's value (DECISIONS #189). The box started
 * empty with the contact's value only as grey placeholder text, so a rep
 * confirming a figure the contact already had retyped it -- and a box
 * that looked filled kept Save Result greyed out.
 */

const form = readFileSync(new URL("../app/(app)/calendar/event-form.tsx", import.meta.url), "utf8");

test("a Showed or Won starts from the contact's current job value", () => {
  // The box shows the contact's live value until someone types in it, so
  // a refresh that brings a newer figure moves an untouched box with it.
  assert.match(form, /const \[typedValue, setTypedValue\] = useState<string \| null>\(null\);/);
  assert.match(form, /const resultValue = typedValue \?\? \(lead && lead\.value > 0 \? String\(lead\.value\) : ""\);/);
  assert.doesNotMatch(form, /const \[resultValue, setResultValue\] = useState/);
  // Says where the number came from, so it's checked rather than assumed.
  assert.match(form, /resultValueOk && !!lead\.value && parsedResultValue === lead\.value && \(/);
});

test("changing the value on a recorded Showed or Won is a result to save", () => {
  // It counted as nothing: Save Result stayed greyed out, the footer said
  // "Nothing changed to save." and closing dropped the new figure.
  assert.match(form, /\(outcomeNeedsValue && resultValueOk && !!lead && parsedResultValue !== lead\.value\)/);
});

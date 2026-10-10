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
  assert.match(form, /const \[resultValue, setResultValue\] = useState\(\(\) => \{/);
  assert.match(form, /return opening\?\.value && opening\.value > 0 \? String\(opening\.value\) : "";/);
  assert.doesNotMatch(form, /const \[resultValue, setResultValue\] = useState\(""\);/);
  // Says where the number came from, so it's checked rather than assumed.
  assert.match(form, /resultValueOk && !!lead\.value && parsedResultValue === lead\.value && \(/);
});

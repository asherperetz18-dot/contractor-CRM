import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseJobValue } from "./appointment-save.ts";

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

test("changing the value on a recorded Showed or Won is a result to save, until it is saved", () => {
  // It counted as nothing: Save Result stayed greyed out, the footer said
  // "Nothing changed to save." and closing dropped the new figure.
  assert.match(
    form,
    /\(outcomeNeedsValue && resultValueOk && !!lead && parsedResultValue !== lead\.value && parsedResultValue !== savedValue\)/
  );
  // The figure this window just wrote isn't an edit while the page's copy
  // of the contact still holds the old one.
  assert.match(form, /const \[savedValue, setSavedValue\] = useState<number \| null>\(null\);/);
  assert.match(
    form,
    /const valueResult = await setLeadEstimatedValue\(lead\.id, parsedResultValue\);\s*if \(valueResult\?\.error\) return \{ error: valueResult\.error \};\s*setSavedValue\(parsedResultValue\);/
  );
  assert.match(form, /const parsedResultValue = parseJobValue\(resultValue\);/);
});

test("a typed value is read to the cent, as the contact stores it", () => {
  // leads.value is numeric(12,2): an unrounded figure never equalled the
  // stored one, so the window stayed unsaved forever.
  assert.equal(parseJobValue("$18,000.555"), 18000.56);
  assert.equal(parseJobValue("18000"), 18000);
  assert.equal(parseJobValue("0.004"), 0);
  assert.equal(parseJobValue(""), 0);
  assert.ok(Number.isNaN(parseJobValue(".")));
});

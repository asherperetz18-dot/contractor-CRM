import { test } from "node:test";
import assert from "node:assert/strict";
import { GROUP_TONES, NAV_TONES, PAGE_REGISTRY, TOP_LEVEL_NAV_GROUP } from "./data/types.ts";

/**
 * Every collapsible sidebar group carries a color, so the eye can find
 * a section without reading its label. One hue per department, none
 * shared, and none of them the reserved money colors (green is money
 * in, red is money out, everywhere in the CRM). A group added without
 * a tone would render in the plain text color and read as the odd one
 * out, so this fails the build instead.
 */
test("every sidebar group has its own color tone", () => {
  const groups = new Set(
    PAGE_REGISTRY.map((p) => p.group).filter((g) => g !== TOP_LEVEL_NAV_GROUP)
  );
  const seen = new Map<string, string>();
  for (const group of groups) {
    const tone = GROUP_TONES[group];
    assert.ok(tone, `group "${group}" has no tone`);
    assert.ok(NAV_TONES.includes(tone), `"${tone}" is not a known tone`);
    const other = seen.get(tone);
    assert.equal(other, undefined, `"${group}" and "${other}" share the ${tone} tone`);
    seen.set(tone, group);
  }
  assert.equal(seen.size, groups.size);
  for (const group of Object.keys(GROUP_TONES)) {
    assert.ok(groups.has(group), `GROUP_TONES names "${group}", which is not a sidebar group`);
  }
});

test("the group tones name departments, never the money directions", () => {
  for (const tone of NAV_TONES) {
    assert.ok(!/green|red|in$|out$/.test(tone), tone + " reads as a money color");
  }
});

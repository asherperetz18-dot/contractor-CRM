import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * On a phone the top bar's tools are hidden and opened from More
 * (DECISIONS #089). The dialer went with them, so on the Android app the
 * only way to dial a number by hand was More → scroll past every page →
 * Tools → Dialer, and reps reported there was no dial button at all. The
 * dialer now stays in the phone's top bar, beside the bell, and its panel
 * fits the phone between the top bar and the tabs (DECISIONS #109).
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const mobileCss = read("../app/mobile.css");

/** The body of every `@media (max-width: 700px)` block in mobile.css. */
function phoneRules(css: string): string {
  const out: string[] = [];
  const marker = "@media (max-width: 700px) {";
  let at = css.indexOf(marker);
  while (at !== -1) {
    let depth = 0;
    let i = at + marker.length - 1;
    for (; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) break;
    }
    out.push(css.slice(at + marker.length, i));
    at = css.indexOf(marker, i);
  }
  return out.join("\n");
}

test("the dialer's button stays in the phone's top bar while the other tools hide", () => {
  const phone = phoneRules(mobileCss);
  assert.match(phone, /\.tool-slot:not\(\[data-tool="dialer"\]\) \.topbar-icon-btn\s*\{\s*display:\s*none/);
  assert.doesNotMatch(phone, /(^|[\s,}])\.tool-slot \.topbar-icon-btn\s*\{\s*display:\s*none/);
});

test("More no longer lists the dialer -- it is one tap away in the top bar", () => {
  const sheet = read("../app/(app)/more-sheet.tsx");
  assert.doesNotMatch(sheet, /key:\s*"dialer"/);
});

test("on a phone the dialer panel fits between the top bar and the tabs, and scrolls", () => {
  const phone = phoneRules(mobileCss);
  const panel = phone.match(/\.voice-dialer-panel\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(panel, /max-height:[^;]*--phone-tabbar-h/, "Call and Hang Up never sit under the tabs");
  assert.match(panel, /overflow-y:\s*auto/);
});

test("typing a number opens the phone's number pad, not the full keyboard", () => {
  const dialer = read("../app/(app)/voice-dialer.tsx");
  assert.match(dialer, /className="voice-dialer-input"[\s\S]{0,80}type="tel"/);
});

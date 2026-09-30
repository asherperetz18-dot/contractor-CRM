import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The dashboard's alert cards (Overdue tasks, Overdue payments, Awaiting
// signature, ...) were a fixed two-up grid on phones. A grid column of
// `1fr` is at least as wide as its widest content, and a money figure
// never wraps, so on a 360px phone -- or any phone with a larger text
// setting -- "$1,914,828" pushed both columns past the screen and the
// right-hand cards were cut off. These rules pin the fix.

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

function rules(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g"))].map((m) => m[1]);
}

test("on phones the alert cards go one per row when two would not fit the text", () => {
  // A minimum in em grows with the phone's text size, so a larger
  // setting drops to one card per row instead of running off-screen;
  // min(100%, …) keeps that one card inside the screen.
  const phone = rules(".dash-attn-grid").find((r) => r.includes("grid-template-columns") && !r.includes("180px"));
  assert.ok(phone, "the phone .dash-attn-grid rule exists");
  assert.match(phone, /repeat\(auto-fit,\s*minmax\(min\(100%,\s*[\d.]+em\),\s*1fr\)\)/);
});

test("a card and its number may shrink below their content, so nothing widens the page", () => {
  assert.ok(rules(".dash-attn-card").some((r) => /min-width:\s*0/.test(r)), ".dash-attn-card has min-width: 0");
  assert.ok(rules(".dash-attn-value").some((r) => /min-width:\s*0/.test(r)), ".dash-attn-value has min-width: 0");
});

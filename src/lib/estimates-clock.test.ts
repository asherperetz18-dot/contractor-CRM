import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Estimates & Contracts filter every document by the day it was made on
 * the company's clock: the server hands both views the company's today
 * and zone, the date window is worked out from that today, and each
 * created_at is checked between the window's company midnights. A
 * document made after 5pm Pacific used to fall on the next (UTC) day.
 */

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const pages = [source("../app/(app)/estimates/page.tsx"), source("../app/(app)/contracts/page.tsx")];
const views = [
  source("../app/(app)/estimates/estimates-view.tsx"),
  source("../app/(app)/contracts/contracts-view.tsx"),
];

test("both pages hand their view the company's today and zone", () => {
  for (const page of pages) {
    assert.match(page, /const today = isoDateInZone\(new Date\(\), zone\);/);
    assert.match(page, /today=\{today\}/);
    assert.match(page, /zone=\{zone\}/);
  }
});

test("both date filters count a document on the company's day it was made", () => {
  for (const view of views) {
    // The window from the company's today, not a clock read while drawing.
    assert.match(view, /new Date\(`\$\{today\}T12:00:00`\)/);
    // Each created_at between the window's company midnights; a date
    // still being typed is no edge rather than a crash.
    assert.match(view, /stampedWithin\(\{ from: calendarDay\(\w+\.from\), to: calendarDay\(\w+\.to\) \}, zone\)/);
    assert.doesNotMatch(view, /withinWindow\(e\.created_at/);
    // Typing one date fills the other with the company's today.
    assert.match(view, /max=\{today\}/);
  }
});

test("the follow-up chips measure against the company's today", () => {
  const [estimates] = views;
  assert.match(estimates, /followUpClock\(today, zone\)/);
});

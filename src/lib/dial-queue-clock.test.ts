import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The dial queue's booking step opens on the company's today, and its
 * picker stops there. It read the browser's UTC date, already tomorrow
 * from 5pm Pacific, so an evening call couldn't book that evening without
 * typing the date in.
 */

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const page = source("../app/(app)/dial-queue/page.tsx");
const view = source("../app/(app)/dial-queue/dial-queue-view.tsx");
const session = source("../app/(app)/dial-queue/dial-session.tsx");

test("the page hands the queue the company's zone", () => {
  assert.match(page, /getCompanyZone\(\)/);
  assert.match(page, /<DialQueueView[\s\S]*?zone=\{zone\}[\s\S]*?\/>/);
});

test("a session carries the company's today from the moment it starts", () => {
  assert.match(view, /today: isoDateInZone\(new Date\(\), zone\)/);
  assert.match(view, /<DialSession[\s\S]*?today=\{session\.today\}[\s\S]*?\/>/);
});

test("the booking step opens on that today and stops at it, with no clock of its own", () => {
  assert.match(session, /today: string;/);
  assert.match(session, /setBooking\(\{ date: today, /);
  assert.match(session, /min=\{today\}/);
  assert.doesNotMatch(session, /toISOString/);
  assert.doesNotMatch(session, /function todayISO/);
});

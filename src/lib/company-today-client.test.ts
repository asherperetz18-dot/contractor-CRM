import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

/**
 * Client screens read "today" on the company's calendar. The app layout
 * hands every screen the company's zone (from the cached company row it
 * already reads), and `useCompanyToday()` turns it into a day: the same
 * one on the server's first draw and in the browser, so a default date
 * hydrates cleanly. Before, each form took today from
 * `new Date().toISOString()`, the UTC date, which is already tomorrow
 * from 5pm Pacific: in the evening every new task, appointment and
 * payment started on tomorrow, and the Calendar marked tomorrow as today.
 */

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the layout hands every screen the company's zone, from the cached company row", () => {
  const chrome = source("./data/company-chrome.ts");
  assert.match(chrome, /\.select\("name, logo_url, time_format, nav_order, timezone"\)/);
  const layout = source("../app/(app)/layout.tsx");
  assert.match(layout, /<CompanyZoneProvider value=\{companyIanaZone\(company\.timezone\)\}>/);
});

test("useCompanyToday reads the company's day, and the browser's own outside the app shell", () => {
  const path = new URL("../components/company-zone-context.tsx", import.meta.url);
  assert.ok(existsSync(path), "the zone context exists");
  const ctx = readFileSync(path, "utf8");
  assert.match(ctx, /export function useCompanyToday\(\)/);
  assert.match(ctx, /zone \? isoDateInZone\(new Date\(\), zone\) : isoDay\(new Date\(\)\)/);
});

const sites = [
  "../app/(app)/pipeline/tasks-panel.tsx",
  "../app/(app)/pipeline/lead-form.tsx",
  "../app/(app)/schedule/appointment-wizard.tsx",
  "../app/(app)/calendar/calendar-board.tsx",
  "../app/(app)/estimates/[id]/record-payment.tsx",
  "../app/(app)/estimates/[id]/completion-certificate.tsx",
  // Today marks, the Signed on paper limit, and download file names.
  "../app/(app)/pipeline/lead-appointments-panel.tsx",
  "../app/(app)/estimates/[id]/signed-on-paper-dialog.tsx",
  "../app/(app)/settings/backup/backup-view.tsx",
  "../app/(app)/platform-admin/companies/companies-view.tsx",
  "../app/(app)/lead-refunds/lead-refunds-view.tsx",
];

test("the screens that took today from the UTC date take it from the company's day", () => {
  for (const path of sites) {
    const s = source(path);
    assert.match(s, /const today = useCompanyToday\(\);/, path);
    assert.doesNotMatch(s, /toISOString\(\)\.slice\(0, 10\)/, path);
    assert.doesNotMatch(s, /function todayISO/, path);
  }
});

test("the Calendar opens on the company's month, the one its today is in", () => {
  const page = source("../app/(app)/calendar/page.tsx");
  assert.match(page, /month \?\?= monthOf\(await companyToday\(\)\);/);
});

test("the customer portal splits upcoming and past visits on the company's today, handed down", () => {
  // The portal sits outside the app shell, so its page hands the day
  // down: the same one it hides lapsed certificates on.
  const page = source("../app/portal/home/page.tsx");
  const home = source("../app/portal/home/portal-home.tsx");
  assert.match(page, /today=\{companyToday\}/);
  assert.match(home, /today: string;/);
  assert.match(home, /e\.date >= today && e\.status !== "Cancelled"/);
  assert.doesNotMatch(home, /toISOString\(\)\.slice\(0, 10\)/);
});


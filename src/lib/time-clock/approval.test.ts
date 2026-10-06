import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { approvalBlocker, reopenBlocker, weekPeriod } from "./approval.ts";

/**
 * Week approval (DECISIONS #157): the office approves a person's week
 * once it is over, and from then on its hours can't change -- the payroll
 * export is the week that was approved. Reopening it takes a reason and
 * is kept on record.
 */

const ZONE = "America/Los_Angeles";
const WEEK = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"];

test("a week is Monday 00:00 to the next Monday 00:00 on the company's clock", () => {
  const p = weekPeriod(WEEK, ZONE);
  assert.equal(p.start, "2026-09-21T07:00:00.000Z");
  assert.equal(p.end, "2026-09-28T07:00:00.000Z");
  // Across the fall clock change the week is an hour longer.
  const fall = weekPeriod(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"], ZONE);
  assert.equal(fall.start, "2026-10-26T07:00:00.000Z");
  assert.equal(fall.end, "2026-11-02T08:00:00.000Z");
});

test("approving: only a week that is over, with nobody still clocked in, and never your own unless you're an Admin", () => {
  const end = weekPeriod(WEEK, ZONE).end;
  const after = new Date("2026-09-28T16:00:00Z");
  const base = { periodEnd: end, now: after, open: false, isSelf: false, isAdmin: false };
  assert.equal(approvalBlocker(base), null);
  // Sunday evening in Los Angeles is still the week.
  assert.match(approvalBlocker({ ...base, now: new Date("2026-09-28T03:00:00Z") })!, /isn't over yet/);
  assert.match(approvalBlocker({ ...base, open: true })!, /still clocked in/);
  assert.match(approvalBlocker({ ...base, isSelf: true })!, /your own week/);
  assert.equal(approvalBlocker({ ...base, isSelf: true, isAdmin: true }), null);
});

test("reopening: a reason, and the same rule about your own week", () => {
  assert.match(reopenBlocker({ reason: " ", isSelf: false, isAdmin: false })!, /Say why/);
  assert.equal(reopenBlocker({ reason: "Missed Friday overtime", isSelf: false, isAdmin: false }), null);
  assert.match(reopenBlocker({ reason: "Missed Friday overtime", isSelf: true, isAdmin: false })!, /your own week/);
  assert.equal(reopenBlocker({ reason: "Missed Friday overtime", isSelf: true, isAdmin: true }), null);
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the lock is in the database: no punch in an approved week can be added or changed, by anyone", () => {
  const sql = source("../../../supabase/migrations/0212_timesheet_approvals.sql");
  assert.match(sql, /create table if not exists public\.timesheet_approvals/);
  // One live approval per person and week; a reopened one stays on record.
  assert.match(sql, /create unique index if not exists timesheet_approvals_live_key\s+on public\.timesheet_approvals \(company_id, profile_id, week_start\) where reopened_at is null/);
  assert.match(sql, /create trigger time_punches_week_lock before insert or update on public\.time_punches/);
  // Both where the punch was and where it's going.
  assert.match(sql, /tg_op = 'UPDATE' and public\.timesheet_week_locked\(old\.company_id, old\.profile_id, old\.clock_in\)/);
  assert.match(sql, /public\.timesheet_week_locked\(new\.company_id, new\.profile_id, new\.clock_in\)/);
  assert.match(sql, /alter table public\.timesheet_approvals enable row level security;/);
  assert.match(sql, /select public\.apply_billing_lock_policies\(\);/);
});

test("the office approves and reopens; a fix to an approved week is refused before it's tried", () => {
  const actions = source("../actions/timesheet-approvals.ts");
  assert.match(actions, /export async function approveWeek\(/);
  assert.match(actions, /export async function reopenWeek\(/);
  assert.match(actions, /isAdminRole\(profile\)/);
  assert.match(actions, /approvalBlocker\(/);
  assert.match(actions, /reopenBlocker\(/);
  const punches = source("../actions/time-clock.ts");
  assert.match(punches, /This week has been approved/);
  // The page shows who approved, offers Approve and Reopen, and hides Fix on a locked week.
  const view = source("../../app/(app)/timesheets/timesheet-view.tsx");
  assert.match(view, /Approve week/);
  assert.match(view, /Reopen week/);
  assert.match(view, /!p\.approval && \(/);
  // Read on its own, so a database without 0212 shows the page as before.
  const page = source("../../app/(app)/timesheets/page.tsx");
  assert.match(page, /\.from\("timesheet_approvals"\)/);
});

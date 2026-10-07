import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { myRecentWeeks, myWeekLine, showMyWeeks, type WeekApprovalRow } from "./approval.ts";
import type { PunchRow } from "./hours.ts";

/**
 * A person's own weeks on the Time Clock page (DECISIONS #157 follow-up).
 * The office approves each week on Timesheets and its hours lock, but the
 * person whose week it is couldn't see that: they had to ask. The Time
 * Clock now lists this week and the last few, each approved (by whom,
 * when, the hours as approved), reopened (and why), or not approved yet.
 */

const ZONE = "America/Los_Angeles";
const ME = "me";
// Wednesday, Oct 7 2026, mid-morning in Los Angeles.
const NOW = new Date("2026-10-07T17:00:00Z");
const TODAY = "2026-10-07";

const punch = (clockIn: string, clockOut: string | null, id = clockIn): PunchRow => ({
  id,
  profile_id: ME,
  clock_in: clockIn,
  clock_out: clockOut,
  end_reason: clockOut ? "clock_out" : null,
});

const approval = (over: Partial<WeekApprovalRow> & { week_start: string }): WeekApprovalRow => ({
  approved_by: "dana",
  approved_at: "2026-10-06T16:00:00Z",
  total_minutes: 0,
  overtime_minutes: 0,
  reopened_by: null,
  reopened_at: null,
  reopen_reason: null,
  ...over,
});

const base = { profileId: ME, today: TODAY, zone: ZONE, now: NOW, past: 4, overtimeWeeklyHours: 40 };

test("this week and the last four, newest first, each Monday to Sunday", () => {
  const weeks = myRecentWeeks({ ...base, punches: [], approvals: [] });
  assert.deepEqual(
    weeks.map((w) => [w.days[0], w.days[6]]),
    [
      ["2026-10-05", "2026-10-11"],
      ["2026-09-28", "2026-10-04"],
      ["2026-09-21", "2026-09-27"],
      ["2026-09-14", "2026-09-20"],
      ["2026-09-07", "2026-09-13"],
    ]
  );
  assert.equal(weeks[0].status.kind, "this-week");
  assert.equal(weeks[1].status.kind, "no-hours");
});

test("an approved week shows who approved it, when, and the hours as approved", () => {
  const weeks = myRecentWeeks({
    ...base,
    punches: [punch("2026-09-29T15:00:00Z", "2026-09-30T00:00:00Z")],
    approvals: [approval({ week_start: "2026-09-28", total_minutes: 2490, overtime_minutes: 90 })],
  });
  const last = weeks[1];
  assert.deepEqual(last.status, { kind: "approved", by: "dana", at: "2026-10-06T16:00:00Z" });
  assert.equal(last.totalMinutes, 2490);
  assert.equal(last.overtimeMinutes, 90);
});

test("a finished week with hours and no approval is waiting; this week is still going", () => {
  const weeks = myRecentWeeks({
    ...base,
    punches: [
      punch("2026-09-22T15:00:00Z", "2026-09-22T23:30:00Z"),
      punch("2026-10-06T15:00:00Z", "2026-10-06T19:00:00Z"),
      punch("2026-10-07T15:00:00Z", null),
    ],
    approvals: [],
  });
  assert.equal(weeks[0].status.kind, "this-week");
  assert.equal(weeks[0].totalMinutes, 240 + 120);
  assert.equal(weeks[2].status.kind, "waiting");
  assert.equal(weeks[2].totalMinutes, 510);
});

test("a reopened week says who reopened it and why, until it's approved again", () => {
  const reopened = approval({
    week_start: "2026-09-21",
    total_minutes: 2400,
    reopened_by: "dana",
    reopened_at: "2026-10-01T18:00:00Z",
    reopen_reason: "Missed Friday's shift",
  });
  const punches = [punch("2026-09-22T15:00:00Z", "2026-09-22T23:30:00Z")];
  let weeks = myRecentWeeks({ ...base, punches, approvals: [reopened] });
  assert.deepEqual(weeks[2].status, {
    kind: "reopened",
    by: "dana",
    at: "2026-10-01T18:00:00Z",
    reason: "Missed Friday's shift",
  });
  // The hours as they are now, not the reopened approval's.
  assert.equal(weeks[2].totalMinutes, 510);

  const again = approval({ week_start: "2026-09-21", approved_at: "2026-10-02T16:00:00Z", total_minutes: 2910 });
  weeks = myRecentWeeks({ ...base, punches, approvals: [reopened, again] });
  assert.deepEqual(weeks[2].status, { kind: "approved", by: "dana", at: "2026-10-02T16:00:00Z" });
  assert.equal(weeks[2].totalMinutes, 2910);
});

test("the words on each line", () => {
  const nameOf = (id: string | null) => (id === "dana" ? "Dana Office" : "the office");
  const dateOf = () => "Oct 6";
  const weeks = myRecentWeeks({
    ...base,
    punches: [punch("2026-09-22T15:00:00Z", "2026-09-22T23:30:00Z")],
    approvals: [
      approval({ week_start: "2026-09-28", total_minutes: 2490, overtime_minutes: 90 }),
      approval({ week_start: "2026-09-14", approved_by: null, total_minutes: 600 }),
    ],
  });
  const lines = weeks.map((w) => myWeekLine(w, nameOf, dateOf));
  assert.deepEqual(lines[0], {
    label: "This week",
    hours: null,
    note: "Can be approved once Sunday has passed.",
    tone: "soft",
  });
  assert.deepEqual(lines[1], {
    label: "Sep 28 – Oct 4",
    hours: "41 h 30 m · 1 h 30 m overtime",
    note: "Approved by Dana Office · Oct 6. These hours are locked for payroll.",
    tone: "good",
  });
  assert.equal(lines[2].note, "Not approved yet.");
  assert.equal(lines[2].tone, "soft");
  assert.equal(lines[2].hours, "8 h 30 m");
  assert.equal(lines[3].note, "Approved by the office · Oct 6. These hours are locked for payroll.");
  assert.deepEqual(lines[4], { label: "Sep 7 – Sep 13", hours: null, note: "No hours.", tone: "soft" });

  const reopened = myRecentWeeks({
    ...base,
    punches: [],
    approvals: [
      approval({ week_start: "2026-09-21", reopened_by: "dana", reopened_at: "2026-10-01T18:00:00Z", reopen_reason: "Missed Friday's shift" }),
    ],
  })[2];
  assert.deepEqual(myWeekLine(reopened, nameOf, dateOf), {
    label: "Sep 21 – Sep 27",
    hours: null,
    note: "Reopened by Dana Office · Oct 6: “Missed Friday's shift”. Waiting to be approved again.",
    tone: "warn",
  });
});

test("the list shows only once the office approves weeks for this person", () => {
  const none = myRecentWeeks({ ...base, punches: [punch("2026-09-22T15:00:00Z", "2026-09-22T23:30:00Z")], approvals: [] });
  assert.equal(showMyWeeks(none), false);
  const some = myRecentWeeks({ ...base, punches: [], approvals: [approval({ week_start: "2026-09-14" })] });
  assert.equal(showMyWeeks(some), true);
});

test("the Time Clock page reads only this person's approvals, and shows the list", () => {
  const page = readFileSync(new URL("../../app/(app)/time-clock/page.tsx", import.meta.url), "utf8");
  assert.match(page, /myWeeks\(supabase, profile\.id, profile\.company_id/);
  assert.match(page, /\.from\("timesheet_approvals"\)[\s\S]{0,300}\.eq\("profile_id", profileId\)/);
  assert.match(page, /myRecentWeeks\(/);
  const view = readFileSync(new URL("../../app/(app)/time-clock/time-clock-view.tsx", import.meta.url), "utf8");
  assert.match(view, /Your weeks/);
});

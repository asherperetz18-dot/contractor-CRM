import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  REMINDER_STATUSES,
  inReminderHours,
  nextReminder,
  reminderMessage,
  reminderKindLabel,
  type ReminderInput,
} from "./bill-reminder.ts";

/**
 * Step 4 of full invoicing (DECISIONS #152): a company can switch on
 * automatic payment reminders. A bill still owed gets one 3 days before
 * it's due, one on the day, and once a week after, up to three times --
 * never twice for the same step, never right on top of another send, and
 * never once it's paid.
 */

const at = (today: string, extra: Partial<Parameters<typeof nextReminder>[0]> = {}) =>
  nextReminder({ dueDate: "2026-10-21", today, sentKinds: [], lastTouchDay: "2026-10-01", ...extra });

test("the schedule: 3 days before, on the day, then weekly up to three times", () => {
  assert.equal(at("2026-10-17"), null); // 4 days before: nothing yet
  assert.equal(at("2026-10-18"), "before");
  assert.equal(at("2026-10-21", { sentKinds: ["before"], lastTouchDay: "2026-10-18" }), "due");
  assert.equal(at("2026-10-22", { sentKinds: ["before", "due"], lastTouchDay: "2026-10-21" }), null);
  assert.equal(at("2026-10-28", { sentKinds: ["before", "due"], lastTouchDay: "2026-10-21" }), "late1");
  assert.equal(at("2026-11-04", { sentKinds: ["before", "due", "late1"], lastTouchDay: "2026-10-28" }), "late2");
  assert.equal(at("2026-11-11", { sentKinds: ["before", "due", "late1", "late2"], lastTouchDay: "2026-11-04" }), "late3");
  // Three late reminders, then it's the office's to chase.
  assert.equal(at("2026-11-18", { sentKinds: ["before", "due", "late1", "late2", "late3"], lastTouchDay: "2026-11-11" }), null);
});

test("each step goes once", () => {
  assert.equal(at("2026-10-19", { sentKinds: ["before"], lastTouchDay: "2026-10-18" }), null);
  assert.equal(at("2026-10-20", { sentKinds: ["before"], lastTouchDay: "2026-10-18" }), null);
});

test("never right on top of another send", () => {
  // Billed the day before: the "3 days before" waits until the bill is 2 days old.
  assert.equal(at("2026-10-18", { lastTouchDay: "2026-10-18" }), null);
  assert.equal(at("2026-10-19", { lastTouchDay: "2026-10-18" }), null);
  assert.equal(at("2026-10-20", { lastTouchDay: "2026-10-18" }), "before");
  // Due on receipt: the bill itself is the due-day message.
  assert.equal(at("2026-10-21", { lastTouchDay: "2026-10-21" }), null);
  // Sent again by hand 2 days into the late week: the weekly one waits a week from that.
  assert.equal(at("2026-10-28", { sentKinds: ["due"], lastTouchDay: "2026-10-23" }), null);
  assert.equal(at("2026-10-29", { sentKinds: ["due"], lastTouchDay: "2026-10-23" }), "late1");
});

test("a missed day catches up, but never with reminders a day apart", () => {
  // Switched on 20 days after the due date: one now, the next a week on.
  assert.equal(at("2026-11-10"), "late1");
  assert.equal(at("2026-11-11", { sentKinds: ["late1"], lastTouchDay: "2026-11-10" }), null);
  assert.equal(at("2026-11-17", { sentKinds: ["late1"], lastTouchDay: "2026-11-10" }), "late2");
  // A missed due day is not sent late as "due today".
  assert.equal(at("2026-10-22", { sentKinds: ["before"], lastTouchDay: "2026-10-18" }), null);
});

test("no due date, no reminder", () => {
  assert.equal(nextReminder({ dueDate: null, today: "2026-10-21", sentKinds: [], lastTouchDay: null }), null);
});

test("only bills still owed and not already on their way are reminded", () => {
  assert.deepEqual([...REMINDER_STATUSES].sort(), ["billed", "overdue", "partial", "sent", "viewed"]);
});

test("reminders go out in office hours, on the company's clock", () => {
  // 15:00 UTC is 8am in Los Angeles (PDT) -- too early -- and 11am in New York.
  assert.equal(inReminderHours(new Date("2026-10-21T15:00:00Z"), "America/Los_Angeles"), false);
  assert.equal(inReminderHours(new Date("2026-10-21T15:00:00Z"), "America/New_York"), true);
  assert.equal(inReminderHours(new Date("2026-10-21T16:00:00Z"), "America/Los_Angeles"), true);
  // 6pm local and later: tomorrow.
  assert.equal(inReminderHours(new Date("2026-10-22T01:00:00Z"), "America/Los_Angeles"), false);
});

const base: ReminderInput = {
  kind: "before",
  companyName: "Summit Builders Co",
  customerName: "Jordan Ellis",
  isInvoice: true,
  docNumber: "INV-1004",
  title: "Site cleanup & permit",
  stageName: null,
  owedCents: 109_360,
  dueDate: "2026-10-21",
  today: "2026-10-18",
  link: "https://crm.example.com/portal/verify?token=abc&next=%2Fportal%2Festimates%2F1",
};

test("before it's due: a friendly heads-up with the link", () => {
  const m = reminderMessage(base);
  assert.equal(m.subject, "Reminder: invoice INV-1004, $1,093.60 due Oct 21, 2026");
  assert.match(m.text, /^Hi Jordan Ellis,/);
  assert.match(m.text, /A friendly reminder: invoice INV-1004 \(Site cleanup & permit\) is due on Oct 21, 2026\./);
  assert.match(m.text, /Amount due: \$1,093\.60/);
  assert.ok(m.text.includes(base.link));
  assert.match(m.text, /If you've already paid, thank you, and please ignore this\./);
  assert.match(m.html, /Site cleanup &amp; permit/);
  assert.match(m.html, />View and pay</);
  assert.equal(m.sms, `Summit Builders Co: reminder - invoice INV-1004 is due Oct 21 - $1,093.60.\nPay here: ${base.link}`);
});

test("on the day, and once it's late", () => {
  const due = reminderMessage({ ...base, kind: "due", today: "2026-10-21" });
  assert.equal(due.subject, "Reminder: invoice INV-1004, $1,093.60 due today");
  assert.match(due.text, /invoice INV-1004 \(Site cleanup & permit\) is due today\./);
  assert.match(due.sms, /is due today - \$1,093\.60\./);

  const late = reminderMessage({
    ...base,
    kind: "late1",
    today: "2026-10-28",
    isInvoice: false,
    docNumber: "EST-1047",
    title: "Kitchen remodel",
    stageName: "Rough-in complete",
    owedCents: 100_000,
  });
  assert.equal(late.subject, "Past due: Rough-in complete on EST-1047, $1,000.00");
  assert.match(late.text, /Rough-in complete on EST-1047 \(Kitchen remodel\) was due on Oct 21, 2026, 7 days ago\./);
  assert.match(late.text, /Amount due: \$1,000\.00/);
  assert.match(late.sms, /Summit Builders Co: reminder - Rough-in complete on EST-1047 was due Oct 21 - \$1,000\.00\./);
  // Plain hyphens, no emoji: either would cut each text's length from 160 to 70.
  assert.match(late.sms, /^[\x20-\x7e\n]*$/);
});

test("how each step reads on the office's screens", () => {
  assert.equal(reminderKindLabel("before"), "3 days before");
  assert.equal(reminderKindLabel("due"), "due day");
  assert.equal(reminderKindLabel("late1"), "1 week late");
  assert.equal(reminderKindLabel("late3"), "3 weeks late");
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the job: each company on its own, only where switched on, each step claimed once", () => {
  const route = source("../app/api/cron/bill-reminders/route.ts");
  assert.match(route, /runForEachCompany\(/);
  assert.match(route, /^export const maxDuration = 300;$/m);
  assert.match(route, /\.eq\("bill_reminders_enabled", true\)/);
  const run = source("./bill-reminders-run.ts");
  // Claimed before it goes (unique per bill and step), released if nothing went.
  assert.match(run, /from\("bill_reminders"\)\s*\.insert\(/);
  assert.match(run, /from\("bill_reminders"\)\.delete\(\)/);
  // Paused bills and customers billed outside the CRM are left alone.
  assert.match(run, /\.eq\("reminders_paused", false\)/);
  assert.match(run, /portal_payments_disabled/);
  assert.match(run, /inReminderHours\(/);
  assert.match(run, /from\("sms_messages"\)\.insert\(/);
  // The migration schedules it and locks the table like every company table.
  const sql = source("../../supabase/migrations/0208_bill_reminders.sql");
  assert.match(sql, /unique \(estimate_payment_id, kind\)/);
  assert.match(sql, /select public\.apply_billing_lock_policies\(\);/);
  assert.match(sql, /crm_jobs\.run\('\/api\/cron\/bill-reminders'\)/);
  assert.match(sql, /bill_reminders_enabled boolean not null default false/);
});

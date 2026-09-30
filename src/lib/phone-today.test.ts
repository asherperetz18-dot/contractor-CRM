import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attentionItems,
  dayLabel,
  deltaView,
  longDay,
  quickActions,
  upcomingCards,
} from "./phone-today.ts";

const ATT = {
  overdueTasks: 93,
  apptsToday: 1,
  awaitingCount: 35,
  awaitingCents: 191482800,
  overdueOwedCents: 10055800,
  overdueOwedCount: 12,
};

test("the alerts are the dashboard's five, in its order, with its links and words", () => {
  assert.deepEqual(attentionItems(ATT, { canMoney: true, inboxCount: 17 }), [
    { key: "tasks", href: "/tasks", alarm: true, value: "93", label: "Overdue tasks" },
    { key: "overdue", href: "/payments", alarm: true, value: "$100,558", label: "Overdue payments · 12 phases" },
    { key: "awaiting", href: "/estimates", alarm: false, value: "$1,914,828", label: "Awaiting signature · 35 contracts" },
    { key: "replies", href: "/reply-inbox", alarm: false, value: "17", label: "Replies waiting" },
    { key: "today", href: "/schedule", alarm: false, value: "1", label: "Appointments today" },
  ]);
});

test("money stays hidden from people who can't see it, and an empty inbox isn't an alert", () => {
  const keys = attentionItems(ATT, { canMoney: false, inboxCount: 0 }).map((a) => a.key);
  assert.deepEqual(keys, ["tasks", "awaiting", "today"]);
});

test("one of a thing is singular", () => {
  const one = { ...ATT, overdueOwedCount: 1, awaitingCount: 1, overdueTasks: 0 };
  const items = attentionItems(one, { canMoney: true, inboxCount: 0 });
  assert.equal(items.find((a) => a.key === "overdue")?.label, "Overdue payments · 1 phase");
  assert.equal(items.find((a) => a.key === "awaiting")?.label, "Awaiting signature · 1 contract");
  assert.equal(items.find((a) => a.key === "tasks")?.alarm, false);
});

test("month-over-month change reads the way the dashboard's does", () => {
  assert.deepEqual(deltaView(3276, 2559), { text: "▲ 28%", dir: "up" });
  assert.deepEqual(deltaView(45, 65), { text: "▼ 31%", dir: "down" });
  assert.deepEqual(deltaView(10, 10), { text: "±0%", dir: "flat" });
  assert.deepEqual(deltaView(4, 0), { text: "new", dir: "flat" });
  assert.deepEqual(deltaView(0, 0), { text: "—", dir: "flat" });
});

test("appointment days read as Today, Tomorrow, or a short date", () => {
  assert.equal(dayLabel("2026-09-30", "2026-09-30"), "Today");
  assert.equal(dayLabel("2026-10-01", "2026-09-30"), "Tomorrow");
  assert.equal(dayLabel("2026-10-03", "2026-09-30"), "Sat, Oct 3");
  // Month and year ends roll over like the calendar does.
  assert.equal(dayLabel("2027-01-01", "2026-12-31"), "Tomorrow");
});

test("the header says the company's day in words", () => {
  assert.equal(longDay("2026-09-30"), "Wednesday, September 30");
});

test("Next up names the customer and knows where to drive, three at most", () => {
  const ev = (id: string, lead: string | null, extra = {}) => ({
    id,
    title: `Appt ${id}`,
    date: "2026-09-30",
    time: "10:30:00",
    end_time: null,
    lead_id: lead,
    ...extra,
  });
  const leads = [
    { id: "L1", contact_type: "Individual", first_name: "Maria", last_name: "Delgado", company_name: null, address: "1482 Oak Hollow Dr" },
    { id: "L2", contact_type: "Company", first_name: "Josh", last_name: "Lee", company_name: "Coast to Coast", address: "  " },
  ];
  const cards = upcomingCards([ev("a", "L1"), ev("b", "L2"), ev("c", null), ev("d", "L1")], leads, "2026-09-30");
  assert.deepEqual(
    cards.map((c) => [c.id, c.day, c.who, c.address, c.href]),
    [
      ["a", "Today", "Maria Delgado", "1482 Oak Hollow Dr", "/contacts?openLead=L1&from=/"],
      ["b", "Today", "Coast to Coast", null, "/contacts?openLead=L2&from=/"],
      ["c", "Today", "", null, "/schedule"],
    ]
  );
  assert.equal(cards[0].title, "Appt a");
  assert.equal(cards[0].time, "10:30:00");
});

test("quick buttons only offer pages the person can open", () => {
  const all = ["/pipeline", "/schedule", "/estimates", "/time-clock"];
  assert.deepEqual(quickActions(all).map((a) => a.label), ["New lead", "Appointment", "Estimate", "Clock in"]);
  assert.deepEqual(quickActions(["/schedule", "/time-clock"]).map((a) => a.href), ["/schedule?new=1", "/time-clock"]);
});

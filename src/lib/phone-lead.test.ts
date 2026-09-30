import { test } from "node:test";
import assert from "node:assert/strict";
import { leadSubline, nextAppointment } from "./phone-lead.ts";

const appt = (id: string, date: string, time: string | null, status = "New") => ({
  id,
  date,
  time,
  end_time: null,
  event_type: "Estimate",
  status,
});

test("the next appointment is the soonest one from today on", () => {
  const rows = [
    appt("past", "2026-09-28", "09:00:00"),
    appt("later", "2026-10-04", "09:00:00"),
    appt("soon-late", "2026-10-01", "15:00:00"),
    appt("soon-early", "2026-10-01", "08:30:00"),
  ];
  assert.equal(nextAppointment(rows, "2026-09-30")?.id, "soon-early");
});

test("today's appointment counts, and one with no time sorts after the timed ones that day", () => {
  const rows = [appt("untimed", "2026-09-30", null), appt("timed", "2026-09-30", "16:00:00")];
  assert.equal(nextAppointment(rows, "2026-09-30")?.id, "timed");
});

test("a cancelled visit is not the next appointment; none left means none", () => {
  const rows = [appt("x", "2026-10-01", "09:00:00", "Cancelled"), appt("y", "2026-10-02", "09:00:00")];
  assert.equal(nextAppointment(rows, "2026-09-30")?.id, "y");
  assert.equal(nextAppointment([appt("old", "2026-01-01", null)], "2026-09-30"), null);
});

test("the line under the name says where the lead came from and whose it is", () => {
  assert.equal(leadSubline("Google Ads", "Asher Peretz"), "Source: Google Ads · Rep: Asher Peretz");
  assert.equal(leadSubline("", "Asher Peretz"), "Rep: Asher Peretz");
  assert.equal(leadSubline("Angi", null), "Source: Angi · Unassigned");
});

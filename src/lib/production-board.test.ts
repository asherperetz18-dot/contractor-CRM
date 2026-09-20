import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterJobs,
  jobDateInfo,
  jobSummary,
  weekBounds,
  type BoardJob,
} from "./production-board.ts";

/**
 * The board's numbers and date words are what the owner reads at a
 * glance; each rule is pinned so a refactor can't quietly change what
 * "Starting this week" or "4d over" means.
 */

function job(over: Partial<BoardJob>): BoardJob {
  return {
    id: over.id ?? "j1",
    name: "Kitchen remodel",
    address: "12 Main St",
    status: "Not Started",
    start_date: null,
    end_date: null,
    assigned_to: null,
    ...over,
  };
}

// A Sunday. Its Mon–Sun week is Sep 14 – Sep 20.
const TODAY = "2026-09-20";

test("weekBounds is Monday through Sunday of today's week", () => {
  assert.deepEqual(weekBounds(TODAY), { start: "2026-09-14", end: "2026-09-20" });
  // A Monday belongs to the week it starts.
  assert.deepEqual(weekBounds("2026-09-14"), { start: "2026-09-14", end: "2026-09-20" });
  // A Sunday still belongs to the week that began the Monday before.
  assert.deepEqual(weekBounds("2026-09-13"), { start: "2026-09-07", end: "2026-09-13" });
});

test("summary counts: active, starting this week, past end, unassigned", () => {
  const jobs = [
    job({ id: "a", status: "Not Started", start_date: "2026-09-16" }), // this week, unassigned
    job({ id: "b", status: "In Progress", assigned_to: "p1", end_date: "2026-09-16" }), // past end
    job({ id: "c", status: "On Hold" }), // unassigned
    job({ id: "d", status: "Complete", end_date: "2026-09-01" }), // complete: never past-end/unassigned
    job({ id: "e", status: "In Progress", assigned_to: "p1", start_date: "2026-09-14", end_date: "2026-10-01" }), // started Monday
  ];
  const s = jobSummary(jobs, TODAY);
  assert.equal(s.active, 4);
  assert.equal(s.startingThisWeek, 2); // a and e
  assert.equal(s.pastEnd, 1); // b only — d is complete
  assert.equal(s.unassigned, 2); // a and c — d is complete
});

test("a job ending today is not past end yet", () => {
  const s = jobSummary([job({ status: "In Progress", end_date: TODAY, assigned_to: "p" })], TODAY);
  assert.equal(s.pastEnd, 0);
});

test("date words: upcoming start, plain range, days over, done", () => {
  assert.deepEqual(jobDateInfo(job({ start_date: "2026-09-23" }), TODAY), {
    text: "Starts Sep 23",
    tone: "muted",
  });
  assert.deepEqual(
    jobDateInfo(job({ status: "In Progress", start_date: "2026-09-08", end_date: "2026-10-17" }), TODAY),
    { text: "Sep 8 – Oct 17", tone: "muted" }
  );
  assert.deepEqual(
    jobDateInfo(job({ status: "In Progress", start_date: "2026-09-01", end_date: "2026-09-16" }), TODAY),
    { text: "Sep 1 – Sep 16 · 4d over", tone: "overdue" }
  );
  assert.deepEqual(
    jobDateInfo(job({ status: "Complete", start_date: "2026-08-02", end_date: "2026-09-12" }), TODAY),
    { text: "Aug 2 – Sep 12", tone: "done" }
  );
  assert.deepEqual(jobDateInfo(job({ status: "Complete" }), TODAY), { text: "Done", tone: "done" });
  assert.deepEqual(jobDateInfo(job({}), TODAY), { text: "", tone: "muted" });
});

test("a past end date on a completed job never reads as overdue", () => {
  const info = jobDateInfo(job({ status: "Complete", end_date: "2026-09-01" }), TODAY);
  assert.equal(info.tone, "done");
  assert.ok(!info.text.includes("over"));
});

test("an ongoing job with only a start date shows an open range", () => {
  assert.deepEqual(
    jobDateInfo(job({ status: "In Progress", start_date: "2026-09-08" }), TODAY),
    { text: "Sep 8 →", tone: "muted" }
  );
});

test("a date in another year says the year", () => {
  assert.equal(jobDateInfo(job({ start_date: "2027-01-05" }), TODAY).text, "Starts Jan 5, 2027");
});

test("search matches name and address, case-insensitive", () => {
  const jobs = [
    job({ id: "a", name: "Rivera Kitchen", address: "2214 Micheltorena St" }),
    job({ id: "b", name: "Chen ADU", address: null }),
  ];
  assert.deepEqual(filterJobs(jobs, { search: "rivera", crewId: "", quick: null }, TODAY).map((j) => j.id), ["a"]);
  assert.deepEqual(filterJobs(jobs, { search: "michel", crewId: "", quick: null }, TODAY).map((j) => j.id), ["a"]);
  assert.deepEqual(filterJobs(jobs, { search: "", crewId: "", quick: null }, TODAY).map((j) => j.id), ["a", "b"]);
});

test("crew filter keeps only that person's jobs", () => {
  const jobs = [job({ id: "a", assigned_to: "p1" }), job({ id: "b", assigned_to: "p2" }), job({ id: "c" })];
  assert.deepEqual(filterJobs(jobs, { search: "", crewId: "p2", quick: null }, TODAY).map((j) => j.id), ["b"]);
});

test("quick filters mirror the summary card rules exactly", () => {
  const jobs = [
    job({ id: "a", status: "Not Started", start_date: "2026-09-16" }),
    job({ id: "b", status: "In Progress", assigned_to: "p1", end_date: "2026-09-16" }),
    job({ id: "d", status: "Complete" }),
  ];
  assert.deepEqual(filterJobs(jobs, { search: "", crewId: "", quick: "active" }, TODAY).map((j) => j.id), ["a", "b"]);
  assert.deepEqual(filterJobs(jobs, { search: "", crewId: "", quick: "startingThisWeek" }, TODAY).map((j) => j.id), ["a"]);
  assert.deepEqual(filterJobs(jobs, { search: "", crewId: "", quick: "pastEnd" }, TODAY).map((j) => j.id), ["b"]);
  assert.deepEqual(filterJobs(jobs, { search: "", crewId: "", quick: "unassigned" }, TODAY).map((j) => j.id), ["a"]);
});

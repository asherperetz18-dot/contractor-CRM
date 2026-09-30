import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boardPlacement,
  dropBlock,
  filterJobs,
  jobDateInfo,
  jobStatusForProjectHold,
  jobSummary,
  projectFactsByLead,
  projectHoldForJobStatus,
  recentlyComplete,
  weekBounds,
  type BoardJob,
  type ProjectDoc,
  type ProjectFacts,
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

// Drag-and-drop: a column is only a drop target where it is drawn. With
// columns sized to their own cards, a card dragged from deep in a long
// column had nowhere to land — the short columns ended near the top and
// the space beside the card was bare page. Every column runs the board's
// full height instead.
test("every production column stretches to the board's full height", async () => {
  const { readFile } = await import("node:fs/promises");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const rule = css.match(/\n\.prod-board\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.ok(rule, "the .prod-board rule exists");
  assert.match(rule, /align-items:\s*stretch/);
});

// ── Auto-status: the board follows the project ─────────────────────────
// The Projects page decides Complete / On Hold / Cancelled from the
// documents; the board used to keep a status of its own that nothing
// updated, so a job the customer had signed off sat in Not Started.

function doc(over: Partial<ProjectDoc>): ProjectDoc {
  return {
    id: "c1",
    lead_id: "L1",
    kind: "contract",
    status: "Signed",
    parent_estimate_id: null,
    signed_at: "2026-08-01T17:00:00Z",
    completed_on: null,
    project_on_hold: false,
    ...over,
  };
}

const facts = (over: Partial<ProjectFacts> = {}): ProjectFacts => ({
  contractId: "c1",
  cancelled: false,
  onHold: false,
  completedOn: null,
  ...over,
});

test("a signed completion certificate makes the project complete, dated by the work", () => {
  const f = projectFactsByLead([
    doc({}),
    doc({
      id: "cert",
      kind: "completion",
      parent_estimate_id: "c1",
      completed_on: "2026-09-10",
      signed_at: "2026-09-12T18:00:00Z",
    }),
  ]).get("L1");
  assert.deepEqual(f, facts({ completedOn: "2026-09-10" }));
});

test("a certificate raised but not yet signed completes nothing", () => {
  const f = projectFactsByLead([
    doc({}),
    doc({ id: "cert", kind: "completion", status: "Sent", parent_estimate_id: "c1" }),
  ]).get("L1");
  assert.equal(f?.completedOn, null);
});

test("a certificate without a completion date falls back to its signing day", () => {
  const f = projectFactsByLead([
    doc({}),
    doc({ id: "cert", kind: "completion", parent_estimate_id: "c1", signed_at: "2026-09-12T18:00:00Z" }),
  ]).get("L1");
  assert.equal(f?.completedOn, "2026-09-12");
});

test("only the certificate on the live contract counts -- not one on a superseded version", () => {
  const f = projectFactsByLead([
    doc({ id: "old", status: "Void", signed_at: "2026-07-01T00:00:00Z" }),
    doc({ id: "new", signed_at: "2026-08-01T00:00:00Z" }),
    doc({ id: "cert", kind: "completion", parent_estimate_id: "old", completed_on: "2026-07-20" }),
  ]).get("L1");
  assert.equal(f?.contractId, "new");
  assert.equal(f?.completedOn, null);
});

test("the latest signed contract is the project, and its hold flag is the project's", () => {
  const f = projectFactsByLead([
    doc({ id: "a", signed_at: "2026-07-01T00:00:00Z" }),
    doc({ id: "b", signed_at: "2026-08-15T00:00:00Z", project_on_hold: true }),
  ]).get("L1");
  assert.deepEqual(f, facts({ contractId: "b", onHold: true }));
});

test("a lead whose every contract is voided is a cancelled project", () => {
  const f = projectFactsByLead([doc({ status: "Void" })]).get("L1");
  assert.deepEqual(f, facts({ contractId: null, cancelled: true }));
});

test("change orders, invoices and unsigned drafts never make a project", () => {
  const m = projectFactsByLead([
    doc({ kind: "change_order" }),
    doc({ kind: "invoice", lead_id: "L2" }),
    doc({ status: "Draft", lead_id: "L3" }),
  ]);
  assert.equal(m.size, 0);
});

test("certificate signed: the card sits in Complete whatever its stored status", () => {
  const p = boardPlacement(job({ status: "Not Started" }), facts({ completedOn: "2026-09-10" }), TODAY);
  assert.deepEqual(p, { status: "Complete", auto: "certificate", completedOn: "2026-09-10" });
});

test("a cancelled project leaves the board", () => {
  assert.equal(boardPlacement(job({}), facts({ contractId: null, cancelled: true }), TODAY), null);
});

test("on hold on Projects puts the card in On Hold", () => {
  const p = boardPlacement(job({ status: "In Progress" }), facts({ onHold: true }), TODAY);
  assert.deepEqual(p, { status: "On Hold", auto: "hold", completedOn: null });
});

test("a job with crew moves to In Progress on its start date", () => {
  const crewed = job({ status: "Not Started", assigned_to: "u1", start_date: TODAY });
  assert.deepEqual(boardPlacement(crewed, undefined, TODAY), {
    status: "In Progress",
    auto: "started",
    completedOn: null,
  });
  // Not before the day, and never without a crew to start it.
  assert.equal(boardPlacement({ ...crewed, start_date: "2026-09-21" }, undefined, TODAY)?.status, "Not Started");
  assert.equal(boardPlacement({ ...crewed, assigned_to: null }, undefined, TODAY)?.status, "Not Started");
});

test("otherwise the card keeps the status it was dragged to", () => {
  for (const status of ["Not Started", "In Progress", "On Hold", "Complete"] as const) {
    assert.deepEqual(boardPlacement(job({ status }), facts(), TODAY), {
      status,
      auto: null,
      completedOn: null,
    });
  }
  // A hand-made job with no contract behind it too.
  assert.equal(boardPlacement(job({ status: "In Progress" }), undefined, TODAY)?.status, "In Progress");
});

test("the Complete column shows the last 30 days; an undated finish always shows", () => {
  const at = (d: string | null) => ({ status: "Complete" as const, auto: null, completedOn: d });
  // TODAY is Sep 20: Aug 21 is 30 days back, Aug 20 is 31.
  assert.equal(recentlyComplete(job({}), at("2026-09-20"), TODAY), true);
  assert.equal(recentlyComplete(job({}), at("2026-08-21"), TODAY), true);
  assert.equal(recentlyComplete(job({}), at("2026-08-20"), TODAY), false);
  // No certificate date: the job's own end date, then when it was last touched.
  assert.equal(recentlyComplete(job({ end_date: "2026-06-01" }), at(null), TODAY), false);
  assert.equal(
    recentlyComplete(job({ updated_at: "2026-09-18T10:00:00Z" }), at(null), TODAY),
    true
  );
  assert.equal(recentlyComplete(job({}), at(null), TODAY), true);
});

test("a drag the rules would undo is refused with the reason", () => {
  const done = boardPlacement(job({}), facts({ completedOn: "2026-09-10" }), TODAY)!;
  assert.match(
    dropBlock(job({}), done, "In Progress", facts({ completedOn: "2026-09-10" }), TODAY, true) ?? "",
    /completion certificate/
  );

  const started = job({ status: "In Progress", assigned_to: "u1", start_date: "2026-09-18" });
  const pStarted = boardPlacement(started, undefined, TODAY)!;
  assert.match(dropBlock(started, pStarted, "Not Started", undefined, TODAY, true) ?? "", /Sep 18/);

  const held = boardPlacement(job({}), facts({ onHold: true }), TODAY)!;
  assert.match(dropBlock(job({}), held, "In Progress", facts({ onHold: true }), TODAY, false) ?? "", /Office or Admin/);
  // Office/Admin take it off hold by dragging.
  assert.equal(dropBlock(job({}), held, "In Progress", facts({ onHold: true }), TODAY, true), null);
  // An ordinary move is allowed.
  const plain = boardPlacement(job({}), facts(), TODAY)!;
  assert.equal(dropBlock(job({}), plain, "In Progress", facts(), TODAY, false), null);
});

test("one on-hold switch: a card moved in or out of On Hold says what the project should be", () => {
  assert.equal(projectHoldForJobStatus("On Hold", false), true);
  assert.equal(projectHoldForJobStatus("In Progress", true), false);
  assert.equal(projectHoldForJobStatus("On Hold", true), null);
  assert.equal(projectHoldForJobStatus("Complete", false), null);
});

test("one on-hold switch: holding the project on Projects says where its card goes", () => {
  assert.equal(jobStatusForProjectHold(true, "In Progress"), "On Hold");
  assert.equal(jobStatusForProjectHold(true, "On Hold"), null);
  assert.equal(jobStatusForProjectHold(false, "On Hold"), "In Progress");
  // Releasing a hold never drags a card out of a column it chose itself.
  assert.equal(jobStatusForProjectHold(false, "Not Started"), null);
  assert.equal(jobStatusForProjectHold(false, "Complete"), null);
});

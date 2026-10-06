import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { eachCompany, fairOrder, runSummary, withoutLocked } from "./each-company.ts";

/**
 * Scheduled jobs run each company in its own safety net (DECISIONS #126):
 * one company whose Twilio, CallRail, Google or weather service is down
 * must not stop the reminders of every company after it.
 */

const companies = ["a", "b", "c", "d"].map((id) => ({ company_id: id }));
const id = (c: { company_id: string }) => c.company_id;

test("a company that fails is reported, and the ones after it still run", async () => {
  const ran: string[] = [];
  const reported: string[] = [];
  const out = await eachCompany(
    companies,
    id,
    async (c) => {
      ran.push(c.company_id);
      if (c.company_id === "b") throw new Error("Twilio unreachable");
      return c.company_id.toUpperCase();
    },
    { onFailure: (companyId) => reported.push(companyId) }
  );
  assert.deepEqual(ran, ["a", "b", "c", "d"]);
  assert.deepEqual(out.done.map((d) => d.value), ["A", "C", "D"]);
  assert.deepEqual(out.failed, [{ companyId: "b", error: "Twilio unreachable" }]);
  assert.deepEqual(reported, ["b"]);
  assert.deepEqual(out.deferred, []);
});

test("past the time budget, the rest wait for the next run instead of being cut off mid-way", async () => {
  let clock = 0;
  const out = await eachCompany(
    companies,
    id,
    async () => {
      clock += 100;
      return true;
    },
    { budgetMs: 250, now: () => clock }
  );
  // a starts at 0, b at 100, c at 200; d would start at 300 > 250.
  assert.deepEqual(out.done.map((d) => d.companyId), ["a", "b", "c"]);
  assert.deepEqual(out.deferred, ["d"]);
});

test("the order turns each run, so no company is always last", () => {
  assert.deepEqual(fairOrder(companies, 0).map(id), ["a", "b", "c", "d"]);
  assert.deepEqual(fairOrder(companies, 1).map(id), ["b", "c", "d", "a"]);
  assert.deepEqual(fairOrder(companies, 6).map(id), ["c", "d", "a", "b"]);
  assert.deepEqual(fairOrder([], 3), []);
});

test("something thrown that isn't an Error still reads as a message", async () => {
  const out = await eachCompany([{ company_id: "x" }], id, async () => {
    throw "boom";
  });
  assert.deepEqual(out.failed, [{ companyId: "x", error: "boom" }]);
});

test("every scheduled job that works company by company uses the safety net", () => {
  for (const route of [
    "appointment-reminders",
    "task-reminders",
    "no-show-followups",
    "rain-alerts",
    "callrail-backfill",
    "primecall-sync",
    "time-clock",
    "google-calendar-sync",
    "bill-reminders",
  ]) {
    const source = readFileSync(new URL(`../../app/api/cron/${route}/route.ts`, import.meta.url), "utf8");
    assert.match(source, /runForEachCompany\(/, route);
    assert.match(source, /^export const maxDuration = 300;$/m, `${route} needs room for every company`);
    // No bare loop over companies left behind it.
    assert.doesNotMatch(
      source,
      /for \(const (company of companyRows|row of \(data|conn of connections|\{ id: companyId \} of)/,
      route
    );
  }
});

test("the run's summary never overwrites a job's own counts", () => {
  const summary = runSummary({ done: [], failed: [{ companyId: "c1", error: "boom" }], deferred: ["c2", "c3"] });
  assert.deepEqual(summary, { failures: [{ companyId: "c1", error: "boom" }], deferred: 2, paused: 0 });
  // Google Calendar sync reports how many calendars failed as `failed`;
  // the summary spread after it must not replace that number.
  const source = readFileSync(new URL("../../app/api/cron/google-calendar-sync/route.ts", import.meta.url), "utf8");
  assert.match(source, /failed: 0/);
  assert.ok(!("failed" in summary));
});

test("a locked company is paused: its reminders, alerts and syncs don't run", () => {
  const items = [{ id: "conn-1", company_id: "a" }, { id: "conn-2", company_id: "b" }, { id: "conn-3", company_id: "a" }];
  const { kept, paused } = withoutLocked(items, (c) => c.company_id, new Set(["a"]));
  assert.deepEqual(kept.map((c) => c.id), ["conn-2"]);
  assert.deepEqual(paused, ["a", "a"]);
  assert.equal(runSummary({ done: [], failed: [], deferred: [], paused }).paused, 2);
  assert.deepEqual(withoutLocked(items, (c) => c.company_id, new Set()).kept.length, 3);
});

test("every scheduled job runs through the runner that pauses locked companies", () => {
  const runner = readFileSync(new URL("./run-companies.ts", import.meta.url), "utf8");
  assert.match(runner, /withoutLocked\(items, opts\.companyOf \?\? idOf, await lockedCompanyIds\(\)\)/);
  // The calendar job's items are connections, so it names their company.
  const gcal = readFileSync(new URL("../../app/api/cron/google-calendar-sync/route.ts", import.meta.url), "utf8");
  assert.match(gcal, /companyOf: \(c\) => c\.company_id/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SCHEDULE_MAX,
  SCHEDULE_PAGE,
  SCHEDULE_RANGES,
  addDays,
  listWindow,
  newestFirst,
  parseScheduleQuery,
  scheduleQueryString,
  serverWindow,
  type ScheduleQuery,
} from "./schedule-window.ts";

/**
 * The Schedule used to load every appointment the company ever booked,
 * and every task and note in the company, then filter by date in the
 * browser (DECISIONS #143). The date range and rep now ride in the
 * address and the server loads only that window, a page at a time for
 * history. These pin the rules that moved.
 */

const REP = "11111111-1111-4111-8111-111111111111";

test("the address is read strictly: anything unexpected falls back to the default", () => {
  assert.deepEqual(parseScheduleQuery({}), { range: "upcoming", from: null, to: null, rep: null, limit: SCHEDULE_PAGE });
  assert.equal(parseScheduleQuery({ range: "everything" }).range, "upcoming");
  // Custom dates only for a custom range, and only real dates.
  assert.deepEqual(parseScheduleQuery({ range: "custom", from: "2026-01-01", to: "2026-03-31" }).from, "2026-01-01");
  assert.equal(parseScheduleQuery({ range: "past", from: "2026-01-01" }).from, null);
  assert.equal(parseScheduleQuery({ range: "custom", from: "2026-1-1" }).from, null);
  // The rep goes into a database filter, so only an id is let through.
  assert.equal(parseScheduleQuery({ rep: REP }).rep, REP);
  assert.equal(parseScheduleQuery({ rep: `${REP},lead_id.eq.x` }).rep, null);
  assert.equal(parseScheduleQuery({ rep: "All" }).rep, null);
  // How many is between one page and the cap.
  assert.equal(parseScheduleQuery({ limit: "5" }).limit, SCHEDULE_PAGE);
  assert.equal(parseScheduleQuery({ limit: "400" }).limit, 400);
  assert.equal(parseScheduleQuery({ limit: "99999" }).limit, SCHEDULE_MAX);
  // One more than the cap is read to know whether more exist, under PostgREST's 1000-row ceiling.
  assert.ok(SCHEDULE_MAX + 1 <= 1000);
});

test("the address carries only what differs from the default, and reads back the same", () => {
  assert.equal(scheduleQueryString(parseScheduleQuery({})), "");
  const queries: ScheduleQuery[] = [
    { range: "past", from: null, to: null, rep: null, limit: 400 },
    { range: "custom", from: "2026-01-01", to: "2026-03-31", rep: REP, limit: SCHEDULE_PAGE },
    { range: "upcoming", from: null, to: null, rep: REP, limit: SCHEDULE_PAGE },
  ];
  for (const q of queries) {
    const qs = scheduleQueryString(q);
    assert.deepEqual(parseScheduleQuery(Object.fromEntries(new URLSearchParams(qs.slice(1)))), q, qs);
  }
  assert.equal(scheduleQueryString(queries[0]), "?range=past&limit=400");
});

test("history reads newest first; everything else in date order", () => {
  for (const r of SCHEDULE_RANGES) assert.equal(newestFirst(r, "2026-01-01"), r === "past" || r === "all", r);
  // A custom range with no start yet is open at the old end, like Past and
  // All: it reads newest first, never from the oldest appointment there is.
  assert.equal(newestFirst("custom", null), true);
  assert.equal(newestFirst("custom", "2026-01-01"), false);
});

const inside = (inner: { from: string | null; to: string | null }, outer: { lo: string | null; hi: string | null }) =>
  (outer.lo === null || (inner.from !== null && inner.from >= outer.lo)) &&
  (outer.hi === null || (inner.to !== null && inner.to <= outer.hi));

test("whatever 'today' is where the person is, the server's window holds everything the list shows", () => {
  // The server knows only the UTC date; a browser's own date can be a day
  // either side of it. Month and year ends are where that bites.
  for (const utc of ["2026-10-06", "2026-10-31", "2026-11-01", "2026-12-31", "2027-01-01", "2028-02-29"]) {
    for (const offset of [-1, 0, 1]) {
      const local = addDays(utc, offset);
      for (const range of SCHEDULE_RANGES) {
        const q = parseScheduleQuery({ range, from: "2026-01-01", to: "2026-03-31" });
        const list = listWindow(range, local, q.from ?? "", q.to ?? "");
        assert.ok(inside(list, serverWindow(q, utc)), `${range} with UTC ${utc}, local ${local}`);
      }
    }
  }
});

test("the list's own windows are the ones it always had", () => {
  assert.deepEqual(listWindow("upcoming", "2026-10-06", "", ""), { from: "2026-10-06", to: null });
  assert.deepEqual(listWindow("today", "2026-10-06", "", ""), { from: "2026-10-06", to: "2026-10-06" });
  assert.deepEqual(listWindow("tomorrow", "2026-10-31", "", ""), { from: "2026-11-01", to: "2026-11-01" });
  assert.deepEqual(listWindow("7d", "2026-10-06", "", ""), { from: "2026-10-06", to: "2026-10-13" });
  assert.deepEqual(listWindow("month", "2028-02-10", "", ""), { from: "2028-02-01", to: "2028-02-29" });
  assert.deepEqual(listWindow("past", "2027-01-01", "", ""), { from: null, to: "2026-12-31" });
  assert.deepEqual(listWindow("all", "2026-10-06", "", ""), { from: null, to: null });
  assert.deepEqual(listWindow("custom", "2026-10-06", "2026-01-01", ""), { from: "2026-01-01", to: null });
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the page reads one window of appointments, a page at a time, and only what stands behind them", () => {
  const page = source("../app/(app)/schedule/page.tsx");
  assert.match(page, /const query = parseScheduleQuery\(await searchParams\);/);
  assert.match(page, /serverWindow\(query, /);
  assert.match(page, /\.range\(0, query\.limit\)/);
  assert.match(page, /const ascending = !newestFirst\(query\.range, query\.from\);/);
  assert.doesNotMatch(page, /events!inner|from\("lead_notes"\)|from\("lead_tasks"\)/);
  assert.match(page, /loadAppointmentContext\(supabase, companyId, loaded\)/);
  // The service-role lookups cover only the dates the page loaded.
  assert.match(page, /getAppointmentHolders\(span\)/);
  assert.match(page, /getLeadsBehindAppointments\(span\)/);
  // The rep filter is built only from the id the parser let through.
  assert.match(page, /if \(query\.rep\) events = events\.or\(`assigned_to\.eq\.\$\{query\.rep\},second_assigned_to\.eq\.\$\{query\.rep\}`\)/);
});

test("changing the range loads it in place, and the list keeps its own exact filter", () => {
  const list = source("../app/(app)/schedule/schedule-list.tsx");
  assert.match(list, /listWindow\(range, today, customFrom, customTo\)/);
  assert.match(list, /startWindow\(\(\) => router\.replace\(`\/schedule\$\{wantedQs\}`, \{ scroll: false \}\)\)/);
  assert.match(list, /Show more/);
  assert.match(list, /newestFirst\(range, customFrom \|\| null\)/);
});

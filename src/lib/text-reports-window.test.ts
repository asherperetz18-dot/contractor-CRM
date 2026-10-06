import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveWindow } from "./data/date-range.ts";
import {
  TEXT_REPORT_COLUMNS,
  TEXT_REPORT_PRESETS,
  TEXT_REPORT_ROWS,
  parseTextReportQuery,
  textReportQueryString,
  textReportRange,
  textReportServerWindow,
  type TextReportQuery,
} from "./text-reports-window.ts";

/**
 * Text Reports read every text the company ever sent or received, every
 * column of each, and drew every one as a table row (DECISIONS #146). The
 * period now rides in the address and the server loads only that window,
 * only the columns the report uses; the table draws 200 rows at a time.
 * The numbers still count every text in the period.
 */

test("the address is read strictly: anything unexpected falls back to the last 30 days", () => {
  assert.deepEqual(parseTextReportQuery({}), { preset: "30", from: null, to: null });
  assert.equal(parseTextReportQuery({ range: "7" }).preset, "7");
  assert.equal(parseTextReportQuery({ range: "all" }).preset, "all");
  assert.equal(parseTextReportQuery({ range: "365" }).preset, "30");
  assert.equal(parseTextReportQuery({ range: ["7", "90"] }).preset, "30");
  // Dates go into a database filter, so only real calendar days get through.
  assert.equal(parseTextReportQuery({ from: "2026-01-01" }).from, "2026-01-01");
  assert.equal(parseTextReportQuery({ from: "2026-1-1" }).from, null);
  assert.equal(parseTextReportQuery({ from: "2026-02-31" }).from, null);
  assert.equal(parseTextReportQuery({ to: "2026-03-31,id.gt.0" }).to, null);
  assert.equal(parseTextReportQuery({ to: "0002-01-15" }).to, null);
});

test("the address carries only what differs from the default, and reads back the same", () => {
  assert.equal(textReportQueryString(parseTextReportQuery({})), "");
  const queries: TextReportQuery[] = [
    { preset: "90", from: null, to: null },
    { preset: "all", from: null, to: null },
    // A custom range keeps the preset it came from, for Clear to return to.
    { preset: "7", from: "2026-01-01", to: "2026-03-31" },
    { preset: "30", from: "2026-09-01", to: null },
  ];
  for (const q of queries) {
    const qs = textReportQueryString(q);
    assert.deepEqual(parseTextReportQuery(Object.fromEntries(new URLSearchParams(qs.slice(1)))), q, qs);
  }
  assert.equal(textReportQueryString(queries[0]), "?range=90");
  assert.equal(textReportQueryString(queries[3]), "?from=2026-09-01");
});

test("the filter's state and the address are the same thing", () => {
  assert.deepEqual(textReportRange({ preset: "7", from: "2026-01-01", to: null }), { preset: "7", from: "2026-01-01", to: "" });
  for (const p of TEXT_REPORT_PRESETS) {
    const q = parseTextReportQuery({ range: p.key });
    assert.deepEqual(parseTextReportQuery({ range: textReportRange(q).preset }), q, p.key);
  }
});

test("custom dates are absolute, so they are loaded exactly; all time has no edges", () => {
  assert.deepEqual(textReportServerWindow({ preset: "30", from: "2026-01-01", to: "2026-03-31" }, "2026-10-06"), {
    lo: "2026-01-01",
    hi: "2026-03-31",
  });
  assert.deepEqual(textReportServerWindow({ preset: "30", from: null, to: "2026-03-31" }, "2026-10-06"), {
    lo: null,
    hi: "2026-03-31",
  });
  assert.deepEqual(textReportServerWindow({ preset: "all", from: null, to: null }, "2026-10-06"), { lo: null, hi: null });
});

// The browser's own "last 30 days" starts on its local date; the server
// knows only the UTC date, which can be a day either side. Date and year
// ends, and the nights clocks change, are where that bites.
const ZONES = [
  "Pacific/Pago_Pago",
  "Pacific/Honolulu",
  "America/Los_Angeles",
  "America/New_York",
  "UTC",
  "Europe/London",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Kiritimati",
];
const INSTANTS = [
  "2026-10-06T12:00:00Z",
  "2026-10-06T23:59:00Z",
  "2026-10-07T00:01:00Z",
  "2026-03-08T07:30:00Z", // US clocks go forward
  "2026-03-09T07:30:00Z",
  "2026-11-01T08:30:00Z", // US clocks go back
  "2026-03-29T23:30:00Z", // London, the night after clocks go forward
  "2026-04-05T15:30:00Z", // Sydney clocks go back
  "2026-10-04T16:30:00Z", // Sydney clocks go forward
  "2027-01-01T00:30:00Z",
  "2028-02-29T23:30:00Z",
];

test("whatever 'today' is where the person is, the server's window holds every text the report counts", () => {
  const original = process.env.TZ;
  try {
    for (const zone of ZONES) {
      process.env.TZ = zone;
      for (const at of INSTANTS) {
        const now = new Date(at);
        for (const p of TEXT_REPORT_PRESETS) {
          const q = parseTextReportQuery({ range: p.key });
          const client = resolveWindow(textReportRange(q), now);
          const server = textReportServerWindow(q, at.slice(0, 10));
          const label = `${p.key} in ${zone} at ${at}`;
          assert.equal(client.to, null, label);
          assert.equal(server.hi, null, label);
          if (client.from === null) assert.equal(server.lo, null, label);
          else assert.ok(server.lo !== null && server.lo <= client.from, `${label}: ${server.lo} > ${client.from}`);
        }
      }
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

const cols = (s: string) => s.split(",").map((c) => c.trim());

test("the report reads only the columns it uses", () => {
  const read = cols(TEXT_REPORT_COLUMNS);
  for (const need of ["id", "lead_id", "direction", "from_number", "to_number", "body", "created_at"]) {
    assert.ok(read.includes(need), need);
  }
  for (const unused of ["*", "twilio_sid", "delivery_status", "delivery_error", "company_id"]) {
    assert.ok(!read.includes(unused), unused);
  }
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the page loads one window of texts, newest first, and the contacts behind them", () => {
  const page = source("../app/(app)/text-reports/page.tsx");
  assert.match(page, /const query = parseTextReportQuery\(await searchParams\);/);
  assert.match(page, /textReportServerWindow\(query, new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\)/);
  assert.match(page, /\.select\(TEXT_REPORT_COLUMNS\)/);
  assert.doesNotMatch(page, /\.select\("\*"\)/);
  assert.match(page, /if \(bounds\.lo\) texts = texts\.gte\("created_at", bounds\.lo\);/);
  assert.match(page, /if \(bounds\.hi\) texts = texts\.lt\("created_at", addDays\(bounds\.hi, 1\)\);/);
  // A tie-breaker, so paging a window past 1,000 texts neither repeats nor skips one.
  assert.match(page, /\.order\("created_at", \{ ascending: false \}\)\s*\.order\("id", \{ ascending: false \}\)/);
  assert.match(page, /leadsLiteForMessages\(supabase, companyId, messages\)/);
});

test("changing the period loads it in place; the table draws a page at a time and the numbers count them all", () => {
  const view = source("../app/(app)/text-reports/text-reports-view.tsx");
  assert.match(view, /messages: TextReportRow\[\];/);
  assert.match(view, /startWindow\(\(\) => router\.replace\(`\/text-reports\$\{wantedQs\}`, \{ scroll: false \}\)\)/);
  // Until the new period arrives, the numbers stay on the one that's loaded.
  assert.match(view, /const shownRange = loading \? loadedRange : range;/);
  assert.match(view, /rows\.slice\(0, shownCount\)\.map\(/);
  assert.match(view, /shownCount \+ TEXT_REPORT_ROWS/);
  assert.match(view, /Show more/);
  // The cards and the busiest day are counted over every row, not the drawn ones.
  assert.match(view, /const sent = rows\.filter\(/);
  assert.match(view, /for \(const m of rows\) counts\.set\(/);
  assert.ok(TEXT_REPORT_ROWS >= 100 && TEXT_REPORT_ROWS <= 500);
});

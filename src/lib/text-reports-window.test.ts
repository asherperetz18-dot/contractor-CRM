import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TEXT_REPORT_COLUMNS,
  TEXT_REPORT_PRESETS,
  TEXT_REPORT_ROWS,
  parseTextReportQuery,
  textReportQueryString,
  textReportRange,
  textReportWindow,
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

test("the window is worked out from the company's today: the server loads it, the report counts it", () => {
  const q = (range: string) => parseTextReportQuery({ range });
  assert.deepEqual(textReportWindow(q("7"), "2026-10-08"), { from: "2026-10-01", to: null });
  assert.deepEqual(textReportWindow(q("30"), "2026-10-08"), { from: "2026-09-08", to: null });
  assert.deepEqual(textReportWindow(q("90"), "2026-03-01"), { from: "2025-12-01", to: null });
  assert.deepEqual(textReportWindow(q("all"), "2026-10-08"), { from: null, to: null });
});

test("custom dates are absolute, so they are loaded exactly; all time has no edges", () => {
  assert.deepEqual(textReportWindow({ preset: "30", from: "2026-01-01", to: "2026-03-31" }, "2026-10-06"), {
    from: "2026-01-01",
    to: "2026-03-31",
  });
  assert.deepEqual(textReportWindow({ preset: "30", from: null, to: "2026-03-31" }, "2026-10-06"), {
    from: null,
    to: "2026-03-31",
  });
  assert.deepEqual(textReportWindow({ preset: "all", from: null, to: null }, "2026-10-06"), { from: null, to: null });
});

test("the window is plain day arithmetic: the same in any time zone the page renders in", () => {
  const original = process.env.TZ;
  try {
    const seen = new Set<string>();
    for (const zone of ["Pacific/Honolulu", "America/Los_Angeles", "UTC", "Asia/Tokyo", "Pacific/Kiritimati"]) {
      process.env.TZ = zone;
      for (const p of TEXT_REPORT_PRESETS) {
        seen.add(`${p.key}:${JSON.stringify(textReportWindow(parseTextReportQuery({ range: p.key }), "2026-03-08"))}`);
      }
    }
    assert.equal(seen.size, TEXT_REPORT_PRESETS.length);
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
  // The company's today, and its midnights: a text sent after 5pm Pacific
  // used to land on the next day.
  assert.match(page, /const today = isoDateInZone\(new Date\(\), zone\);/);
  assert.match(page, /const at = windowInstants\(textReportWindow\(query, today\), zone\);/);
  assert.match(page, /\.select\(TEXT_REPORT_COLUMNS\)/);
  assert.doesNotMatch(page, /\.select\("\*"\)/);
  assert.match(page, /if \(at\.from\) texts = texts\.gte\("created_at", at\.from\);/);
  assert.match(page, /if \(at\.before\) texts = texts\.lt\("created_at", at\.before\);/);
  assert.match(page, /today=\{today\}/);
  assert.match(page, /zone=\{zone\}/);
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
  assert.match(view, /for \(const m of rows\) \{\s*const day = dayOfText\.get\(m\.id\)/);
  assert.ok(TEXT_REPORT_ROWS >= 100 && TEXT_REPORT_ROWS <= 500);
});

test("the report counts on the company's days, from the today the server hands it", () => {
  const view = source("../app/(app)/text-reports/text-reports-view.tsx");
  // One window, from the company's today -- never the browser's clock,
  // which read during render also made the server's first draw differ.
  assert.doesNotMatch(view, /Date\.now\(\)/);
  assert.match(view, /stampedWithin\(\s*textReportWindow\(/);
  // The busiest day is the company's day each text was sent on, worked
  // out once per loaded set -- not on every keystroke in the search box.
  assert.match(view, /isoDateReader\(zone\)/);
  assert.match(view, /const dayOfText = useMemo\(\(\) => \{[\s\S]*?\}, \[messages, zone\]\);/);
  assert.doesNotMatch(view, /iso\.slice\(0, 10\)/);
  assert.match(view, /max=\{today\}/);
});

test("typing one custom date fills the other with the page's own today, never the server's", () => {
  // Text Reports and Appointment Reports pass the company's today as the
  // filter's max; filling from the browser's UTC date put tomorrow in the
  // box after 5pm Pacific, past its own max.
  const filter = source("../components/date-range-filter.tsx");
  assert.match(filter, /if \(!next\[other\]\) next\[other\] = max \?\? new Date\(\)\.toISOString\(\)\.slice\(0, 10\);/);
});

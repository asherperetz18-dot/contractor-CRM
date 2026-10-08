import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * 0226 files Marketing Analytics' leads, sends, signatures and weekly
 * strip by the company's day (`p_zone`) instead of the UTC day, as 0224
 * and 0225 did for the two dashboards -- the reading marketing-rollup's
 * tests pin. Nothing else about the function changes: its body is
 * 0195's, zone swapped in. The rep report the dashboard's team panel
 * opens files the same way, and the pages open on the company's day.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = (name: string) => read(`../../../supabase/migrations/${name}`);

/** The marketing_analytics_rollup definition's body, between its $function$ quotes. */
function rollupBody(sql: string): string {
  const start = sql.indexOf("FUNCTION public.marketing_analytics_rollup(");
  assert.ok(start >= 0, "defines marketing_analytics_rollup");
  const open = sql.indexOf("$function$", start) + "$function$".length;
  return sql.slice(open, sql.indexOf("$function$", open));
}

const before = migration("0195_stage_tags.sql");
const after = migration("0226_marketing_company_clock.sql");

test("0226's Marketing Analytics is 0195's with every UTC day read on the company's clock", () => {
  const old = rollupBody(before);
  assert.match(old, /at time zone 'utc'/);
  const body = rollupBody(after);
  assert.doesNotMatch(body, /'utc'/i);
  // Both readings move: a timestamp's day (`created_at at time zone`)
  // and a day's first instant (`p_from::timestamp at time zone`).
  assert.equal(body, old.replaceAll("at time zone 'utc'", "at time zone p_zone"));
});

test("0226 takes the zone as a last, defaulted argument and drops the old signature", () => {
  assert.match(
    after,
    /drop function if exists public\.marketing_analytics_rollup\(uuid, date, date, date, date, date, date, numeric, text\[\]\);/i
  );
  assert.match(
    after,
    /FUNCTION public\.marketing_analytics_rollup\(p_company uuid, p_from date, p_to date, p_prev_from date, p_prev_to date, p_weeks_from date, p_today date, p_default_cost numeric, p_exclude_sources text\[\], p_zone text DEFAULT 'UTC'\)/
  );
});

const action = read("../actions/marketing-analytics.ts");

test("Marketing Analytics sends its company's zone, and every read cuts days at the company's midnight", () => {
  assert.match(action, /const B = marketingBoundaries\(win, zone\);/);
  assert.match(action, /p_zone: B\.zone,/);
  // A bare date against a timestamp column is UTC midnight -- the
  // fallback and both drill-down lists (a rep's leads, Won without a
  // contract), which must list what the tiles count.
  assert.doesNotMatch(action, /nextDay/);
  assert.doesNotMatch(action, /\.(gte|lt)\("created_at", (win\.|B\.)/);
});

test("the page opens on the company's last 30 days, not the server's", () => {
  const page = read("../../app/(app)/marketing-analytics/page.tsx");
  assert.match(page, /getMarketingAnalytics\(presetWindow\("30", await companyNow\(\)\)/);
});

test("the rep report files leads, sends and signatures on the company's day", () => {
  const report = read("../../app/(app)/marketing-analytics/rep-report/page.tsx");
  // A timestamp is read as its company day before the window check; a
  // bare slice of the UTC string put an evening on the next day.
  assert.doesNotMatch(report, /inRange\((l\.created_at|e\.signed_at|e\.sent_at)/);
  assert.doesNotMatch(report, /within\(l\.created_at, win\)/);
  assert.match(report, /const edges = windowInstants\(win, zone\);/);
});

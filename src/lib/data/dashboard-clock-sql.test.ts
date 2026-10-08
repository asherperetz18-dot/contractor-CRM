import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * 0224 files the dashboard's calls, signed and collected money, lead
 * dates and last touches by the company's day (`p_zone`) instead of the
 * UTC day -- the same reading buildDashboardRollup's tests pin. Nothing
 * else about the function changes: its body is 0211's, zone swapped in.
 */

const read = (name: string) =>
  readFileSync(new URL(`../../../supabase/migrations/${name}`, import.meta.url), "utf8");

/** The dashboard_rollup definition's body, between its $function$ quotes. */
function rollupBody(sql: string): string {
  const start = sql.indexOf("FUNCTION public.dashboard_rollup(");
  assert.ok(start >= 0, "defines dashboard_rollup");
  const open = sql.indexOf("$function$", start) + "$function$".length;
  return sql.slice(open, sql.indexOf("$function$", open));
}

const before = read("0211_contacts_not_leads.sql");
const after = read("0224_dashboard_company_clock.sql");

test("0224's dashboard is 0211's with every UTC day read on the company's clock", () => {
  const old = rollupBody(before);
  assert.match(old, /at time zone 'utc'/);
  const body = rollupBody(after);
  assert.doesNotMatch(body, /'utc'/i);
  assert.equal(body, old.replaceAll("at time zone 'utc'", "at time zone p_zone"));
});

test("0224 takes the zone as a last, defaulted argument and drops the old signature", () => {
  // A defaulted last argument keeps a deployment that doesn't send the
  // zone working (as UTC); dropping the old one leaves the database a
  // single dashboard_rollup to pick, so a call is never ambiguous.
  assert.match(
    after,
    /drop function if exists public\.dashboard_rollup\(uuid, date, date, date, date, date, date, date, date, date, date\);/i
  );
  assert.match(
    after,
    /FUNCTION public\.dashboard_rollup\(p_company uuid, p_from date, p_to date, p_prev_from date, p_prev_to date, p_months_from date, p_today date, p_d30 date, p_d60 date, p_d90 date, p_calls_from date, p_zone text DEFAULT 'UTC'\)/
  );
});

test("the dashboard sends its company's zone, and the fallback cuts days at the company's midnight", () => {
  const action = readFileSync(new URL("../actions/dashboard.ts", import.meta.url), "utf8");
  assert.match(action, /const B = rollupBoundaries\(win, await getCompanyZone\(\)\);/);
  assert.match(action, /p_zone: B\.zone,/);
  // A bare date against a timestamp column is UTC midnight: every
  // timestamp bound is the instant the company's day starts.
  assert.doesNotMatch(action, /\.(gte|lt)\("(created_at|signed_at)", (B\.|cohortFrom|nextDay)/);
});

test("the Payments page tells overdue by the company's day, as the dashboard card that opens it does", () => {
  // The dashboard's Overdue payments card and its aging chip open
  // /payments. Left on the server's clock, the page called a bill due
  // today overdue from 5pm Pacific while the card didn't.
  const page = readFileSync(new URL("../../app/(app)/payments/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const today = await companyToday\(\);/);
  assert.match(page, /state: phaseState\(ph, on, new Date\(`\$\{today\}T12:00:00`\)\),/);
});

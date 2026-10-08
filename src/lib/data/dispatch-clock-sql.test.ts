import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * 0225 files the Dispatch Dashboard's leads, bookings, calls, texts and
 * waiting ages by the company's day (`p_zone`) instead of the UTC day,
 * as 0224 did for the main dashboard -- the reading dispatch-rollup's
 * tests pin. Nothing else about the function changes: its body is
 * 0211's, zone swapped in.
 */

const read = (name: string) =>
  readFileSync(new URL(`../../../supabase/migrations/${name}`, import.meta.url), "utf8");

/** The dispatch_rollup definition's body, between its $function$ quotes. */
function rollupBody(sql: string): string {
  const start = sql.indexOf("FUNCTION public.dispatch_rollup(");
  assert.ok(start >= 0, "defines dispatch_rollup");
  const open = sql.indexOf("$function$", start) + "$function$".length;
  return sql.slice(open, sql.indexOf("$function$", open));
}

const before = read("0211_contacts_not_leads.sql");
const after = read("0225_dispatch_company_clock.sql");

test("0225's dispatch board is 0211's with every UTC day read on the company's clock", () => {
  const old = rollupBody(before);
  assert.match(old, /at time zone 'utc'/);
  const body = rollupBody(after);
  assert.doesNotMatch(body, /'utc'/i);
  assert.equal(body, old.replaceAll("at time zone 'utc'", "at time zone p_zone"));
});

test("0225 takes the zone as a last, defaulted argument and drops the old signature", () => {
  assert.match(
    after,
    /drop function if exists public\.dispatch_rollup\(uuid, date, date, date, date, date, timestamp with time zone, date, date, date, date\);/i
  );
  assert.match(
    after,
    /FUNCTION public\.dispatch_rollup\(p_company uuid, p_from date, p_to date, p_prev_from date, p_prev_to date, p_today date, p_now timestamp with time zone, p_week_end date, p_untouched_from date, p_results_from date, p_waiting_from date, p_zone text DEFAULT 'UTC'\)/
  );
});

const action = readFileSync(new URL("../actions/dispatch-dashboard.ts", import.meta.url), "utf8");

test("the Dispatch Dashboard sends its company's zone, and the fallback cuts days at the company's midnight", () => {
  assert.match(action, /const B = dispatchBoundaries\(win, await getCompanyZone\(\)\);/);
  assert.match(action, /p_zone: B\.zone,/);
  // A bare date against a timestamp column is UTC midnight: every
  // timestamp bound is the instant the company's day starts.
  assert.doesNotMatch(action, /nextDay/);
  assert.doesNotMatch(action, /\.(gte|lt)\("created_at", (from|B\.|nextDay)/);
});

test("the fallback reads leads only, as dispatch_rollup's counts_as_lead does", () => {
  // Until 0225 runs, the fallback serves the page; a bought-list import
  // or a sourceless contact is not a lead to race to (DECISIONS #156).
  const leadReads = action.split('.from("leads")').slice(1);
  assert.equal(leadReads.length, 2);
  for (const read of leadReads) {
    assert.match(read.slice(0, 400), /\.not\("source", "imatch", notALead\)/);
  }
});

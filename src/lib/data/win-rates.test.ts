import { test } from "node:test";
import assert from "node:assert/strict";
import { winRates } from "./win-rates.ts";

/**
 * The Win rate card on the Dashboard and the Win rate tile on Marketing
 * Analytics show the same two rates off the same funnel shape: signed
 * contracts out of the period's leads, and out of the ones that got an
 * appointment set (has_appt). Both rollups (dashboard_rollup 0162,
 * marketing_analytics_rollup 0164) expose leads / withAppt / signed on
 * the window's cohort, so one helper serves both pages.
 */

test("win rates: signed out of every lead, and out of the ones with an appointment", () => {
  // Same signed count on both, so "from appointments" is the higher rate.
  assert.deepEqual(winRates({ leads: 3241, withAppt: 520, signed: 11 }), {
    fromLeads: { rate: (11 / 3241) * 100, signed: 11, of: 3241 },
    fromAppts: { rate: (11 / 520) * 100, signed: 11, of: 520 },
  });
});

test("win rates: a zero denominator shows no rate, never NaN or Infinity", () => {
  // Leads came in but nothing is booked yet.
  assert.deepEqual(winRates({ leads: 40, withAppt: 0, signed: 1 }).fromAppts, { rate: null, signed: 1, of: 0 });
  // An empty period.
  assert.deepEqual(winRates({ leads: 0, withAppt: 0, signed: 0 }), {
    fromLeads: { rate: null, signed: 0, of: 0 },
    fromAppts: { rate: null, signed: 0, of: 0 },
  });
});

test("win rates: extra fields on a rollup's totals are ignored", () => {
  // Marketing Analytics passes its whole totals object; only the three
  // funnel counts matter.
  const totals = { leads: 10, withAppt: 5, signed: 2, signedCents: 1000, estimated: 4 };
  const r = winRates(totals);
  assert.deepEqual([r.fromLeads.rate, r.fromAppts.rate], [20, 40]);
});

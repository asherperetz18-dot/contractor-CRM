import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeSalesTeamChange,
  salesTeamChanged,
  type SalesTeamSnapshot,
} from "./sales-team-changes.ts";

/**
 * The audit trail stores raw before/after snapshots and describes them
 * at read time, so what these lines say IS the history an admin reads.
 * The edges tested: nothing-changed must describe as nothing (that is
 * what decides whether a row is written at all), seats resolve through
 * the caller's roster, and a never-saved rate reads as unset, not 0%.
 */

const R1 = "11111111-1111-1111-1111-111111111111";
const R2 = "22222222-2222-2222-2222-222222222222";
const C1 = "33333333-3333-3333-3333-333333333333";
const NAMES: Record<string, string> = {
  [R1]: "Jonathan Wizman",
  [R2]: "Alex Cohen",
  [C1]: "Dana Levi",
};
const name = (id: string) => NAMES[id] ?? "Unnamed";

const base: SalesTeamSnapshot = {
  sales_rep_1: R1,
  sales_rep_1_bp: 10000,
  sales_rep_2: null,
  sales_rep_2_bp: 0,
  closer_id: null,
  closer_pool_bp: 0,
  commission_rate_bp: 5000,
  lead_cost_bp: 1500,
};

test("an identical team describes as no change, so no row gets written", () => {
  assert.deepEqual(describeSalesTeamChange(base, { ...base }, name), []);
  assert.equal(salesTeamChanged(base, { ...base }), false);
});

test("swapping the salesperson names both people", () => {
  const after = { ...base, sales_rep_1: R2 };
  assert.deepEqual(describeSalesTeamChange(base, after, name), [
    "Salesperson: Jonathan Wizman → Alex Cohen",
  ]);
  assert.equal(salesTeamChanged(base, after), true);
});

test("adding a second salesperson reads as the seat plus one split line, not four numbers", () => {
  const after = { ...base, sales_rep_2: R2, sales_rep_1_bp: 6000, sales_rep_2_bp: 4000 };
  assert.deepEqual(describeSalesTeamChange(base, after, name), [
    "Second salesperson: none → Alex Cohen",
    "Share split: 100% / 0% → 60% / 40%",
  ]);
});

test("the closer seat and their pool share; an emptied seat reads as none", () => {
  const withCloser = { ...base, closer_id: C1, closer_pool_bp: 800 };
  assert.deepEqual(describeSalesTeamChange(base, withCloser, name), [
    "Closer: none → Dana Levi",
    "Closer share of pool: 0% → 8%",
  ]);
  assert.deepEqual(describeSalesTeamChange(withCloser, { ...base }, name), [
    "Closer: Dana Levi → none",
    "Closer share of pool: 8% → 0%",
  ]);
});

test("a never-saved rate reads as unset — not 0%, which would be a chosen figure", () => {
  const before = { ...base, commission_rate_bp: null, lead_cost_bp: null };
  const after = { ...base, lead_cost_bp: 1250 };
  assert.deepEqual(describeSalesTeamChange(before, after, name), [
    "Lead cost %: unset → 12.5%",
    "Commission % of net: unset → 50%",
  ]);
});

test("a seat the roster no longer resolves still describes through the caller's fallback", () => {
  const after = { ...base, sales_rep_1: "99999999-9999-9999-9999-999999999999" };
  assert.deepEqual(describeSalesTeamChange(base, after, name), [
    "Salesperson: Jonathan Wizman → Unnamed",
  ]);
});

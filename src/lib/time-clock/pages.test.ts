import { test } from "node:test";
import assert from "node:assert/strict";
import { PAGE_REGISTRY, defaultPageVisible, type AppRole } from "../data/types.ts";

/**
 * The Time Clock is for everyone who works (whether they clock in is
 * the company's setting, not the menu's). Team Map and Timesheets show
 * where people are and what they're paid -- Office and Admin only
 * unless someone turns them on in Role Visibility on purpose.
 */

const ALL: AppRole[] = ["Office", "Field", "Sales", "Dispatch", "Call Center", "Bookkeeping", "Production"];

test("the three pages live in Staff", () => {
  for (const key of ["time-clock", "team-map", "timesheets"]) {
    assert.equal(PAGE_REGISTRY.find((p) => p.key === key)?.group, "Staff", key);
  }
});

test("every role can open the Time Clock", () => {
  for (const role of ALL) assert.equal(defaultPageVisible(role, "time-clock"), true, role);
});

test("only Office sees Team Map and Timesheets by default", () => {
  for (const role of ALL) {
    assert.equal(defaultPageVisible(role, "team-map"), role === "Office", `team-map ${role}`);
    assert.equal(defaultPageVisible(role, "timesheets"), role === "Office", `timesheets ${role}`);
  }
});

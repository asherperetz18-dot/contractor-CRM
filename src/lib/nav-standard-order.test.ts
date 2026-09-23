import { test } from "node:test";
import assert from "node:assert/strict";
import { PAGE_REGISTRY, STANDARD_NAV_ORDER, TOP_LEVEL_NAV_GROUP } from "./data/types.ts";

// The built-in sidebar order -- what a new company sees and what
// "Reset to standard order" on Settings › Menu Order goes back to.
test("the standard menu order is the one the office arranged", () => {
  assert.deepEqual(STANDARD_NAV_ORDER, [
    "/",
    "/marketing-analytics",
    "/dispatch-dashboard",
    "/calendar",
    "/schedule",
    "/estimates",
    "group:Production",
    "group:Accounting",
    "group:Dispatch",
    "group:Call Center",
    "group:Staff",
    "/estimate-status",
    "/estimate-approvals",
  ]);
});

// A renamed page or group would quietly fall out of the standard order
// and drop to the bottom of the menu; this catches it.
test("every standard-order key names a real sidebar entry", () => {
  const real = new Set<string>(["/estimate-approvals"]);
  for (const page of PAGE_REGISTRY) {
    real.add(page.group === TOP_LEVEL_NAV_GROUP ? page.href : "group:" + page.group);
  }
  for (const key of STANDARD_NAV_ORDER) assert.ok(real.has(key), key + " is in the sidebar");
  for (const key of real) assert.ok(STANDARD_NAV_ORDER.includes(key), key + " has a standard spot");
});

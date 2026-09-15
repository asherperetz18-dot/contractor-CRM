import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCallStats,
  contactQueryPlan,
  digitsSearchPattern,
} from "./dial-filters.ts";
import { NO_DISPOSITION } from "./data/types.ts";

/**
 * The Power Dialer used to ship every lead in the company to the
 * browser and filter there. At 79k contacts the page took ages to
 * open, so filtering moved server-side; these tests pin the judgments
 * that moved: how per-lead call stats are derived from the log, and
 * how an attempts+disposition filter combination becomes a query plan
 * (a small id list to include, or a small id list to exclude from the
 * whole book). The semantics must match what the in-browser filter did.
 */

const A = "aaaaaaaa-0000-0000-0000-000000000000";
const B = "bbbbbbbb-0000-0000-0000-000000000000";
const C = "cccccccc-0000-0000-0000-000000000000";

test("stats: attempts count every log; the newest log's disposition wins", () => {
  // Logs arrive newest-first, as the query orders them.
  const stats = buildCallStats([
    { lead_id: A, disposition: "Booked" },
    { lead_id: B, disposition: NO_DISPOSITION },
    { lead_id: A, disposition: "No Answer" },
    { lead_id: null, disposition: "Booked" }, // no lead: not counted anywhere
  ]);
  assert.deepEqual(stats.get(A), { attempts: 2, disposition: "Booked" });
  assert.deepEqual(stats.get(B), { attempts: 1, disposition: NO_DISPOSITION });
  assert.equal(stats.has(C), false);
});

test("the default view (All attempts + No Disposition) excludes only dispositioned leads", () => {
  const stats = buildCallStats([
    { lead_id: A, disposition: "Booked" },
    { lead_id: B, disposition: NO_DISPOSITION },
  ]);
  const plan = contactQueryPlan(stats, "All", NO_DISPOSITION);
  // Never-called leads qualify, so the plan is exclusion — and B, called
  // but never dispositioned, must stay in the fresh call list.
  assert.deepEqual(plan, { mode: "exclude", ids: [A] });
});

test("Never + No Disposition excludes every called lead", () => {
  const stats = buildCallStats([
    { lead_id: A, disposition: "Booked" },
    { lead_id: B, disposition: NO_DISPOSITION },
  ]);
  assert.deepEqual(contactQueryPlan(stats, "Never", NO_DISPOSITION), {
    mode: "exclude",
    ids: [A, B].sort(),
  });
});

test("an attempts bucket names the exact called leads to include", () => {
  const stats = buildCallStats([
    { lead_id: A, disposition: NO_DISPOSITION },
    { lead_id: B, disposition: "No Answer" },
    { lead_id: B, disposition: "No Answer" },
    { lead_id: C, disposition: "Booked" },
    { lead_id: C, disposition: "Booked" },
    { lead_id: C, disposition: "Booked" },
  ]);
  assert.deepEqual(contactQueryPlan(stats, "1x", "Any Disposition"), { mode: "include", ids: [] });
  // A was called once but has no disposition — "1x" + the default
  // No Disposition filter is where it shows up.
  assert.deepEqual(contactQueryPlan(stats, "1x", NO_DISPOSITION), { mode: "include", ids: [A] });
  assert.deepEqual(contactQueryPlan(stats, "2x", "No Answer"), { mode: "include", ids: [B] });
  assert.deepEqual(contactQueryPlan(stats, "3+", "Booked"), { mode: "include", ids: [C] });
});

test("a named disposition can only ever match called leads, so the plan includes", () => {
  const stats = buildCallStats([
    { lead_id: A, disposition: "Booked" },
    { lead_id: B, disposition: "No Answer" },
  ]);
  assert.deepEqual(contactQueryPlan(stats, "All", "Booked"), { mode: "include", ids: [A] });
  assert.deepEqual(contactQueryPlan(stats, "All", "Any Disposition"), {
    mode: "include",
    ids: [A, B].sort(),
  });
  // Contradiction — never called, but must carry a disposition — matches nobody.
  assert.deepEqual(contactQueryPlan(stats, "Never", "Booked"), { mode: "include", ids: [] });
});

test("a phone search becomes a digits pattern that survives formatting", () => {
  // "(310) 697" typed as 310697 must match a phone stored as "+1 310-697-6137".
  assert.equal(digitsSearchPattern("310-697"), "%3%1%0%6%9%7%");
  assert.equal(digitsSearchPattern("Robert"), null);
  // Fewer than 3 digits is a name search, not a phone search — same
  // threshold the in-browser filter used.
  assert.equal(digitsSearchPattern("31"), null);
});

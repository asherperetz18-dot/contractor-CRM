import { test } from "node:test";
import assert from "node:assert/strict";
import { DASHBOARD_PANELS, mergePanelOrder } from "./dashboard-layout.ts";

/**
 * The dashboard's boxes are draggable and the order is saved per person
 * (profiles.dashboard_panel_order, the funnel-cards pattern). A saved
 * order has to survive the panel set changing underneath it, and junk
 * from a browser key must never take the dashboard down.
 */

const DEFAULT = DASHBOARD_PANELS.map((p) => p.key);

test("no saved order means the default order", () => {
  assert.deepEqual(mergePanelOrder(null), DEFAULT);
  assert.deepEqual(mergePanelOrder(undefined), DEFAULT);
  assert.deepEqual(mergePanelOrder([]), DEFAULT);
});

test("a rearranged full order is kept exactly", () => {
  const saved = [...DEFAULT].reverse();
  assert.deepEqual(mergePanelOrder(saved), saved);
});

test("unknown keys are dropped and duplicates collapsed", () => {
  const merged = mergePanelOrder(["team", "sales-cash", "no-such-panel", "team"]);
  assert.equal(merged[0], "team");
  assert.equal(merged.filter((k) => k === "team").length, 1);
  assert.ok(!merged.includes("no-such-panel" as never));
  // Nothing lost, nothing invented.
  assert.deepEqual([...merged].sort(), [...DEFAULT].sort());
});

test("a panel added in a later release appears at its shipped spot", () => {
  // An order saved before "calls" existed comes back with calls exactly
  // where this build ships it -- the person's arrangement undisturbed.
  const saved = DEFAULT.filter((k) => k !== "calls");
  assert.deepEqual(mergePanelOrder(saved), DEFAULT);
});

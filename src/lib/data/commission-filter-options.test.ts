import { test } from "node:test";
import assert from "node:assert/strict";
import { commissionRepFilterOptions } from "./commission-filter-options.ts";
import type { AppRole } from "./types.ts";

// The Salesperson filter on /sales-commission. The standing rule for
// rep filters: the active Sales roster, PLUS the ids present in the
// rows being filtered, plus the current tick -- someone with commission
// lines must stay reachable even after they left the roster, and a
// tick must stay visible to be undone.

const roster: { id: string; name: string; roles: AppRole[] }[] = [
  { id: "r1", name: "Asher Peretz", roles: ["Sales"] },
  { id: "r2", name: "Rafi Badash", roles: ["Sales"] },
  { id: "o1", name: "Office Olga", roles: ["Office"] },
];

test("active Sales members are offered; other roles are not", () => {
  const opts = commissionRepFilterOptions(roster, [], "");
  assert.deepEqual(opts.map((o) => o.id), ["r1", "r2"]);
});

test("a rep with rows stays reachable after leaving the roster", () => {
  const opts = commissionRepFilterOptions(
    roster,
    [{ repId: "gone1", repName: "Departed Dana" }],
    ""
  );
  assert.ok(opts.some((o) => o.id === "gone1" && o.name === "Departed Dana"));
});

test("the current tick stays visible so it can be undone", () => {
  const opts = commissionRepFilterOptions(roster, [], "gone2");
  assert.ok(opts.some((o) => o.id === "gone2"));
});

test("options are alphabetical with no duplicates", () => {
  const opts = commissionRepFilterOptions(
    roster,
    [
      { repId: "r1", repName: "Asher Peretz" },
      { repId: "gone1", repName: "Departed Dana" },
    ],
    "r2"
  );
  assert.deepEqual(opts.map((o) => o.name), ["Asher Peretz", "Departed Dana", "Rafi Badash"]);
  assert.equal(new Set(opts.map((o) => o.id)).size, opts.length);
});

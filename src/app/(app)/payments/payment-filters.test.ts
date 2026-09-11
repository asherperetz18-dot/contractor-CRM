import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesClientRep } from "./payment-filters.ts";

/**
 * The Payments page filters by client and rep the same way Money to
 * Collect does, and one predicate scopes all three tables. The edges
 * worth pinning: rows with no lead or no rep (old imports, contracts
 * whose lead was deleted) must vanish under a filter rather than leak
 * into every client's view.
 */

const row = { leadId: "lead-1", rep: "Brendan" };

test("no filter set matches every row", () => {
  assert.equal(matchesClientRep({ clientId: "", rep: "" }, row), true);
  assert.equal(matchesClientRep({ clientId: "", rep: "" }, { leadId: null, rep: null }), true);
});

test("client filter matches only that lead's rows", () => {
  assert.equal(matchesClientRep({ clientId: "lead-1", rep: "" }, row), true);
  assert.equal(matchesClientRep({ clientId: "lead-2", rep: "" }, row), false);
});

test("rep filter matches only that rep's rows, exact name", () => {
  assert.equal(matchesClientRep({ clientId: "", rep: "Brendan" }, row), true);
  assert.equal(matchesClientRep({ clientId: "", rep: "Asher" }, row), false);
});

test("client and rep together must both match", () => {
  assert.equal(matchesClientRep({ clientId: "lead-1", rep: "Brendan" }, row), true);
  assert.equal(matchesClientRep({ clientId: "lead-1", rep: "Asher" }, row), false);
  assert.equal(matchesClientRep({ clientId: "lead-2", rep: "Brendan" }, row), false);
});

test("a row with no lead or no rep never matches an active filter", () => {
  assert.equal(matchesClientRep({ clientId: "lead-1", rep: "" }, { leadId: null, rep: "Brendan" }), false);
  assert.equal(matchesClientRep({ clientId: "", rep: "Brendan" }, { leadId: "lead-1", rep: null }), false);
});

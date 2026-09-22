import { test } from "node:test";
import assert from "node:assert/strict";
import { approvalFilterOptions, filterApprovals } from "./approvals-filters.ts";

// The Approvals list's dropdowns. Options come from the rows being
// filtered -- everyone with a draft waiting is reachable, and a name
// with nothing pending would only ever filter to an empty list.

const rows = [
  { id: "a", customer: "Drew Thomas", writtenBy: "Jonathan Wizman", total_cents: 0 },
  { id: "b", customer: "Peter Ibrahim", writtenBy: "Asher", total_cents: 13_000_000 },
  { id: "c", customer: "Alta View Post Acute", writtenBy: "Vanessa Sandoval", total_cents: 730_000 },
  { id: "d", customer: "Drew Thomas", writtenBy: "Asher Peretz", total_cents: null },
];

test("options are the distinct names in the rows, sorted, blanks dropped", () => {
  const opts = approvalFilterOptions([...rows, { id: "e", customer: null, writtenBy: null, total_cents: 5 }]);
  assert.deepEqual(opts.customers, ["Alta View Post Acute", "Drew Thomas", "Peter Ibrahim"]);
  assert.deepEqual(opts.writers, ["Asher", "Asher Peretz", "Jonathan Wizman", "Vanessa Sandoval"]);
});

test("customer and writer filters narrow together", () => {
  const out = filterApprovals(rows, { customer: "Drew Thomas", writtenBy: "Asher Peretz", sort: "newest" });
  assert.deepEqual(out.map((r) => r.id), ["d"]);
});

test("'newest' keeps the list's own order — the server already sorted it", () => {
  const out = filterApprovals(rows, { customer: "", writtenBy: "", sort: "newest" });
  assert.deepEqual(out.map((r) => r.id), ["a", "b", "c", "d"]);
});

test("value sorts put the money in order, and a priceless draft always sorts last", () => {
  const desc = filterApprovals(rows, { customer: "", writtenBy: "", sort: "value_desc" });
  assert.deepEqual(desc.map((r) => r.id), ["b", "c", "a", "d"]);
  const asc = filterApprovals(rows, { customer: "", writtenBy: "", sort: "value_asc" });
  assert.deepEqual(asc.map((r) => r.id), ["a", "c", "b", "d"]);
});

test("filtering never mutates the list it was given", () => {
  const copy = [...rows];
  filterApprovals(rows, { customer: "", writtenBy: "", sort: "value_desc" });
  assert.deepEqual(rows, copy);
});

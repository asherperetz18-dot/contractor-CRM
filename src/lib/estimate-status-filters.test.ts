import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimateStatusFilterOptions,
  statusBoardRep1Id,
  filterEstimateStatusRows,
  type EstimateStatusFilter,
  type FilterableStatusRow,
} from "./estimate-status-filters.ts";

function row(over: Partial<FilterableStatusRow> = {}): FilterableStatusRow {
  return {
    flowKey: "awaiting_customer",
    customer: "Jeff Vance",
    closerId: "c1",
    closerName: "Asher",
    rep1Id: "r1",
    rep1Name: "Dana",
    rep2Id: null,
    rep2Name: null,
    ...over,
  };
}

const NONE: EstimateStatusFilter = { status: "", closer: "", rep: "", search: "" };

test("closer and rep options come from the rows, named, alphabetical, no blanks or repeats", () => {
  const rows = [
    row(),
    row({ closerId: "c2", closerName: "Assaf", rep1Id: "r2", rep1Name: "Ben", rep2Id: "r1", rep2Name: "Dana" }),
    row({ closerId: null, closerName: null, rep1Id: null, rep1Name: null }),
  ];
  const o = estimateStatusFilterOptions(rows);
  assert.deepEqual(o.closers, [{ id: "c1", name: "Asher" }, { id: "c2", name: "Assaf" }]);
  assert.deepEqual(o.reps, [{ id: "r2", name: "Ben" }, { id: "r1", name: "Dana" }]);
});

test("status narrows by the flow key; rep matches either seat; closer matches the closer", () => {
  const rows = [
    row({ flowKey: "signed" }),
    row({ flowKey: "awaiting_approval", rep2Id: "r9", rep2Name: "Zed" }),
    row({ flowKey: "awaiting_customer", closerId: "c2", closerName: "Assaf" }),
  ];
  assert.equal(filterEstimateStatusRows(rows, NONE).length, 3);
  assert.equal(filterEstimateStatusRows(rows, { ...NONE, status: "signed" }).length, 1);
  assert.equal(filterEstimateStatusRows(rows, { ...NONE, rep: "r9" }).length, 1);
  assert.equal(filterEstimateStatusRows(rows, { ...NONE, rep: "r1" }).length, 3);
  assert.equal(filterEstimateStatusRows(rows, { ...NONE, closer: "c2" }).length, 1);
  assert.equal(filterEstimateStatusRows(rows, { ...NONE, closer: "c1", status: "signed" }).length, 1);
});

test("search matches the customer's name, case-insensitively, trimmed", () => {
  const rows = [row({ customer: "Jeff Vance" }), row({ customer: "Tamerlin & Tim Godley" })];
  assert.equal(filterEstimateStatusRows(rows, { ...NONE, search: "  godley " }).length, 1);
  assert.equal(filterEstimateStatusRows(rows, { ...NONE, search: "VANCE" }).length, 1);
  assert.equal(filterEstimateStatusRows(rows, { ...NONE, search: "nobody" }).length, 0);
});

test("an unsigned document's rep 1 follows whoever holds the lead now", () => {
  // EST-1032: raised while Brendan held the lead, lead since handed to
  // Simon. The board said Brendan and filtered under him.
  assert.equal(
    statusBoardRep1Id({ status: "Sent", salesRep1: null, estimateAssignedTo: "brendan", leadAssignedTo: "simon" }),
    "simon"
  );
});

test("a signed document's rep 1 stays who it was stamped with", () => {
  assert.equal(
    statusBoardRep1Id({ status: "Signed", salesRep1: null, estimateAssignedTo: "brendan", leadAssignedTo: "simon" }),
    "brendan"
  );
});

test("a set salesperson seat wins over the lead", () => {
  assert.equal(
    statusBoardRep1Id({ status: "Sent", salesRep1: "dana", estimateAssignedTo: "brendan", leadAssignedTo: "simon" }),
    "dana"
  );
});

test("an unassigned lead falls back to the document's stamp", () => {
  assert.equal(
    statusBoardRep1Id({ status: "Draft", salesRep1: null, estimateAssignedTo: "brendan", leadAssignedTo: null }),
    "brendan"
  );
});

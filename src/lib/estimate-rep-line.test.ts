import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateRepLine } from "./estimate-rep-line.ts";

test("a draft names whoever holds the lead now, and says it comes from the lead", () => {
  assert.deepEqual(
    estimateRepLine({ status: "Draft", estimateAssignedTo: "brendan", leadAssignedTo: "simon" }),
    { repId: "simon", followsLead: true }
  );
});

test("a sent estimate still follows the lead", () => {
  assert.deepEqual(
    estimateRepLine({ status: "Sent", estimateAssignedTo: "brendan", leadAssignedTo: "simon" }),
    { repId: "simon", followsLead: true }
  );
});

test("a signed contract keeps the rep who sold it", () => {
  assert.deepEqual(
    estimateRepLine({ status: "Signed", estimateAssignedTo: "brendan", leadAssignedTo: "simon" }),
    { repId: "brendan", followsLead: false }
  );
});

test("an unassigned lead falls back to the document's stamp", () => {
  assert.deepEqual(
    estimateRepLine({ status: "Draft", estimateAssignedTo: "brendan", leadAssignedTo: null }),
    { repId: "brendan", followsLead: true }
  );
});

test("nobody anywhere reads as no rep", () => {
  assert.deepEqual(
    estimateRepLine({ status: "Draft", estimateAssignedTo: null, leadAssignedTo: null }),
    { repId: null, followsLead: true }
  );
});

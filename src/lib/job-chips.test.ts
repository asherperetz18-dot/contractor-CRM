import { test } from "node:test";
import assert from "node:assert/strict";
import {
  JOB_CHIP_GROUP_ORDER,
  jobChipClass,
  jobChipGroup,
  type JobChipKind,
} from "./job-chips.ts";

/**
 * The chips on a job row are read by color before they're read by
 * label: money coming IN is green, money going OUT is red, and every
 * other idea keeps its own single color. These tests pin that meaning
 * so a future chip can't quietly land in the wrong color, and pin the
 * scan order (progress → money in → money out → the job's records).
 */

const ALL_KINDS: JobChipKind[] = [
  "checklist",
  "contract",
  "changeOrder",
  "addInvoice",
  "invoices",
  "addBill",
  "bills",
  "permits",
  "photos",
  "client",
  "report",
];

test("money in is green, money out is red — and the two never share a class", () => {
  for (const kind of ["contract", "changeOrder"] as const) {
    assert.match(jobChipClass(kind), /proj-chip-in/, `${kind} must wear the money-in green`);
    assert.equal(jobChipGroup(kind), "moneyIn");
  }
  for (const kind of ["addBill", "bills"] as const) {
    assert.match(jobChipClass(kind), /proj-chip-out/, `${kind} must wear the money-out red`);
    assert.equal(jobChipGroup(kind), "moneyOut");
  }
  assert.doesNotMatch(jobChipClass("contract"), /proj-chip-out/);
  // An invoice bills the customer: money in, whatever it's for.
  for (const kind of ["addInvoice", "invoices"] as const) {
    assert.match(jobChipClass(kind), /proj-chip-in/, `${kind} must wear the money-in green`);
    assert.doesNotMatch(jobChipClass(kind), /proj-chip-out/);
    assert.equal(jobChipGroup(kind), "moneyIn");
  }
  assert.doesNotMatch(jobChipClass("bills"), /proj-chip-in/);
});

test("the add-a-bill chip is an action, not a record: dashed on top of its red", () => {
  // "+ Add bill" creates a bill, "Bills" opens the pile. Same money
  // direction (both red), different affordance: the creator wears the
  // dashed add border, the record stays solid.
  assert.match(jobChipClass("addBill"), /proj-chip-add/);
  assert.match(jobChipClass("addBill"), /proj-chip-out/);
  assert.doesNotMatch(jobChipClass("bills"), /proj-chip-add/);
});

test("the add-an-invoice chip is the money-in twin of + Add bill: dashed on its green", () => {
  assert.match(jobChipClass("addInvoice"), /proj-chip-add/);
  assert.match(jobChipClass("addInvoice"), /proj-chip-in/);
  assert.doesNotMatch(jobChipClass("invoices"), /proj-chip-add/);
});

test("every chip shares the one pill shape", () => {
  for (const kind of ALL_KINDS) {
    assert.match(jobChipClass(kind), /^proj-check-chip( |$)/, `${kind} must start from the base pill`);
  }
});

test("each non-money idea keeps its own color", () => {
  // Checklist blue, permits indigo, photos purple, client rose,
  // report slate: one color per idea, so no two of them may collide.
  const others: JobChipKind[] = ["checklist", "permits", "photos", "client", "report"];
  const classes = others.map((k) => jobChipClass(k));
  assert.equal(new Set(classes).size, others.length);
  for (const kind of others) {
    assert.equal(jobChipGroup(kind), kind === "checklist" ? "progress" : "records");
  }
});

test("the scan order is progress, then money in, then money out, then records", () => {
  assert.deepEqual(JOB_CHIP_GROUP_ORDER, ["progress", "moneyIn", "moneyOut", "records"]);
});

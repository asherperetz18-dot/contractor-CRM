import { test } from "node:test";
import assert from "node:assert/strict";
import { productionJobRow } from "./production-job.ts";

/**
 * A signed contract puts the job on the Production Board by itself —
 * these edges pin when it may NOT: extras and paper-work documents
 * (change orders, completion certificates) are not new jobs, a lead
 * that already has a job never gets a second one (re-signs, revisions),
 * and the name always says something even when the lead is bare.
 */

const LEAD = {
  first_name: "Tamerlin",
  last_name: "Godley",
  address: "0683 Pacific Coast Hwy #3",
};

const CONTRACT = {
  kind: null as string | null,
  lead_id: "lead-1",
  company_id: "co-1",
  title: "Godley Residence Remodel",
};

test("a signed contract with no existing job becomes a Not Started job", () => {
  const row = productionJobRow(CONTRACT, LEAD, false);
  assert.deepEqual(row, {
    lead_id: "lead-1",
    company_id: "co-1",
    name: "Tamerlin Godley — Project",
    address: "0683 Pacific Coast Hwy #3",
    status: "Not Started",
  });
});

test("change orders and completion certificates never create a job", () => {
  assert.equal(productionJobRow({ ...CONTRACT, kind: "change_order" }, LEAD, false), null);
  assert.equal(productionJobRow({ ...CONTRACT, kind: "completion" }, LEAD, false), null);
});

test("a lead that already has a job gets no second one", () => {
  assert.equal(productionJobRow(CONTRACT, LEAD, true), null);
});

test("no lead on the estimate means no job", () => {
  assert.equal(productionJobRow({ ...CONTRACT, lead_id: null }, null, false), null);
});

test("a nameless lead falls back to the document title", () => {
  const row = productionJobRow(CONTRACT, { first_name: null, last_name: null, address: null }, false);
  assert.equal(row?.name, "Godley Residence Remodel");
  assert.equal(row?.address, null);
});

test("a nameless lead on an untitled document still gets a readable name", () => {
  const row = productionJobRow(
    { ...CONTRACT, title: null },
    { first_name: " ", last_name: "", address: null },
    false
  );
  assert.equal(row?.name, "New Project");
});

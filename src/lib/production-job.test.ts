import { test } from "node:test";
import assert from "node:assert/strict";
import { backfillSeeds, productionJobRow } from "./production-job.ts";

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

test("an invoice (a permit fee billed back) never creates a job", () => {
  assert.equal(productionJobRow({ ...CONTRACT, kind: "invoice" }, LEAD, false), null);
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

// ── Backfill: the contracts signed before auto-create shipped ─────────

const signedDoc = (over: Partial<import("./production-job.ts").SignedContractSeed>) => ({
  id: "e1",
  lead_id: "lead-1",
  kind: null as string | null,
  title: "Some Job",
  signed_at: "2026-09-01T10:00:00Z",
  ...over,
});

test("backfill seeds one job per lead still missing one", () => {
  const seeds = backfillSeeds(
    [
      signedDoc({ id: "e1", lead_id: "lead-1" }),
      signedDoc({ id: "e2", lead_id: "lead-2" }),
      signedDoc({ id: "e3", lead_id: "lead-3" }),
    ],
    new Set(["lead-2"])
  );
  assert.deepEqual(seeds.map((s) => s.lead_id), ["lead-1", "lead-3"]);
});

test("backfill skips change orders, completions and leadless documents", () => {
  const seeds = backfillSeeds(
    [
      signedDoc({ id: "e1", kind: "change_order" }),
      signedDoc({ id: "e2", kind: "completion" }),
      signedDoc({ id: "e3", lead_id: null }),
    ],
    new Set()
  );
  assert.deepEqual(seeds, []);
});

test("backfill skips invoices: a customer billed a permit fee isn't a new job", () => {
  assert.deepEqual(backfillSeeds([signedDoc({ id: "e1", kind: "invoice" })], new Set()), []);
});

test("two signed contracts on one lead seed one job, the latest signature naming it", () => {
  const seeds = backfillSeeds(
    [
      signedDoc({ id: "old", lead_id: "lead-1", title: "v1", signed_at: "2026-08-01T00:00:00Z" }),
      signedDoc({ id: "new", lead_id: "lead-1", title: "v2", signed_at: "2026-09-01T00:00:00Z" }),
    ],
    new Set()
  );
  assert.equal(seeds.length, 1);
  assert.equal(seeds[0].id, "new");
});

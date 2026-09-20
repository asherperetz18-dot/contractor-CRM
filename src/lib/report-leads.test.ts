import { test } from "node:test";
import assert from "node:assert/strict";
import { counterpartyPhoneKeys, repLeadStats, repLeadStatsFromRows } from "./report-leads.ts";

/**
 * The report pages used to ship every lead in the company to the
 * browser just to print names next to their rows. They now fetch only
 * the leads their rows reference; these tests pin the two judgments
 * that moved server-side: which phone numbers an SMS list needs leads
 * matched for, and the per-rep tallies on the Salespeople grid.
 */

test("phone keys come from the counterparty side of unlinked messages only", () => {
  const keys = counterpartyPhoneKeys([
    // Linked: resolved by lead_id, no phone lookup needed.
    { lead_id: "L1", direction: "inbound", from_number: "+1 (310) 697-6137", to_number: "+15625255873" },
    // Unlinked inbound: the counterparty is the sender.
    { lead_id: null, direction: "inbound", from_number: "310-697-6137", to_number: "+15625255873" },
    // Unlinked outbound: the counterparty is the recipient.
    { lead_id: null, direction: "outbound", from_number: "+15625255873", to_number: "9099380628" },
    // Duplicate of the first unlinked number, differently formatted.
    { lead_id: null, direction: "inbound", from_number: "+1 310 697 6137", to_number: "+15625255873" },
  ]);
  assert.deepEqual([...keys].sort(), ["3106976137", "9099380628"]);
});

test("rep tallies: assigned, open, won, and won value — same buckets the grid drew", () => {
  const stats = repLeadStats([
    { assigned_to: "r1", stage: "New", value: 100 },
    { assigned_to: "r1", stage: "Won", value: 50000 },
    { assigned_to: "r1", stage: "Lost", value: 900 },
    { assigned_to: "r1", stage: "DNC", value: 0 },
    { assigned_to: "r2", stage: "Won", value: "2500" as unknown as number },
    { assigned_to: null, stage: "New", value: 10 },
  ]);
  assert.deepEqual(stats.get("r1"), { assignedCount: 4, openCount: 1, wonCount: 1, wonValue: 50000 });
  assert.deepEqual(stats.get("r2"), { assignedCount: 1, openCount: 0, wonCount: 1, wonValue: 2500 });
  assert.equal(stats.has(""), false);
});

// ── Partnership credit ───────────────────────────────────────────────
//
// A lead can carry a partner rep (leads.partner_rep_id, 0163): two reps
// working the job as one sale. The job shows on both records — each
// gets the lead in their tallies and the Won notch — but the money is
// never doubled: the won value splits half and half, so the grid's
// total still adds up to what the company actually sold.

test("a partnership lead counts for both reps, with the won value split", () => {
  const stats = repLeadStats([
    { assigned_to: "r1", partner_rep_id: "r2", stage: "Won", value: 80000 },
    { assigned_to: "r1", partner_rep_id: null, stage: "Won", value: 1000 },
    { assigned_to: "r2", partner_rep_id: "r1", stage: "New", value: 500 },
  ]);
  // r1: own solo win at full value + half the shared one; the open
  // partnership lead sits in their book too.
  assert.deepEqual(stats.get("r1"), { assignedCount: 3, openCount: 1, wonCount: 2, wonValue: 41000 });
  // r2: the shared win at half value, plus their own open lead.
  assert.deepEqual(stats.get("r2"), { assignedCount: 2, openCount: 1, wonCount: 1, wonValue: 40000 });
});

test("a partner equal to the owner never counts the same lead twice", () => {
  const stats = repLeadStats([
    { assigned_to: "r1", partner_rep_id: "r1", stage: "Won", value: 6000 },
  ]);
  assert.deepEqual(stats.get("r1"), { assignedCount: 1, openCount: 0, wonCount: 1, wonValue: 6000 });
});

test("RPC rows convert to the same tallies the scan built — numerics may arrive as strings", () => {
  const stats = repLeadStatsFromRows([
    { assigned_to: "r1", assigned_count: 3, open_count: 1, won_count: "2", won_value: "75000" },
    { assigned_to: "r2", assigned_count: "1", open_count: "1", won_count: 0, won_value: 0 },
  ]);
  assert.deepEqual(stats.get("r1"), {
    assignedCount: 3,
    openCount: 1,
    wonCount: 2,
    wonValue: 75000,
  });
  assert.deepEqual(stats.get("r2"), {
    assignedCount: 1,
    openCount: 1,
    wonCount: 0,
    wonValue: 0,
  });
  assert.equal(stats.size, 2);
});

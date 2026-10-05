import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBoardAggregates, type BoardSlimLead } from "./pipeline-aggregates.ts";

/**
 * The pipeline board's stat tiles (pipeline value, won, stale, no-appt)
 * used to be reduced in the browser from every lead in the company --
 * shipped there whole. They are now computed server-side from a slim
 * scan; these tests pin the arithmetic to what the in-browser version
 * produced, including its quirks (a lead with value 0 counts toward the
 * average's denominator but adds nothing to the total).
 */

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function lead(overrides: Partial<BoardSlimLead>): BoardSlimLead {
  return {
    stage: "New",
    stage_key: null,
    value: 0,
    has_appt: false,
    date_received: daysAgoISO(1),
    ...overrides,
  };
}

test("money tiles: open value, average over all open, won separate", () => {
  const agg = computeBoardAggregates([
    lead({ stage: "New", value: 1000 }),
    lead({ stage: "Estimate Sent", value: 3000 }),
    lead({ stage: "New", value: 0 }), // counted in the average's denominator
    lead({ stage: "Won", stage_key: "won", value: 50000 }),
    lead({ stage: "Lost", stage_key: "lost", value: 700 }), // closed: in neither figure
  ]);
  assert.equal(agg.pipelineValue, 4000);
  assert.equal(agg.avgDealSize, 4000 / 3);
  assert.equal(agg.leadsWithNoValue, 1);
  assert.equal(agg.wonValue, 50000);
  assert.equal(agg.wonCount, 1);
  assert.equal(agg.wonNoValueCount, 0);
});

test("stale counts open leads older than 14 days; no-appt counts open leads without one", () => {
  const agg = computeBoardAggregates([
    lead({ date_received: daysAgoISO(20) }),
    lead({ date_received: daysAgoISO(15) }),
    lead({ date_received: daysAgoISO(14) }), // exactly 14 is not stale
    lead({ stage: "Won", stage_key: "won", date_received: daysAgoISO(40) }), // closed: never stale
    lead({ has_appt: true }),
  ]);
  assert.equal(agg.staleCount, 2);
  // Four open leads, one has an appointment.
  assert.equal(agg.noApptCount, 3);
});

test("value-by-stage lists open stages, biggest money first, count breaking ties", () => {
  const agg = computeBoardAggregates([
    lead({ stage: "New", value: 100 }),
    lead({ stage: "New", value: 200 }),
    lead({ stage: "Estimate Sent", value: 5000 }),
    lead({ stage: "Sold, In Production", value: 300 }),
    lead({ stage: "Measured", value: 400 }),
    lead({ stage: "Measured", value: 0 }),
    lead({ stage: "Won", stage_key: "won", value: 9999 }), // closed: not open money
  ]);
  assert.deepEqual(agg.valueByStage, [
    { stage: "Estimate Sent", count: 1, value: 5000 },
    { stage: "Measured", count: 2, value: 400 },
    // Same money: the stage with more leads in it lists first.
    { stage: "New", count: 2, value: 300 },
    { stage: "Sold, In Production", count: 1, value: 300 },
  ]);
});

test("won and closed go by the stage's tag, whatever the company calls it", () => {
  const agg = computeBoardAggregates([
    lead({ stage: "Sold", stage_key: "won", value: 8000 }), // "Won", renamed
    lead({ stage: "Not Interested", stage_key: "not_interested", value: 1200 }),
    lead({ stage: "Do Not Call", stage_key: "dnc", value: 900, date_received: daysAgoISO(30) }),
    lead({ stage: "Won", stage_key: null, value: 50 }), // a company's own stage that merely says Won
  ]);
  assert.equal(agg.wonValue, 8000);
  assert.equal(agg.wonCount, 1);
  // Not Interested and do-not-contact are nobody's pipeline (they used to count).
  assert.equal(agg.pipelineValue, 50);
  assert.equal(agg.openCount, 1);
  assert.equal(agg.staleCount, 0);
});

test("a string value from the database still adds up as a number", () => {
  const agg = computeBoardAggregates([
    lead({ value: "2500" as unknown as number }),
    lead({ value: "not a number" as unknown as number }),
  ]);
  assert.equal(agg.pipelineValue, 2500);
  assert.equal(agg.leadsWithNoValue, 1);
});

test("an empty book yields zeros, not NaN", () => {
  const agg = computeBoardAggregates([]);
  assert.equal(agg.pipelineValue, 0);
  assert.equal(agg.avgDealSize, 0);
  assert.equal(agg.wonValue, 0);
  assert.deepEqual(agg.valueByStage, []);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { dispositionStageMove } from "./types.ts";

/**
 * The rule that lets a phone call move a lead. Its whole job is knowing
 * when NOT to act -- a dialer click reaching a lead mid-deal would be a
 * regression dressed as a feature, so the refusals are what get tested.
 */

const STAGES = [
  { name: "Unsorted", key: "unsorted", sort_order: 1 },
  { name: "New Lead", key: "new_lead", sort_order: 2 },
  { name: "No Answer", key: "no_answer", sort_order: 3 },
  { name: "Contacted", key: "contacted", sort_order: 4 },
  { name: "Appointment Scheduled", key: "appointment_scheduled", sort_order: 5 },
  { name: "Proposal Sent", key: "proposal_sent", sort_order: 6 },
  { name: "Won", key: "won", sort_order: 7 },
  { name: "Not Interested", key: "not_interested", sort_order: 8 },
  { name: "DNC", key: "dnc", sort_order: 9 },
];

test("moves an early-stage lead to the configured stage", () => {
  assert.equal(
    dispositionStageMove({ currentStage: "New Lead", moveToStage: "Contacted", stages: STAGES }),
    "Contacted"
  );
  assert.equal(
    dispositionStageMove({ currentStage: "Contacted", moveToStage: "Not Interested", stages: STAGES }),
    "Not Interested"
  );
});

test("never touches a lead past its first appointment", () => {
  // The customer at Proposal Sent who misses one call.
  for (const stage of ["Appointment Scheduled", "Proposal Sent", "Won"]) {
    assert.equal(
      dispositionStageMove({ currentStage: stage, moveToStage: "No Answer", stages: STAGES }),
      null,
      stage
    );
  }
});

test("no mapping means no move", () => {
  assert.equal(
    dispositionStageMove({ currentStage: "New Lead", moveToStage: null, stages: STAGES }),
    null
  );
  assert.equal(
    dispositionStageMove({ currentStage: "New Lead", moveToStage: undefined, stages: STAGES }),
    null
  );
  assert.equal(
    dispositionStageMove({ currentStage: "New Lead", moveToStage: "", stages: STAGES }),
    null
  );
});

test("a mapping pointing at a deleted stage skips rather than writes it", () => {
  assert.equal(
    dispositionStageMove({
      currentStage: "New Lead",
      moveToStage: "Ghost Stage",
      stages: STAGES,
    }),
    null
  );
});

test("already there means no pointless write", () => {
  assert.equal(
    dispositionStageMove({ currentStage: "No Answer", moveToStage: "No Answer", stages: STAGES }),
    null
  );
});

test("goes by the stage's tag, so renamed stages still work", () => {
  // "No Answer" renamed to "Voicemail", "Contacted" to "Spoke With":
  // still early stages, still a valid target.
  const renamed = STAGES.map((s) =>
    s.key === "no_answer" ? { ...s, name: "Voicemail" } : s.key === "contacted" ? { ...s, name: "Spoke With" } : s
  );
  assert.equal(
    dispositionStageMove({ currentStage: "Spoke With", moveToStage: "Voicemail", stages: renamed }),
    "Voicemail"
  );
});

test("a company's own column before Appointment Scheduled counts as early", () => {
  // A "Facebook Leads" intake column is waiting for a first appointment
  // just like New Lead; one placed after it is not.
  const withOwn = [
    ...STAGES,
    { name: "Facebook Leads", key: null, sort_order: 2.5 },
    { name: "Financing Review", key: null, sort_order: 6.5 },
  ];
  assert.equal(
    dispositionStageMove({ currentStage: "Facebook Leads", moveToStage: "Contacted", stages: withOwn }),
    "Contacted"
  );
  assert.equal(
    dispositionStageMove({ currentStage: "Financing Review", moveToStage: "Contacted", stages: withOwn }),
    null
  );
});

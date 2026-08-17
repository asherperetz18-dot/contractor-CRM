import { test } from "node:test";
import assert from "node:assert/strict";
import { PRE_APPOINTMENT_STAGES, dispositionStageMove } from "./types.ts";

/**
 * The rule that lets a phone call move a lead. Its whole job is knowing
 * when NOT to act -- a dialer click reaching a lead mid-deal would be a
 * regression dressed as a feature, so the refusals are what get tested.
 */

const STAGES = [
  "Unsorted",
  "New Lead",
  "No Answer",
  "Contacted",
  "Appointment Scheduled",
  "Proposal Sent",
  "Won",
  "Not Interested",
  "DNC",
];

test("moves an early-stage lead to the configured stage", () => {
  assert.equal(
    dispositionStageMove({ currentStage: "New Lead", moveToStage: "Contacted", companyStages: STAGES }),
    "Contacted"
  );
  assert.equal(
    dispositionStageMove({ currentStage: "Contacted", moveToStage: "Not Interested", companyStages: STAGES }),
    "Not Interested"
  );
});

test("never touches a lead past its first appointment", () => {
  // The customer at Proposal Sent who misses one call.
  for (const stage of ["Appointment Scheduled", "Proposal Sent", "Won"]) {
    assert.equal(
      dispositionStageMove({ currentStage: stage, moveToStage: "No Answer", companyStages: STAGES }),
      null,
      stage
    );
  }
});

test("no mapping means no move", () => {
  assert.equal(
    dispositionStageMove({ currentStage: "New Lead", moveToStage: null, companyStages: STAGES }),
    null
  );
  assert.equal(
    dispositionStageMove({ currentStage: "New Lead", moveToStage: undefined, companyStages: STAGES }),
    null
  );
  assert.equal(
    dispositionStageMove({ currentStage: "New Lead", moveToStage: "", companyStages: STAGES }),
    null
  );
});

test("a mapping pointing at a deleted stage skips rather than writes it", () => {
  assert.equal(
    dispositionStageMove({
      currentStage: "New Lead",
      moveToStage: "Ghost Stage",
      companyStages: STAGES,
    }),
    null
  );
});

test("already there means no pointless write", () => {
  assert.equal(
    dispositionStageMove({ currentStage: "No Answer", moveToStage: "No Answer", companyStages: STAGES }),
    null
  );
});

test("the early stages are exactly the ones booking an appointment advances from", () => {
  // bookAppointmentForLead and the dialer share this list on purpose;
  // if it changes shape, both change together.
  assert.deepEqual(PRE_APPOINTMENT_STAGES, [
    "Unsorted",
    "New Lead",
    "Meta",
    "No Answer",
    "Contacted",
  ]);
});

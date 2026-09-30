import { test } from "node:test";
import assert from "node:assert/strict";
import { leadCardMeta, pickPhoneStage } from "./phone-leads.ts";

const GROUPS = [
  { stage: "New Lead", count: 0 },
  { stage: "Contacted", count: 118 },
  { stage: "Appointment Set", count: 31 },
];

test("the phone list opens on the first stage that has leads in it", () => {
  assert.equal(pickPhoneStage(GROUPS, null), "Contacted");
});

test("a stage the person picked stays picked while it is still a column", () => {
  assert.equal(pickPhoneStage(GROUPS, "Appointment Set"), "Appointment Set");
  // Even when it has emptied out: the chip is still there to see.
  assert.equal(pickPhoneStage(GROUPS, "New Lead"), "New Lead");
});

test("a picked stage that is no longer a column (Won/Lost, hidden) gives way", () => {
  assert.equal(pickPhoneStage(GROUPS, "Won"), "Contacted");
  assert.equal(pickPhoneStage([{ stage: "Won", count: 0 }], "Contacted"), "Won");
  assert.equal(pickPhoneStage([], "Contacted"), null);
});

test("a card's line says what the job is, its value, how old it is and where it came from", () => {
  const card = { project_type: "Kitchen remodel", value: 18400, source: "Facebook", stage: "Contacted" };
  assert.deepEqual(leadCardMeta(card, 3), { text: "Kitchen remodel · $18,400 · 3 days old · Facebook", stale: false });
});

test("empty parts are left out rather than printed as blanks or $0", () => {
  const card = { project_type: null, value: 0, source: null, stage: "New Lead" };
  assert.deepEqual(leadCardMeta(card, 0), { text: "Came in today", stale: false });
  assert.equal(leadCardMeta(card, 1).text, "Came in yesterday");
  // A future date is a typo, not a lead from tomorrow.
  assert.equal(leadCardMeta(card, -3).text, "Came in today");
});

test("an open lead over two weeks old is stale; a won or lost one never is", () => {
  const open = { project_type: null, value: 0, source: "Angi", stage: "Contacted" };
  assert.deepEqual(leadCardMeta(open, 15), { text: "15 days old · Angi", stale: true });
  assert.equal(leadCardMeta(open, 14).stale, false);
  assert.equal(leadCardMeta({ ...open, stage: "Won" }, 40).stale, false);
});

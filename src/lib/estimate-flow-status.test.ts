import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateFlowStatus } from "./estimate-flow-status.ts";

// One question per row on the Estimate Status page: where is my
// document, and who is it waiting on? The gates answer in the order
// they actually fire on a send — admin approval first (0136), then the
// closer's hold (decision #024), then the customer.
//
// Colors follow the funnel's established meanings: amber = awaiting the
// customer's signature, green = signed. Indigo marks the paperwork gate
// (approval), blue marks progress that is the team's to make. Green and
// red stay reserved for money direction elsewhere; a signed contract is
// the money arriving, which is why the funnel already paints it green.

test("a draft under the approval gate waits on the admin, whoever the viewer is", () => {
  const s = estimateFlowStatus({
    status: "Draft",
    approvedAt: null,
    approvalRequired: true,
    closerId: "closer-1",
    closerName: "Sam Okafor",
    viewerId: "rep-1",
  });
  assert.equal(s.key, "awaiting_approval");
  assert.ok(s.label.toLowerCase().includes("approval"));
});

test("an approved draft on a closer-led lead waits on the closer, by name", () => {
  const s = estimateFlowStatus({
    status: "Draft",
    approvedAt: "2026-09-20T10:00:00Z",
    approvalRequired: true,
    closerId: "closer-1",
    closerName: "Sam Okafor",
    viewerId: "rep-1",
  });
  assert.equal(s.key, "closer_sends");
  assert.ok(s.label.includes("Sam Okafor"));
});

test("the closer viewing that same draft reads it as theirs to send", () => {
  const s = estimateFlowStatus({
    status: "Draft",
    approvedAt: "2026-09-20T10:00:00Z",
    approvalRequired: true,
    closerId: "closer-1",
    closerName: "Sam Okafor",
    viewerId: "closer-1",
  });
  assert.equal(s.key, "ready_to_send");
  assert.ok(s.label.toLowerCase().includes("you"));
});

test("no gates: a plain draft is simply ready to send", () => {
  const s = estimateFlowStatus({
    status: "Draft",
    approvedAt: null,
    approvalRequired: false,
    closerId: null,
    viewerId: "rep-1",
  });
  assert.equal(s.key, "ready_to_send");
});

test("sent and viewed both wait on the customer, and say which", () => {
  const sent = estimateFlowStatus({
    status: "Sent",
    approvedAt: null,
    approvalRequired: false,
    closerId: null,
    viewerId: "rep-1",
  });
  const viewed = estimateFlowStatus({
    status: "Viewed",
    approvedAt: null,
    approvalRequired: false,
    closerId: null,
    viewerId: "rep-1",
  });
  assert.equal(sent.key, "awaiting_customer");
  assert.equal(viewed.key, "awaiting_customer");
  assert.notEqual(sent.label, viewed.label);
});

test("signed is signed — the gates upstream no longer speak", () => {
  const s = estimateFlowStatus({
    status: "Signed",
    approvedAt: null,
    approvalRequired: true,
    closerId: "closer-1",
    viewerId: "rep-1",
  });
  assert.equal(s.key, "signed");
});

test("every status carries a meaning color, and the funnel's two are kept", () => {
  const signed = estimateFlowStatus({
    status: "Signed",
    approvedAt: null,
    approvalRequired: false,
    closerId: null,
    viewerId: "r",
  });
  const waiting = estimateFlowStatus({
    status: "Sent",
    approvedAt: null,
    approvalRequired: false,
    closerId: null,
    viewerId: "r",
  });
  // Green for signed, amber for awaiting the customer -- the same
  // meanings the estimates funnel already taught the office to read.
  assert.equal(signed.color, "#2F855A");
  assert.equal(waiting.color, "#C7691B");
});

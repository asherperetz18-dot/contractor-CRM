import { test } from "node:test";
import assert from "node:assert/strict";
import { approvalHoldsSend, approvalHoldMessage } from "./estimate-approval-gate.ts";

// The rule, pinned: with the company's approval switch on, a document
// leaves Draft only once an admin has approved it. This mirrors the
// database trigger (0136) so the send action can refuse BEFORE the
// email or text goes out -- the trigger can only refuse the status
// change, by which time the customer is already holding a link.

test("no hold when the company hasn't switched approval on", () => {
  assert.equal(approvalHoldsSend({ approvalRequired: false, approvedAt: null }), false);
});

test("no hold once the document is approved", () => {
  assert.equal(
    approvalHoldsSend({ approvalRequired: true, approvedAt: "2026-09-20T17:00:00.000Z" }),
    false
  );
});

test("held when approval is required and nobody has approved yet", () => {
  assert.equal(approvalHoldsSend({ approvalRequired: true, approvedAt: null }), true);
});

test("a rep is told to ask an admin, naming the document", () => {
  const msg = approvalHoldMessage("EST-1110", { canApprove: false });
  assert.match(msg, /needs to be approved before it can go out/);
  assert.match(msg, /Ask an admin to approve EST-1110/);
});

test("an admin is told to approve it themselves", () => {
  const msg = approvalHoldMessage("EST-1110", { canApprove: true });
  assert.match(msg, /Approve EST-1110 on the Estimate Approvals screen/);
  assert.doesNotMatch(msg, /Ask an admin/);
});

test("a document with no number is still described", () => {
  assert.match(approvalHoldMessage(null, { canApprove: false }), /approve it on/);
});

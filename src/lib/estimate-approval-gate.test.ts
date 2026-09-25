import { test } from "node:test";
import assert from "node:assert/strict";
import {
  approvalOnSend,
  approvalHoldMessage,
  selfApprovalNote,
} from "./estimate-approval-gate.ts";

// The rule, pinned: with the company's approval switch on, a document
// leaves Draft only once an admin has approved it -- unless the person
// sending holds "Send without approval" (Users & Roles), in which case
// the send approves it in their name. This mirrors the database trigger
// (0136) so the send action can refuse BEFORE the email or text goes
// out -- the trigger can only refuse the status change, by which time
// the customer is already holding a link.

const base = { approvalRequired: true, approvedAt: null, sendsWithoutApproval: false };

test("clear when the company hasn't switched approval on", () => {
  assert.equal(approvalOnSend({ ...base, approvalRequired: false }), "clear");
});

test("clear once the document is approved", () => {
  assert.equal(approvalOnSend({ ...base, approvedAt: "2026-09-20T17:00:00.000Z" }), "clear");
});

test("held when approval is required and nobody has approved yet", () => {
  assert.equal(approvalOnSend(base), "hold");
});

test("a trusted sender approves it themselves by sending", () => {
  assert.equal(approvalOnSend({ ...base, sendsWithoutApproval: true }), "self-approve");
});

test("a trusted sender never overwrites an admin's existing approval", () => {
  assert.equal(
    approvalOnSend({
      ...base,
      approvedAt: "2026-09-20T17:00:00.000Z",
      sendsWithoutApproval: true,
    }),
    "clear"
  );
});

test("the switch does nothing while the company doesn't require approval", () => {
  assert.equal(
    approvalOnSend({ ...base, approvalRequired: false, sendsWithoutApproval: true }),
    "clear"
  );
});

test("the timeline says who let it go out without an admin's approval", () => {
  const note = selfApprovalNote("EST-1110", "Dana Closer");
  assert.match(note, /EST-1110/);
  assert.match(note, /Dana Closer/);
  assert.match(note, /without waiting for an admin/);
});

test("the note still reads without a number or a name", () => {
  assert.match(selfApprovalNote(null, null), /^Document sent without waiting/);
});

test("a rep is told to ask an admin, naming the document", () => {
  const msg = approvalHoldMessage("EST-1110", { canApprove: false });
  assert.match(msg, /needs to be approved before it can go out/);
  assert.match(msg, /Ask an admin to approve EST-1110/);
});

test("an admin is told to approve it themselves", () => {
  const msg = approvalHoldMessage("EST-1110", { canApprove: true });
  // "here": an admin meets this hold beside an Approve button, on the
  // document page and on Estimate Status, and should not be sent away.
  assert.match(msg, /Approve EST-1110 here or on the Estimate Approvals screen/);
  assert.doesNotMatch(msg, /Ask an admin/);
});

test("a document with no number is still described", () => {
  assert.match(approvalHoldMessage(null, { canApprove: false }), /approve it on/);
});

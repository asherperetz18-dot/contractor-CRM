import { test } from "node:test";
import assert from "node:assert/strict";
import { canSendEstimates, type AppRole } from "./types.ts";

/**
 * The Send Estimates switch: who may take a document out of Draft.
 *
 * Sales rep permissions are the owner's decisions about their own money,
 * so the rule is pinned here rather than assumed -- a rep who can send
 * when the owner switched it off, or an owner who cannot send at all,
 * are both the wrong kind of surprise.
 */

function member(
  roles: AppRole[],
  flags: Partial<{ view: boolean; create: boolean; send: boolean }> = {}
) {
  return {
    roles,
    can_view_estimates: flags.view ?? true,
    can_create_estimates: flags.create ?? true,
    can_send_estimates: flags.send ?? true,
  };
}

test("a rep with create and send may send", () => {
  assert.equal(canSendEstimates(member(["Sales"])), true);
});

test("switching send off leaves the rep drafts-only", () => {
  assert.equal(canSendEstimates(member(["Sales"], { send: false })), false);
});

test("send without create is meaningless -- nothing to send", () => {
  assert.equal(canSendEstimates(member(["Sales"], { create: false, send: true })), false);
});

test("send without view is meaningless too (create needs view)", () => {
  assert.equal(canSendEstimates(member(["Sales"], { view: false, send: true })), false);
});

test("Office and Admin always send, whatever the switch says", () => {
  assert.equal(canSendEstimates(member(["Office"], { send: false })), true);
  assert.equal(canSendEstimates(member(["Admin"], { send: false })), true);
  assert.equal(canSendEstimates(member(["Office"], { view: false, create: false, send: false })), true);
});

test("Production always writes but can still be switched off from sending", () => {
  assert.equal(canSendEstimates(member(["Production"], { create: false })), true);
  assert.equal(canSendEstimates(member(["Production"], { create: false, send: false })), false);
});

test("a role that never writes estimates never sends them", () => {
  assert.equal(canSendEstimates(member(["Field"], { create: false })), false);
  assert.equal(canSendEstimates(member(["Bookkeeping"], { create: false })), false);
  assert.equal(canSendEstimates(member(["Call Center"], { create: false })), false);
});

test("nobody signed in, nothing sent", () => {
  assert.equal(canSendEstimates(null), false);
});

test("holding Office alongside Sales keeps the always-on right", () => {
  assert.equal(canSendEstimates(member(["Sales", "Office"], { send: false })), true);
});

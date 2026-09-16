import { test } from "node:test";
import assert from "node:assert/strict";
import { closerHoldsSend, closerHoldMessage } from "./estimate-closer-gate.ts";

// The rule: on a lead with a closer, the reps draft and the closer sends.
// Office and Admin always send -- the owner can't be locked out of their
// own sales, and the per-user Send Estimates switch in Users & Roles
// still applies on top of everything here.

test("no closer on the lead means no hold", () => {
  assert.equal(
    closerHoldsSend({ closerId: null, userId: "rep-1", officeOrAdmin: false }),
    false
  );
});

test("the closer themselves may send", () => {
  assert.equal(
    closerHoldsSend({ closerId: "closer-1", userId: "closer-1", officeOrAdmin: false }),
    false
  );
});

test("a rep on a closer-led lead is held", () => {
  assert.equal(
    closerHoldsSend({ closerId: "closer-1", userId: "rep-1", officeOrAdmin: false }),
    true
  );
});

test("Office and Admin are never held", () => {
  assert.equal(
    closerHoldsSend({ closerId: "closer-1", userId: "office-1", officeOrAdmin: true }),
    false
  );
});

test("a completion certificate is exempt -- it closes out a job already sold", () => {
  assert.equal(
    closerHoldsSend({
      closerId: "closer-1",
      userId: "rep-1",
      officeOrAdmin: false,
      kind: "completion",
    }),
    false
  );
});

test("a change order is a priced document and goes through the closer too", () => {
  assert.equal(
    closerHoldsSend({
      closerId: "closer-1",
      userId: "rep-1",
      officeOrAdmin: false,
      kind: "change_order",
    }),
    true
  );
});

test("the message names the closer when known", () => {
  const msg = closerHoldMessage("Dana Reyes");
  assert.ok(msg.includes("Dana Reyes"));
});

test("the message still reads sensibly with no name on file", () => {
  const msg = closerHoldMessage(null);
  assert.ok(msg.includes("closer"));
  assert.ok(!msg.includes("null"));
});

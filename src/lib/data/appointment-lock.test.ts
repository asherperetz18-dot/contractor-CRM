import { test } from "node:test";
import assert from "node:assert/strict";
import { appointmentLockedForViewer, canCreateLeads, isDispatchScoped } from "./types.ts";

/**
 * The read-only rule for the appointment window.
 *
 * It has to agree exactly with migration 0090, which is the thing that
 * actually enforces it. If the two drift, the window either offers an
 * edit the database will refuse, or greys out one it would have
 * accepted -- and the first of those is the bug that started this.
 */

const ME = "me";
const THEM = "them";

test("a dispatcher cannot touch an appointment on someone else's lead", () => {
  assert.equal(
    appointmentLockedForViewer({
      holderId: THEM,
      viewerId: ME,
      viewerIsDispatchScoped: true,
    }),
    true
  );
});

test("their own lead is theirs to edit", () => {
  assert.equal(
    appointmentLockedForViewer({
      holderId: ME,
      viewerId: ME,
      viewerIsDispatchScoped: true,
    }),
    false
  );
});

test("an unclaimed lead stays open -- there is no holder to defer to", () => {
  assert.equal(
    appointmentLockedForViewer({
      holderId: null,
      viewerId: ME,
      viewerIsDispatchScoped: true,
    }),
    false
  );
});

test("an appointment with no lead is never locked", () => {
  assert.equal(
    appointmentLockedForViewer({ holderId: null, viewerId: ME, viewerIsDispatchScoped: true }),
    false
  );
  assert.equal(
    appointmentLockedForViewer({ holderId: undefined, viewerId: ME, viewerIsDispatchScoped: true }),
    false
  );
});

test("everyone who is not a scoped dispatcher is unaffected", () => {
  // Office, Admin, Sales, Field -- the lock is a dispatcher rule only,
  // and events_write still covers them in the database.
  assert.equal(
    appointmentLockedForViewer({
      holderId: THEM,
      viewerId: ME,
      viewerIsDispatchScoped: false,
    }),
    false
  );
});

test("a signed-out viewer is locked out of a held lead rather than let in", () => {
  // Fails closed. viewerId should never be null here, but if it is, the
  // holder is somebody else by definition.
  assert.equal(
    appointmentLockedForViewer({
      holderId: THEM,
      viewerId: null,
      viewerIsDispatchScoped: true,
    }),
    true
  );
});

test("Office or Admin alongside Dispatch lifts the scoping", () => {
  assert.equal(isDispatchScoped({ roles: ["Dispatch"] }), true);
  assert.equal(isDispatchScoped({ roles: ["Dispatch", "Call Center"] }), true);
  assert.equal(isDispatchScoped({ roles: ["Dispatch", "Office"] }), false);
  assert.equal(isDispatchScoped({ roles: ["Dispatch", "Admin"] }), false);
  assert.equal(isDispatchScoped({ roles: ["Sales"] }), false);
  assert.equal(isDispatchScoped(null), false);
});

test("the supervisor flag lifts the scoping like Office does", () => {
  assert.equal(isDispatchScoped({ roles: ["Dispatch"], is_dispatch_supervisor: true }), false);
  assert.equal(isDispatchScoped({ roles: ["Dispatch"], is_dispatch_supervisor: false }), true);
  // The flag on a non-dispatcher grants nothing to scope out of.
  assert.equal(isDispatchScoped({ roles: ["Sales"], is_dispatch_supervisor: true }), false);
});

test("entering new leads: Office/Admin/Sales, and only supervisor dispatchers", () => {
  assert.equal(canCreateLeads({ roles: ["Office"] }), true);
  assert.equal(canCreateLeads({ roles: ["Admin"] }), true);
  assert.equal(canCreateLeads({ roles: ["Sales"] }), true);
  assert.equal(canCreateLeads({ roles: ["Dispatch"] }), false);
  assert.equal(canCreateLeads({ roles: ["Dispatch"], is_dispatch_supervisor: true }), true);
  assert.equal(canCreateLeads({ roles: ["Call Center"], is_dispatch_supervisor: true }), false);
  assert.equal(canCreateLeads({ roles: ["Field"] }), false);
  assert.equal(canCreateLeads(null), false);
});

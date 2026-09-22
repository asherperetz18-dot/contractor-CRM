import { test } from "node:test";
import assert from "node:assert/strict";
import { customerTeamSegments } from "./customer-team-line.ts";

// The appointment window's read-only "Customer's team" line: one glance
// at who gets paid on this customer -- Rep, Partner, Closer, Dispatcher
// -- edited on the contact card, never here. These pin what the line
// says, because a wrong name here reads as "the commission moved".

const roster = [
  { id: "r1", name: "Mike Torres" },
  { id: "r2", name: "Dana Reyes" },
  { id: "c1", name: "Sam Okafor" },
  { id: "d1", name: null, email: "josh.c@example.com" },
];

test("a fully seated team reads Rep, Partner, Closer, Dispatcher in that order", () => {
  const segments = customerTeamSegments(
    { assigned_to: "r1", partner_rep_id: "r2", closer_id: "c1", dispatcher_id: "d1" },
    roster
  );
  assert.deepEqual(segments, [
    { label: "Rep", name: "Mike Torres" },
    { label: "Partner", name: "Dana Reyes" },
    { label: "Closer", name: "Sam Okafor" },
    // Name first, email as the fallback -- same rule as every board.
    { label: "Dispatcher", name: "josh.c@example.com" },
  ]);
});

test("empty seats are dropped, not shown as a row of Unassigned", () => {
  const segments = customerTeamSegments(
    { assigned_to: "r1", partner_rep_id: null, closer_id: null, dispatcher_id: null },
    roster
  );
  assert.deepEqual(segments, [{ label: "Rep", name: "Mike Torres" }]);
});

test("the Rep seat always shows, even unassigned -- it explains who can see the appointment", () => {
  const segments = customerTeamSegments(
    { assigned_to: null, partner_rep_id: null, closer_id: null, dispatcher_id: null },
    roster
  );
  assert.deepEqual(segments, [{ label: "Rep", name: "Unassigned" }]);
});

test("a seat held by someone no longer on the roster still shows, as Unnamed", () => {
  // Historical assignees never vanish from their own records (the
  // whole-roster rule in rep-options): the seat renders, name unknown.
  const segments = customerTeamSegments(
    { assigned_to: "r1", partner_rep_id: null, closer_id: "gone", dispatcher_id: null },
    roster
  );
  assert.deepEqual(segments, [
    { label: "Rep", name: "Mike Torres" },
    { label: "Closer", name: "Unnamed" },
  ]);
});

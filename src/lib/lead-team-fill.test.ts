import { test } from "node:test";
import assert from "node:assert/strict";
import { leadTeamFills } from "./lead-team-fill.ts";

// Linked cards: saving an appointment fills the contact's EMPTY team
// seats from the visit seats -- Assigned To becomes the Assigned Rep,
// Second Assigned To becomes the Partner Rep -- and never anything
// else. These pin the two promises the owner approved on the mockup:
// the contact card fills itself, and nobody's customer is ever taken
// away. A wrong answer here silently moves a sale and its commission.

test("a blank contact takes both visit seats: rep and partner", () => {
  assert.deepEqual(
    leadTeamFills(
      { assigned_to: null, partner_rep_id: null, closer_id: null },
      { assigned_to: "mike", second_assigned_to: "dana" }
    ),
    { assigned_to: "mike", partner_rep_id: "dana" }
  );
});

test("a held rep seat is never overwritten -- a helper on one visit never takes the sale", () => {
  assert.deepEqual(
    leadTeamFills(
      { assigned_to: "asher", partner_rep_id: null, closer_id: null },
      { assigned_to: "sam", second_assigned_to: null }
    ),
    {}
  );
});

test("a held partner seat is never overwritten either", () => {
  assert.deepEqual(
    leadTeamFills(
      { assigned_to: "asher", partner_rep_id: "dana", closer_id: null },
      { assigned_to: null, second_assigned_to: "sam" }
    ),
    {}
  );
});

test("the second chair can still fill an empty partner seat when the rep is already held", () => {
  assert.deepEqual(
    leadTeamFills(
      { assigned_to: "asher", partner_rep_id: null, closer_id: null },
      { assigned_to: "asher", second_assigned_to: "dana" }
    ),
    { partner_rep_id: "dana" }
  );
});

test("one person in both chairs never becomes their own partner", () => {
  assert.deepEqual(
    leadTeamFills(
      { assigned_to: null, partner_rep_id: null, closer_id: null },
      { assigned_to: "mike", second_assigned_to: "mike" }
    ),
    { assigned_to: "mike" }
  );
});

test("the second chair matching the contact's existing rep is not a partnership", () => {
  assert.deepEqual(
    leadTeamFills(
      { assigned_to: "asher", partner_rep_id: null, closer_id: null },
      { assigned_to: "sam", second_assigned_to: "asher" }
    ),
    {}
  );
});

test("the closer never takes a sale seat -- a closer in the second chair fills nothing", () => {
  // Same exclusivity rule as the pickers: partner and closer are
  // mutually exclusive seats (decision #050).
  assert.deepEqual(
    leadTeamFills(
      { assigned_to: "asher", partner_rep_id: null, closer_id: "sam" },
      { assigned_to: null, second_assigned_to: "sam" }
    ),
    {}
  );
});

test("an empty visit fills nothing", () => {
  assert.deepEqual(
    leadTeamFills(
      { assigned_to: null, partner_rep_id: null, closer_id: null },
      { assigned_to: null, second_assigned_to: null }
    ),
    {}
  );
});

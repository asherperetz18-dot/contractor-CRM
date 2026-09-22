import { test } from "node:test";
import assert from "node:assert/strict";
import { reminderRecipientIds } from "./reminder-recipients.ts";

// The reminder texts follow the visit seats, both of them, and only
// them. These pin who the cron texts -- a wrong answer here texts a
// customer's closer about a drive they were never making, or leaves
// the second rep to find out about a visit by missing it.

test("both visit seats get the reminder", () => {
  assert.deepEqual(
    reminderRecipientIds({ assigned_to: "rep-1", second_assigned_to: "rep-2" }),
    ["rep-1", "rep-2"]
  );
});

test("one person in both chairs is texted once, not twice", () => {
  assert.deepEqual(
    reminderRecipientIds({ assigned_to: "rep-1", second_assigned_to: "rep-1" }),
    ["rep-1"]
  );
});

test("a second chair with no first chair still gets reminded", () => {
  assert.deepEqual(
    reminderRecipientIds({ assigned_to: null, second_assigned_to: "rep-2" }),
    ["rep-2"]
  );
});

test("an unassigned visit with no lead context reminds nobody", () => {
  assert.deepEqual(reminderRecipientIds({ assigned_to: null, second_assigned_to: null }), []);
});

test("an unassigned visit falls back to the customer's rep -- no appointment goes untexted", () => {
  assert.deepEqual(
    reminderRecipientIds(
      { assigned_to: null, second_assigned_to: null },
      { assigned_to: "asher" }
    ),
    ["asher"]
  );
});

test("the fallback never fires while someone is actually booked on the visit", () => {
  // The customer's rep is not driving out here -- rep-2 is. Texting the
  // rep about a visit that is someone else's drive is the exact noise
  // the visit-seats rule exists to prevent.
  assert.deepEqual(
    reminderRecipientIds(
      { assigned_to: null, second_assigned_to: "rep-2" },
      { assigned_to: "asher" }
    ),
    ["rep-2"]
  );
});

test("a lead with no rep either still reminds nobody", () => {
  assert.deepEqual(
    reminderRecipientIds({ assigned_to: null, second_assigned_to: null }, { assigned_to: null }),
    []
  );
});

test("rows read before the second-chair column existed still work", () => {
  assert.deepEqual(reminderRecipientIds({ assigned_to: "rep-1" }), ["rep-1"]);
});

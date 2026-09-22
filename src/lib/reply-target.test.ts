import { test } from "node:test";
import assert from "node:assert/strict";
import { replyTargetSnapshot } from "./reply-target.ts";
import type { LeadLite } from "./data/types.ts";

// The Reply Inbox's compose deep-link ("Send SMS" on an appointment,
// popup alerts). The inbox strips its URL right after consuming it and
// the next render only carries contacts that already have messages --
// so everything the composer needs must be pinned here, once, while
// the contact is still in hand. Losing it is exactly the bug these
// pin: a first-ever text read "New conversation" / "No phone number
// to send to" while the contact card showed a number.

const lite = (over: Partial<LeadLite>): LeadLite => ({
  id: "l1",
  contact_type: "Individual",
  company_name: null,
  first_name: "Asi",
  last_name: "Peretz",
  phone: "818-219-8855",
  second_contact_phone: null,
  address: null,
  ...over,
});

test("a targeted contact keeps their name and number for the composer", () => {
  assert.deepEqual(replyTargetSnapshot([lite({})], "l1", null), {
    leadId: "l1",
    name: "Asi Peretz",
    phone: "818-219-8855",
  });
});

test("a contact whose only number is the second contact's is still textable", () => {
  assert.deepEqual(
    replyTargetSnapshot([lite({ phone: null, second_contact_phone: "310-555-0100" })], "l1", null),
    { leadId: "l1", name: "Asi Peretz", phone: "310-555-0100" }
  );
});

test("a raw-number target (no contact) composes to that number", () => {
  assert.deepEqual(replyTargetSnapshot([], null, "424-555-0199"), {
    leadId: null,
    name: "424-555-0199",
    phone: "424-555-0199",
  });
});

test("a target the page could not load still opens, honestly empty", () => {
  assert.deepEqual(replyTargetSnapshot([], "gone", null), {
    leadId: "gone",
    name: "New conversation",
    phone: "",
  });
});

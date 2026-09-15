import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDuplicateGroups, type DupContact } from "./contact-duplicates.ts";

/**
 * The Contacts page's duplicate banner used to group the whole book in
 * the browser -- possible only because every lead was shipped there.
 * The grouping now runs server-side; these tests pin its judgments to
 * what the in-browser version did: primary phone's ten digits and
 * exact-lowercase email, and an email group only counts when it names
 * somebody a phone group didn't already.
 */

function c(id: string, phone: string | null, email: string | null): DupContact {
  return {
    id,
    contact_type: "Individual",
    company_name: null,
    first_name: id,
    last_name: null,
    phone,
    email,
    stage: "New",
    value: 0,
  };
}

test("contacts sharing a phone's last ten digits group together, however formatted", () => {
  const groups = buildDuplicateGroups([
    c("a", "(310) 697-6137", null),
    c("b", "+1 310-697-6137", null),
    c("c", "3106976137", null),
    c("d", "555-000-1111", null),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].kind, "phone");
  assert.equal(groups[0].key, "3106976137");
  assert.deepEqual(groups[0].members.map((m) => m.id).sort(), ["a", "b", "c"]);
});

test("a phone shorter than ten digits never groups", () => {
  const groups = buildDuplicateGroups([c("a", "697-6137", null), c("b", "697-6137", null)]);
  assert.deepEqual(groups, []);
});

test("an email group only counts when it names somebody new", () => {
  const groups = buildDuplicateGroups([
    // Same phone AND same email: one phone group; the email group would
    // just repeat it, so it is dropped.
    c("a", "3106976137", "Sam@Home.com"),
    c("b", "3106976137", "sam@home.com "),
    // A separate email-only pair still reports.
    c("x", null, "pat@work.com"),
    c("y", null, "PAT@work.com"),
  ]);
  assert.deepEqual(
    groups.map((g) => g.kind + ":" + g.key).sort(),
    ["email:pat@work.com", "phone:3106976137"]
  );
});

test("biggest groups list first", () => {
  const groups = buildDuplicateGroups([
    c("a", "3106976137", null),
    c("b", "3106976137", null),
    c("p", "5550001111", null),
    c("q", "5550001111", null),
    c("r", "5550001111", null),
  ]);
  assert.deepEqual(groups.map((g) => g.key), ["5550001111", "3106976137"]);
});

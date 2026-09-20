import { test } from "node:test";
import assert from "node:assert/strict";
import { repBylineName, repDisplayName, repDropdownOptions } from "./rep-options.ts";
import type { AppRole, UserStatus } from "./types.ts";

/**
 * Every dropdown that picks a person used to offer the whole active
 * roster -- the shared phone account, bookkeepers, dispatchers -- when
 * the field only ever means a salesperson. This is the one rule they
 * all narrow with: active Sales members, alphabetically, plus whoever
 * the field or filter already points at so old records keep a name.
 */

const member = (
  id: string,
  name: string | null,
  roles: AppRole[] = ["Sales"],
  status: UserStatus = "Active",
  email: string | null = null
) => ({ id, name, email, roles, status });

test("offers only active Sales members", () => {
  const options = repDropdownOptions([
    member("a", "Asher"),
    member("b", "CRM PHONE", ["Office"]),
    member("c", "Dana Dispatch", ["Dispatch"]),
    member("d", "Bar"),
  ]);
  assert.deepEqual(
    options.map((o) => o.id),
    ["a", "d"]
  );
});

test("an archived salesperson is off the list", () => {
  const options = repDropdownOptions([
    member("a", "Asher"),
    member("b", "Gone Rep", ["Sales"], "Archived"),
  ]);
  assert.deepEqual(
    options.map((o) => o.id),
    ["a"]
  );
});

test("sorted alphabetically by name, falling back to email", () => {
  const options = repDropdownOptions([
    member("j", "josh.c"),
    member("b", "Bar"),
    member("a", "Andrea"),
    member("e", null, ["Sales"], "Active", "carlos@x.com"),
  ]);
  assert.deepEqual(
    options.map((o) => o.name || o.email),
    ["Andrea", "Bar", "carlos@x.com", "josh.c"]
  );
});

test("whoever the field already points at stays listed, whatever their role or status", () => {
  const options = repDropdownOptions(
    [
      member("a", "Asher"),
      member("b", "Old Office Hand", ["Office"]),
      member("c", "Retired Rep", ["Sales"], "Archived"),
    ],
    ["b", "c"]
  );
  assert.deepEqual(
    options.map((o) => o.id),
    ["a", "b", "c"]
  );
});

test("empty and unknown keep ids are ignored", () => {
  const options = repDropdownOptions(
    [member("a", "Asher")],
    ["", null, undefined, "nobody-here"]
  );
  assert.deepEqual(
    options.map((o) => o.id),
    ["a"]
  );
});

test("a member without roles or status fields is treated as not a rep", () => {
  const options = repDropdownOptions([
    { id: "x", name: "Slim Row", email: null },
    member("a", "Asher"),
  ]);
  assert.deepEqual(
    options.map((o) => o.id),
    ["a"]
  );
});

// The appointment panel's read-only "Customer's Rep" line: whoever a
// stored id points at, named -- never a blank. Same fallbacks as the
// board's name lookups (name, then email, then "Unnamed"), and an
// unassigned contact says so rather than rendering an empty cell.
test("repDisplayName names the stored id, whatever their role or status", () => {
  const roster = [
    member("a", "Asher"),
    member("b", null, ["Office"], "Active", "office@x.com"),
    member("c", null, ["Sales"], "Archived"),
  ];
  assert.equal(repDisplayName("a", roster), "Asher");
  assert.equal(repDisplayName("b", roster), "office@x.com");
  assert.equal(repDisplayName("c", roster), "Unnamed");
});

test("repDisplayName says Unassigned for no id and Unnamed for an id off the roster", () => {
  const roster = [member("a", "Asher")];
  assert.equal(repDisplayName(null, roster), "Unassigned");
  assert.equal(repDisplayName(undefined, roster), "Unassigned");
  assert.equal(repDisplayName("", roster), "Unassigned");
  assert.equal(repDisplayName("gone-from-roster", roster), "Unnamed");
});

// A byline ("Added by …") is optional metadata, not a field with a
// stored value behind it: when nobody can be named the line is dropped,
// never filled with "Unassigned"/"Unnamed" -- on a byline those read as
// bugs, not answers.
test("repBylineName names the person, falling back to email", () => {
  const roster = [
    member("a", "Asher"),
    member("b", null, ["Office"], "Active", "office@x.com"),
  ];
  assert.equal(repBylineName("a", roster), "Asher");
  assert.equal(repBylineName("b", roster), "office@x.com");
});

test("repBylineName stays silent for system-created rows and ids off the roster", () => {
  const roster = [member("a", "Asher")];
  assert.equal(repBylineName(null, roster), null);
  assert.equal(repBylineName(undefined, roster), null);
  assert.equal(repBylineName("", roster), null);
  assert.equal(repBylineName("gone-from-roster", roster), null);
});

// The panel hands this the WHOLE roster, not the Active-only list its
// dropdown uses -- so a task entered by somebody who has since left
// keeps their name instead of reading as system-created.
test("repBylineName names a deactivated member when given the whole roster", () => {
  const roster = [member("a", "Asher"), member("g", "Gone Rep", ["Sales"], "Archived")];
  assert.equal(repBylineName("g", roster), "Gone Rep");
});

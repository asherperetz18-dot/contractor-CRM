import { test } from "node:test";
import assert from "node:assert/strict";
import { repDropdownOptions } from "./rep-options.ts";
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
